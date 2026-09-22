import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify, parseEnv } from "node:util";
import pg from "pg";
import { createLocalEnvironment } from "../../../infra/scripts/create-local-env.mjs";

const run = promisify(execFile);
const bin = process.env.TEST_POSTGRES_BIN;
if (!bin) {
  console.error(
    "TEST_POSTGRES_BIN is required; this command never installs or downloads PostgreSQL.",
  );
  process.exitCode = 1;
} else {
  const path = await mkdtemp(join(tmpdir(), "hambazi-db-test-"));
  let started = false;
  let stage = "environment";
  let env = {};
  try {
    await createLocalEnvironment(path);
    env = parseEnv(await readFile(join(path, ".env"), "utf8"));
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error();
    const port = address.port;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await writeFile(join(path, "admin-password"), env.POSTGRES_PASSWORD, { mode: 0o600 });
    const args = [
      "-D",
      join(path, "data"),
      "-U",
      "hambazi_local_admin",
      "--pwfile",
      join(path, "admin-password"),
      "--auth-local=scram-sha-256",
      "--auth-host=scram-sha-256",
      "--locale=C",
      "--encoding=UTF8",
      "--no-instructions",
    ];
    if (process.env.TEST_POSTGRES_SHARE) args.push("-L", process.env.TEST_POSTGRES_SHARE);
    stage = "initdb";
    await run(join(bin, "initdb"), args);
    stage = "start";
    // A failed/timeout start can still leave a process: always attempt shutdown.
    started = true;
    await run(join(bin, "pg_ctl"), [
      "-D",
      join(path, "data"),
      "-l",
      join(path, "server.log"),
      "-o",
      `-h 127.0.0.1 -p ${port} -k ${path} -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse -c log_parameter_max_length_on_error=0`,
      "-w",
      "start",
    ]);
    const adminUrl = `postgresql://hambazi_local_admin:${env.POSTGRES_PASSWORD}@127.0.0.1:${port}/postgres`;
    stage = "create database";
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query("CREATE DATABASE hambazi");
    } finally {
      await admin.end();
    }
    const childEnv = {
      ...process.env,
      ...env,
      PATH: `${bin}:${process.env.PATH}`,
      PGHOST: "127.0.0.1",
      PGPORT: String(port),
      PGPASSWORD: env.POSTGRES_PASSWORD,
      POSTGRES_USER: "hambazi_local_admin",
      POSTGRES_DB: "hambazi",
    };
    // Exercise the actual local role bootstrap, not a test reimplementation.
    stage = "role bootstrap";
    await run(
      "sh",
      [new URL("../../../infra/docker/postgres/10-roles.sh", import.meta.url).pathname],
      { env: childEnv },
    );
    for (const key of ["API_DATABASE_URL", "WORKER_DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
      const url = new URL(env[key]);
      url.hostname = "127.0.0.1";
      url.port = String(port);
      childEnv[key] = url.toString();
    }
    childEnv.TEST_DATABASE_URL = adminUrl.replace("/postgres", "/hambazi");
    childEnv.TEST_DATABASE_CONFIRM = "isolated-hambazi-test";
    childEnv.TEST_DATABASE_RUN_ID = randomBytes(8).toString("hex");
    const cwd = new URL("..", import.meta.url);
    const require = createRequire(import.meta.url);
    let legacyId;
    let legacySessionId;
    if (process.argv.includes("--api-auth")) {
      stage = "populated foundation upgrade setup";
      // Isolated-cluster rehearsal only: establish the previous schema and a
      // synthetic old-release row, then let normal deploy apply the expansion.
      legacyId = randomUUID();
      legacySessionId = randomUUID();
      const legacy = new pg.Client({ connectionString: childEnv.MIGRATION_DATABASE_URL });
      await legacy.connect();
      try {
        await legacy.query(
          await readFile(
            new URL("../prisma/migrations/202609130001_foundation/migration.sql", import.meta.url),
            "utf8",
          ),
        );
        await legacy.query(
          "INSERT INTO users (id,telegram_user_id,display_name,public_handle,status,updated_at) VALUES ($1,17,'Legacy Synthetic','legacy_synthetic','ACTIVE',now())",
          [legacyId],
        );
        await legacy.query(
          await readFile(
            new URL(
              "../prisma/migrations/202609140001_auth_sessions/migration.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        await legacy.query(
          "INSERT INTO sessions (id,user_id,command_id,schema_version,key_id,issuer,audience,issued_at,expires_at) VALUES ($1,$2,$3,1,'legacy','legacy-api','legacy-app','2026-09-20T00:00:00Z','2026-09-20T00:15:00Z')",
          [legacySessionId, legacyId, randomUUID()],
        );
      } finally {
        await legacy.end();
      }
      await run(
        process.execPath,
        [
          require.resolve("prisma/build/index.js"),
          "migrate",
          "resolve",
          "--applied",
          "202609130001_foundation",
        ],
        { cwd, env: childEnv, timeout: 30_000 },
      );
      await run(
        process.execPath,
        [
          require.resolve("prisma/build/index.js"),
          "migrate",
          "resolve",
          "--applied",
          "202609140001_auth_sessions",
        ],
        { cwd, env: childEnv, timeout: 30_000 },
      );
    }
    stage = "migration deploy";
    await run(process.execPath, [new URL("migrate.mjs", import.meta.url).pathname], {
      cwd,
      env: childEnv,
    });
    // A repeated deploy must be a no-op, including idempotent grants.
    await run(process.execPath, [new URL("migrate.mjs", import.meta.url).pathname], {
      cwd,
      env: childEnv,
    });
    stage = "integration";
    if (legacyId) {
      stage = "populated foundation upgrade verification";
      const legacy = new pg.Client({ connectionString: childEnv.MIGRATION_DATABASE_URL });
      await legacy.connect();
      try {
        const result = await legacy.query(
          "SELECT display_name, public_handle, status, profile_version FROM users WHERE id=$1",
          [legacyId],
        );
        if (
          JSON.stringify(result.rows) !==
          JSON.stringify([
            {
              display_name: "Legacy Synthetic",
              public_handle: "legacy_synthetic",
              status: "ACTIVE",
              profile_version: 0,
            },
          ])
        )
          throw new Error();
        const priorSession = await legacy.query(
          "SELECT key_id,issuer,audience,revoked_at FROM sessions WHERE id=$1 AND user_id=$2",
          [legacySessionId, legacyId],
        );
        if (
          JSON.stringify(priorSession.rows) !==
          JSON.stringify([
            { key_id: "legacy", issuer: "legacy-api", audience: "legacy-app", revoked_at: null },
          ])
        )
          throw new Error();
        // Remove only our known synthetic upgrade probe before the empty-fixture suite.
        await legacy.query("DELETE FROM sessions WHERE id=$1", [legacySessionId]);
        await legacy.query("DELETE FROM users WHERE id=$1", [legacyId]);
      } finally {
        await legacy.end();
      }
      console.info(
        "Populated previous-schema expansion preserved synthetic old-release account and session rows.",
      );
    }
    stage = "schema drift";
    await run(
      process.execPath,
      [
        require.resolve("prisma/build/index.js"),
        "migrate",
        "diff",
        "--from-config-datasource",
        "--to-schema",
        "prisma/schema.prisma",
        "--exit-code",
      ],
      { cwd, env: childEnv, timeout: 30_000 },
    );
    stage = "integration";
    const result = await run(
      process.execPath,
      [
        join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
        "run",
        "tests/integration",
      ],
      { cwd, env: childEnv, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
    );
    console.info(result.stdout);
    stage = "restart";
    // Prove committed schema survives a real process restart.
    await run(join(bin, "pg_ctl"), [
      "-D",
      join(path, "data"),
      "-m",
      "fast",
      "-w",
      "restart",
      "-l",
      join(path, "server.log"),
    ]);
    const restored = new pg.Client({ connectionString: childEnv.MIGRATION_DATABASE_URL });
    await restored.connect();
    try {
      const result = await restored.query(
        "SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL",
      );
      if (result.rows[0].count !== 5) throw new Error();
      const persisted = await restored.query(
        "SELECT (SELECT count(*)::int FROM users) AS users, (SELECT state_version FROM matches LIMIT 1) AS version, (SELECT count(*)::int FROM game_events) AS events, (SELECT count(*)::int FROM outbox_events) AS outbox",
      );
      const row = persisted.rows[0];
      if (row.users !== 1 || row.version !== 1 || row.events !== 1 || row.outbox !== 1)
        throw new Error();
    } finally {
      await restored.end();
    }
    console.info("Migration deploy/redeploy, PostgreSQL restart, and integration checks passed.");
    if (process.argv.includes("--api-auth")) {
      stage = "API session integration";
      // The session suite asserts the pristine foundation fixture before seeding.
      // Keep suite setup/restart drills isolated; each suite still tests concurrent clients.
      for (const suite of [
        "sessions.test.ts",
        "bot-delivery.test.mjs",
        "profile.test.ts",
        "catalog.test.ts",
      ]) {
        const result = await run(
          process.execPath,
          [
            join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
            "run",
            `tests/integration/${suite}`,
          ],
          {
            cwd: new URL("../../../apps/api/", import.meta.url),
            env: { ...childEnv, TEST_AUTH_DATABASE_READY: "foundation-completed" },
            timeout: 120_000,
            maxBuffer: 4 * 1024 * 1024,
          },
        );
        console.info(result.stdout);
      }
      stage = "session and account restart persistence";
      const snapshot = async () => {
        const client = new pg.Client({ connectionString: childEnv.MIGRATION_DATABASE_URL });
        await client.connect();
        try {
          const result = await client.query(
            "SELECT id, user_id, command_id, schema_version, key_id, issuer, audience, issued_at, expires_at, revoked_at FROM sessions ORDER BY id",
          );
          if (result.rows.length < 2 || !result.rows.some((row) => row.revoked_at))
            throw new Error();
          const accounts = await client.query(
            "SELECT id, telegram_user_id, display_name, public_handle, status, profile_version FROM users ORDER BY id",
          );
          if (!accounts.rows.some((row) => row.telegram_user_id === "6001")) throw new Error();
          const receipts = await client.query("SELECT * FROM bot_update_receipts ORDER BY id");
          const flows = await client.query("SELECT * FROM bot_onboarding_flows ORDER BY id");
          const profiles = await client.query(
            "SELECT * FROM profile_mutation_receipts ORDER BY id",
          );
          const settings = await client.query("SELECT * FROM user_settings ORDER BY user_id");
          const catalog = await client.query("SELECT * FROM games WHERE id='coup'");
          if (catalog.rows.length !== 1 || catalog.rows[0].status !== "DISABLED") throw new Error();
          if (!profiles.rows.length || !settings.rows.length) throw new Error();
          if (!receipts.rows.some((row) => row.phase === "REPLY") || !flows.rows.length)
            throw new Error();
          return JSON.stringify({
            sessions: result.rows,
            accounts: accounts.rows,
            receipts: receipts.rows,
            flows: flows.rows,
            profiles: profiles.rows,
            settings: settings.rows,
            catalog: catalog.rows,
          });
        } finally {
          await client.end();
        }
      };
      const before = await snapshot();
      await run(join(bin, "pg_ctl"), [
        "-D",
        join(path, "data"),
        "-m",
        "fast",
        "-w",
        "restart",
        "-l",
        join(path, "server.log"),
      ]);
      if (before !== (await snapshot())) throw new Error();
      console.info(
        "API session/account/onboarding integration and account/session/receipt/flow restart persistence passed.",
      );
      if (childEnv.TEST_WORKER_REDIS_URL) {
        stage = "Worker cleanup integration";
        const workerTests = await run("pnpm", ["test:integration"], {
          cwd: new URL("../../../apps/worker/", import.meta.url),
          env: { ...childEnv, TEST_AUTH_DATABASE_READY: "foundation-completed" },
          timeout: 60000,
          maxBuffer: 4 * 1024 * 1024,
        });
        console.info(workerTests.stdout);
      }
    }
  } catch (error) {
    // Only sanitized test output is reportable; never emit child command/env/error.
    let output =
      error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
    for (const [key, value] of Object.entries(env))
      if (key.endsWith("PASSWORD")) output = output.replaceAll(value, "[REDACTED]");
    if (output) console.error(output);
    if (
      ["API session integration", "Worker cleanup integration"].includes(stage) &&
      error &&
      typeof error === "object" &&
      "stderr" in error
    ) {
      // Test names and source locations only: never print assertion values, SQL or credentials.
      const lines = String(error.stderr).split("\n");
      for (const line of lines) {
        if (/^ FAIL {2}tests\/integration\/[A-Za-z0-9_.-]+/.test(line)) console.error(line);
        const frame = line.match(/tests\/integration\/[A-Za-z0-9_.-]+:\d+:\d+/);
        if (frame) console.error(`Integration failure location: ${frame[0]}`);
      }
    }
    if (stage === "migration deploy" && error && typeof error === "object" && "stderr" in error) {
      const safe = String(error.stderr)
        .split("\n")
        .filter((line) => line.startsWith("DATABASE_MIGRATION_FAILED at "));
      if (safe.length) console.error(safe.join("\n"));
    }
    console.error(`DATABASE_LOCAL_TEST_FAILED at ${stage}; no connection secrets are printed.`);
    process.exitCode = 1;
  } finally {
    let stopped = !started;
    if (started) {
      try {
        await run(join(bin, "pg_ctl"), ["-D", join(path, "data"), "-m", "fast", "-w", "stop"]);
        stopped = true;
      } catch {
        console.error(
          "Could not stop the isolated test cluster; its private data directory was preserved.",
        );
        process.exitCode = 1;
      }
    }
    // Remove only this harness-created temporary directory, and only after shutdown.
    if (stopped) await rm(path, { recursive: true, force: true });
  }
}
