import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
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
    const require = createRequire(import.meta.url);
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
      if (result.rows[0].count !== 1) throw new Error();
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
  } catch (error) {
    // Only sanitized test output is reportable; never emit child command/env/error.
    let output =
      error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
    for (const [key, value] of Object.entries(env))
      if (key.endsWith("PASSWORD")) output = output.replaceAll(value, "[REDACTED]");
    if (output) console.error(output);
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
