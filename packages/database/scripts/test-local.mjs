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
import { restoreDrill, RestoreDrillError } from "./restore-drill.mjs";
import { startIsolatedPostgres } from "../../../infra/scripts/isolated-postgres.mjs";

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
  let container;
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
    if (process.env.TEST_POSTGRES_MODE === "compose") {
      stage = "isolated Compose PostgreSQL image";
      container = await startIsolatedPostgres({ directory: path, port, credentials: env });
      started = true;
    } else {
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
    }
    const adminUrl = `postgresql://hambazi_local_admin:${env.POSTGRES_PASSWORD}@127.0.0.1:${port}/postgres`;
    stage = "create database";
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      if (!container) await admin.query("CREATE DATABASE hambazi");
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
    if (!container)
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
    let legacyRoomId;
    let legacyGameId;
    let legacyOutboxId;
    if (process.argv.includes("--api-auth") || process.argv.includes("--api-personal")) {
      stage = "populated foundation upgrade setup";
      // Isolated-cluster rehearsal only: establish the previous schema and a
      // synthetic old-release row, then let normal deploy apply the expansion.
      legacyOutboxId = randomUUID();
      legacyId = randomUUID();
      legacySessionId = randomUUID();
      legacyRoomId = randomUUID();
      legacyGameId = `legacy-room-${randomUUID()}`;
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
          "INSERT INTO outbox_events (id,aggregate_id,type,schema_version,payload_jsonb,status) VALUES ($1,$2,'legacy.fixture',1,'{}','PENDING')",
          [legacyOutboxId, randomUUID()],
        );
        await legacy.query(
          "INSERT INTO users (id,telegram_user_id,display_name,public_handle,status,updated_at) VALUES ($1,17,'Legacy Synthetic','legacy_synthetic','ACTIVE',now())",
          [legacyId],
        );
        await legacy.query(
          "INSERT INTO games (id,slug,title,min_players,max_players,matchmaking_enabled,private_rooms_enabled,chat_enabled,voice_enabled,status,config_schema_version,config_jsonb,updated_at) VALUES ($1,$1,'Legacy',2,6,false,false,false,false,'DISABLED',1,'{}',now())",
          [legacyGameId],
        );
        await legacy.query(
          "INSERT INTO rooms (id,game_id,host_user_id,capacity,invite_code,status,expires_at,updated_at) VALUES ($1,$2,$3,2,$4,'WAITING','2031-01-01T00:00:00Z',now())",
          [legacyRoomId, legacyGameId, legacyId, randomUUID()],
        );
        await legacy.query("INSERT INTO room_members (room_id,user_id,seat) VALUES ($1,$2,0)", [
          legacyRoomId,
          legacyId,
        ]);
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
        const oldRoom = await legacy.query(
          "SELECT schema_version,state_version,started_match_id,capacity,status FROM rooms WHERE id=$1",
          [legacyRoomId],
        );
        if (
          JSON.stringify(oldRoom.rows) !==
          JSON.stringify([
            {
              schema_version: 1,
              state_version: 0,
              started_match_id: null,
              capacity: 2,
              status: "WAITING",
            },
          ])
        )
          throw new Error();
        const oldMember = await legacy.query(
          "SELECT joined_version,seat FROM room_members WHERE room_id=$1 AND user_id=$2",
          [legacyRoomId, legacyId],
        );
        if (JSON.stringify(oldMember.rows) !== JSON.stringify([{ joined_version: 0, seat: 0 }]))
          throw new Error();
        await legacy.query("DELETE FROM room_members WHERE room_id=$1", [legacyRoomId]);
        await legacy.query("DELETE FROM rooms WHERE id=$1", [legacyRoomId]);
        await legacy.query("DELETE FROM games WHERE id=$1", [legacyGameId]);
        const oldOutbox = await legacy.query(
          "SELECT schema_version,status,attempts,payload_jsonb,claimed_until FROM outbox_events WHERE id=$1",
          [legacyOutboxId],
        );
        if (
          JSON.stringify(oldOutbox.rows) !==
          JSON.stringify([
            {
              schema_version: 1,
              status: "PENDING",
              attempts: 0,
              payload_jsonb: {},
              claimed_until: null,
            },
          ])
        )
          throw new Error();
        await legacy.query("DELETE FROM outbox_events WHERE id=$1", [legacyOutboxId]);
        // Remove only our known synthetic upgrade probe before the empty-fixture suite.
        await legacy.query("DELETE FROM sessions WHERE id=$1", [legacySessionId]);
        await legacy.query("DELETE FROM users WHERE id=$1", [legacyId]);
      } finally {
        await legacy.end();
      }
      console.info(
        "Populated previous-schema expansion preserved synthetic old-release account, session, room, membership and outbox rows.",
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
    if (container) await container.restart();
    else
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
      if (result.rows[0].count !== 15) throw new Error();
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
    if (process.argv.includes("--api-auth") || process.argv.includes("--api-personal")) {
      stage = "API session integration";
      // The session suite asserts the pristine foundation fixture before seeding.
      // Keep suite setup/restart drills isolated; each suite still tests concurrent clients.
      const suites = process.argv.includes("--api-personal")
        ? ["personal-bots.test.ts", "release-contract.test.mjs"]
        : [
            "sessions.test.ts",
            "bot-delivery.test.mjs",
            "profile.test.ts",
            "catalog.test.ts",
            "rooms.test.ts",
            "match-admission.test.ts",
            "matchmaking.test.ts",
            "match-processing.test.ts",
            "private-room-match.test.ts",
            "match-reconnect.test.ts",
            "realtime.test.ts",
            "transport-admission.test.ts",
            "chat.test.ts",
            "statistics.test.ts",
            "diagnostics.test.ts",
            "release-contract.test.mjs",
            "personal-bots.test.ts",
          ];
      for (const suite of suites) {
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
          if (process.argv.includes("--api-personal")) {
            const matches = await client.query(
              "SELECT * FROM matches WHERE match_type='PERSONAL_BOTS_V1' ORDER BY id",
            );
            if (
              !matches.rows.some((r) => r.status === "FINISHED") ||
              matches.rows.filter((r) => r.status === "TERMINATED").length !== 2
            )
              throw new Error();
            const bots = await client.query("SELECT * FROM match_bot_seats ORDER BY match_id,seat");
            if (bots.rows.length !== matches.rows.length) throw new Error();
            const events = await client.query(
              "SELECT * FROM game_events WHERE match_id IN (SELECT id FROM matches WHERE match_type='PERSONAL_BOTS_V1') ORDER BY match_id,seq",
            );
            const commands = await client.query(
              "SELECT * FROM processed_commands WHERE match_id IN (SELECT id FROM matches WHERE match_type='PERSONAL_BOTS_V1') ORDER BY match_id,action_id",
            );
            return JSON.stringify({
              matches: matches.rows,
              bots: bots.rows,
              events: events.rows,
              commands: commands.rows,
            });
          }
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
          const rooms = await client.query("SELECT * FROM rooms ORDER BY id");
          const members = await client.query(
            "SELECT * FROM room_members ORDER BY room_id, user_id",
          );
          const roomCommands = await client.query(
            "SELECT * FROM room_command_receipts ORDER BY actor_user_id, command_id",
          );
          if (!rooms.rows.length || !members.rows.length || !roomCommands.rows.length)
            throw new Error();
          const admissions = await client.query("SELECT * FROM match_admissions ORDER BY id");
          const reservations = await client.query("SELECT * FROM match_reservations ORDER BY id");
          const matches = await client.query("SELECT * FROM matches ORDER BY id");
          const players = await client.query("SELECT * FROM match_players ORDER BY match_id, seat");
          const leases = await client.query(
            "SELECT * FROM match_connection_leases ORDER BY match_id, connection_id",
          );
          const consumerReceipts = await client.query(
            "SELECT * FROM consumer_receipts ORDER BY consumer, event_id",
          );
          const matchEvents = await client.query(
            "SELECT * FROM game_events ORDER BY match_id, seq",
          );
          const matchCommands = await client.query(
            "SELECT * FROM processed_commands ORDER BY match_id, action_id",
          );
          const chatMessages = await client.query(
            "SELECT * FROM chat_messages ORDER BY match_id, seq, id",
          );
          const chatStreams = await client.query("SELECT * FROM chat_streams ORDER BY match_id");
          if (!chatStreams.rows.length || !chatMessages.rows.some((row) => row.seq !== null))
            throw new Error();
          const outbox = await client.query("SELECT * FROM outbox_events ORDER BY id");
          if (
            !admissions.rows.some((r) => r.status === "MATCHED") ||
            !reservations.rows.some((r) => r.match_id)
          )
            throw new Error();
          const matchResults = await client.query("SELECT * FROM match_results ORDER BY match_id");
          const resultSeats = await client.query(
            "SELECT * FROM game_results ORDER BY match_id, user_id",
          );
          const statsHeads = await client.query("SELECT * FROM stats_heads ORDER BY id");
          const statsGenerations = await client.query(
            "SELECT * FROM stats_generations ORDER BY id",
          );
          const statsApplications = await client.query(
            "SELECT * FROM stats_applications ORDER BY generation_id, match_id",
          );
          const statsValues = await client.query(
            "SELECT * FROM stats_values ORDER BY generation_id, user_id, game_id, metric, period",
          );
          if (
            !matchResults.rows.length ||
            !statsApplications.rows.length ||
            !statsValues.rows.length
          )
            throw new Error();
          const settings = await client.query("SELECT * FROM user_settings ORDER BY user_id");
          const catalog = await client.query("SELECT * FROM games WHERE id='coup'");
          if (catalog.rows.length !== 1 || catalog.rows[0].status !== "DISABLED") throw new Error();
          if (!profiles.rows.length || !settings.rows.length) throw new Error();
          if (!receipts.rows.some((row) => row.phase === "REPLY") || !flows.rows.length)
            throw new Error();
          return JSON.stringify({
            admissions: admissions.rows,
            reservations: reservations.rows,
            matches: matches.rows,
            players: players.rows,
            leases: leases.rows,
            outbox: outbox.rows,
            chatMessages: chatMessages.rows,
            chatStreams: chatStreams.rows,
            matchEvents: matchEvents.rows,
            matchCommands: matchCommands.rows,
            matchResults: matchResults.rows,
            resultSeats: resultSeats.rows,
            statsHeads: statsHeads.rows,
            statsGenerations: statsGenerations.rows,
            statsApplications: statsApplications.rows,
            statsValues: statsValues.rows,
            consumerReceipts: consumerReceipts.rows,
            sessions: result.rows,
            accounts: accounts.rows,
            receipts: receipts.rows,
            flows: flows.rows,
            profiles: profiles.rows,
            settings: settings.rows,
            catalog: catalog.rows,
            rooms: rooms.rows,
            members: members.rows,
            roomCommands: roomCommands.rows,
          });
        } finally {
          await client.end();
        }
      };
      const before = await snapshot();
      if (container) await container.restart();
      else
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
        process.argv.includes("--api-personal")
          ? "Personal finished/terminated Match, bot-seat, event and receipt restart persistence passed."
          : "API session/account/onboarding integration and account/session/receipt/flow/result/statistics restart persistence passed.",
      );
      if (childEnv.TEST_WORKER_REDIS_URL) {
        stage = "Worker cleanup integration";
        // Rebuild reads real finish truth. Run before the outbox quarantine suite
        // deliberately inserts malformed finish-shaped records into this same DB.
        const workerSuites = process.argv.includes("--api-personal")
          ? [["tests/integration/personal-automation.test.ts"]]
          : [
              ["tests/integration/statistics.test.ts"],
              [
                "tests/integration/cleanup.test.ts",
                "tests/integration/outbox.test.ts",
                "tests/integration/match-automation.test.ts",
              ],
            ];
        for (const suites of workerSuites) {
          const workerTests = await run(
            process.execPath,
            [join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"), "run", ...suites],
            {
              cwd: new URL("../../../apps/worker/", import.meta.url),
              env: { ...childEnv, TEST_AUTH_DATABASE_READY: "foundation-completed" },
              timeout: 60000,
              maxBuffer: 4 * 1024 * 1024,
            },
          );
          console.info(workerTests.stdout);
        }
      }
      if (process.env.TEST_RELEASE_BROWSER === "isolated") {
        stage = "release database isolation";
        // Browser actors/results must not share prior fault/quarantine fixtures.
        // Both databases belong to this newly created cluster, never a supplied endpoint.
        const browserEnv = { ...childEnv, TEST_AUTH_DATABASE_READY: "foundation-completed" };
        const create = new pg.Client({ connectionString: adminUrl });
        await create.connect();
        try {
          await create.query("CREATE DATABASE hambazi_release");
          await create.query("REVOKE ALL ON DATABASE hambazi_release FROM PUBLIC");
          await create.query(
            "GRANT CONNECT ON DATABASE hambazi_release TO hambazi_api, hambazi_worker, hambazi_migrator",
          );
        } finally {
          await create.end();
        }
        for (const key of [
          "API_DATABASE_URL",
          "WORKER_DATABASE_URL",
          "MIGRATION_DATABASE_URL",
          "TEST_DATABASE_URL",
        ]) {
          const url = new URL(browserEnv[key]);
          url.pathname = "/hambazi_release";
          browserEnv[key] = url.toString();
        }
        const grants = new pg.Client({ connectionString: browserEnv.TEST_DATABASE_URL });
        await grants.connect();
        try {
          await grants.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
          await grants.query("GRANT USAGE ON SCHEMA public TO hambazi_api, hambazi_worker");
          await grants.query("GRANT USAGE, CREATE ON SCHEMA public TO hambazi_migrator");
        } finally {
          await grants.end();
        }
        await run(process.execPath, [new URL("migrate.mjs", import.meta.url).pathname], {
          cwd,
          env: browserEnv,
          timeout: 120000,
          maxBuffer: 4 * 1024 * 1024,
        });
        stage = "release browser integration";
        const browser = await run(
          "pnpm",
          ["--filter", "@hambazi/web", "test:browser", "--config", "release.playwright.config.ts"],
          {
            cwd: new URL("../../../", import.meta.url),
            env: browserEnv,
            timeout: 360000,
            maxBuffer: 4 * 1024 * 1024,
          },
        );
        console.info(browser.stdout);
      }
    }
    if (process.env.TEST_RESTORE_DRILL === "isolated") {
      stage = "disposable backup restore drill";
      const result = await restoreDrill({ bin, path, env: childEnv });
      console.info(
        `Disposable logical backup/restore reconciled ${result.tables} tables, constraints, triggers and grants; source preserved.`,
      );
    }
  } catch (error) {
    if (stage === "release browser integration" && error && typeof error === "object") {
      const diagnostic = `${"stdout" in error ? String(error.stdout) : ""}\n${"stderr" in error ? String(error.stderr) : ""}`;
      const locations = new Set(diagnostic.match(/tests\/release\/mvp\.spec\.ts:\d+:\d+/g) ?? []);
      for (const location of locations)
        console.error(`Release browser failure location: ${location}`);
    }
    if (
      stage === "release browser integration" &&
      error &&
      typeof error === "object" &&
      "stderr" in error
    ) {
      for (const line of String(error.stderr).split("\n")) {
        const failure = line.match(/RELEASE_FIXTURE_FAILED at [A-Za-z ]+/);
        if (failure) console.error(failure[0]);
        if (
          line.startsWith("Error: Process from config.webServer") ||
          line.startsWith("Error: Timed out waiting")
        )
          console.error(line);
      }
    }
    if (error instanceof RestoreDrillError) console.error(`RESTORE_DRILL_FAILED at ${error.stage}`);
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
        if (container) await container.stop();
        else await run(join(bin, "pg_ctl"), ["-D", join(path, "data"), "-m", "fast", "-w", "stop"]);
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
