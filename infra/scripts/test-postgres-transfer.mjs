import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify, parseEnv, isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { createLocalEnvironment } from "./create-local-env.mjs";
import { startIsolatedPostgres } from "./isolated-postgres.mjs";

const pg = createRequire(new URL("../../packages/database/package.json", import.meta.url))("pg");
const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "hambazi-image-transfer-"));
let source,
  target,
  stage = "setup",
  clean = true;
async function port() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const value = server.address().port;
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  return value;
}
async function connection(url, work) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    return await work(client);
  } finally {
    await client.end();
  }
}
async function snapshot(url) {
  return connection(url, async (client) => {
    const tables = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename COLLATE \"C\"",
    );
    const rows = {};
    for (const { tablename } of tables.rows) {
      if (!/^[a-z_]+$/.test(tablename)) throw new Error();
      rows[tablename] = (
        await client.query(
          `SELECT count(*)::text AS count, md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text) COLLATE "C"), '')) AS digest FROM "${tablename}" t`,
        )
      ).rows[0];
    }
    const definitions = await client.query(
      'SELECT conname, contype, pg_get_constraintdef(oid,true) AS definition FROM pg_constraint WHERE connamespace=\'public\'::regnamespace ORDER BY conname COLLATE "C", pg_get_constraintdef(oid,true) COLLATE "C"',
    );
    const triggers = await client.query(
      'SELECT tgname, pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace=\'public\'::regnamespace) ORDER BY tgname COLLATE "C", pg_get_triggerdef(oid) COLLATE "C"',
    );
    const grants = await client.query(
      'SELECT grantee,table_name,privilege_type FROM information_schema.role_table_grants WHERE table_schema=\'public\' ORDER BY grantee COLLATE "C",table_name COLLATE "C",privilege_type COLLATE "C"',
    );
    const columns = await client.query(
      'SELECT grantee,table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE table_schema=\'public\' ORDER BY grantee COLLATE "C",table_name COLLATE "C",column_name COLLATE "C",privilege_type COLLATE "C"',
    );
    return {
      rows,
      definitions: definitions.rows,
      triggers: triggers.rows,
      grants: grants.rows,
      columns: columns.rows,
    };
  });
}
try {
  await createLocalEnvironment(directory);
  const credentials = parseEnv(await readFile(join(directory, ".env"), "utf8"));
  source = await startIsolatedPostgres({
    directory,
    port: await port(),
    credentials,
    legacy: true,
  });
  target = await startIsolatedPostgres({ directory, port: await port(), credentials });
  function environment(instance) {
    const env = {
      ...process.env,
      ...credentials,
      TEST_DATABASE_CONFIRM: "isolated-hambazi-test",
      TEST_DATABASE_RUN_ID: randomBytes(8).toString("hex"),
    };
    for (const key of ["API_DATABASE_URL", "WORKER_DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
      const url = new URL(credentials[key]);
      url.hostname = "127.0.0.1";
      url.port = String(instance.port);
      env[key] = url.href;
    }
    env.TEST_DATABASE_URL = `postgresql://hambazi_local_admin:${credentials.POSTGRES_PASSWORD}@127.0.0.1:${instance.port}/hambazi`;
    return env;
  }
  const oldEnv = environment(source),
    newEnv = environment(target);
  stage = "legacy migrations";
  await run("pnpm", ["--filter", "@hambazi/database", "db:migrate"], {
    env: oldEnv,
    timeout: 120000,
    maxBuffer: 4194304,
  });
  stage = "legacy fixture tests";
  const tests = await run("pnpm", ["--filter", "@hambazi/database", "test:integration"], {
    env: oldEnv,
    timeout: 120000,
    maxBuffer: 4194304,
  });
  stage = "legacy fixture count";
  if (!/Tests\s+17 passed/.test(tests.stdout)) throw new Error();
  stage = "Unicode fixture";
  await connection(oldEnv.TEST_DATABASE_URL, (c) =>
    c.query(
      "UPDATE users SET display_name=$1, profile_version=profile_version+1, updated_at=now()",
      ["همبازی 🙂 é É"],
    ),
  );
  stage = "source snapshot";
  const before = await snapshot(oldEnv.TEST_DATABASE_URL);
  if (before.rows.game_events?.count !== "1") throw new Error();
  stage = "legacy volume guard";
  const lock = JSON.parse(
    await readFile(new URL("../docker/postgres/image-lock.json", import.meta.url), "utf8"),
  );
  let denied = false;
  try {
    await run(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--label",
        "hambazi.test=image-guard",
        "--volume",
        `${source.volume}:/var/lib/postgresql:ro`,
        "--mount",
        `type=bind,source=${fileURLToPath(new URL("../docker/postgres/start.sh", import.meta.url))},target=/usr/local/bin/hambazi-postgres.sh,readonly`,
        "--entrypoint",
        "/bin/sh",
        lock.image,
        "/usr/local/bin/hambazi-postgres.sh",
        "postgres",
      ],
      { timeout: 10000 },
    );
  } catch (e) {
    denied = e.code === 78 && String(e.stderr).includes("POSTGRES_IMAGE_MIGRATION_REQUIRED");
  }
  if (!denied || !isDeepStrictEqual(before, await snapshot(oldEnv.TEST_DATABASE_URL)))
    throw new Error();
  stage = "logical transfer";
  await run(
    "docker",
    [
      "exec",
      source.name,
      "pg_dump",
      "-U",
      "hambazi_local_admin",
      "-d",
      "hambazi",
      "-Fc",
      "--file",
      "/tmp/hambazi-transfer.dump",
    ],
    { timeout: 30000 },
  );
  const archive = join(directory, "transfer.dump");
  await run("docker", ["cp", `${source.name}:/tmp/hambazi-transfer.dump`, archive]);
  await chmod(archive, 0o600);
  await run("docker", ["cp", archive, `${target.name}:/tmp/hambazi-transfer.dump`]);
  await run(
    "docker",
    [
      "exec",
      target.name,
      "pg_restore",
      "--exit-on-error",
      "-U",
      "hambazi_local_admin",
      "-d",
      "hambazi",
      "/tmp/hambazi-transfer.dump",
    ],
    { timeout: 30000, maxBuffer: 4194304 },
  );
  stage = "reconciliation";
  if (!isDeepStrictEqual(before, await snapshot(newEnv.TEST_DATABASE_URL))) throw new Error();
  for (const [url, provider, locale] of [
    [oldEnv.TEST_DATABASE_URL, "c", null],
    [newEnv.TEST_DATABASE_URL, "b", "C.UTF-8"],
  ]) {
    const result = await connection(url, (c) =>
      c.query(
        "SELECT current_setting('server_version_num')::int AS version, datlocprovider,datlocale,pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname=current_database()",
      ),
    );
    const row = result.rows[0];
    if (
      row.version !== 180006 ||
      row.datlocprovider !== provider ||
      row.datlocale !== locale ||
      row.encoding !== "UTF8"
    )
      throw new Error();
  }
  stage = "role and guard compatibility";
  for (const key of ["API_DATABASE_URL", "WORKER_DATABASE_URL"])
    await connection(newEnv[key], async (c) => {
      await c.query("SELECT count(*) FROM matches");
      let denied = false;
      try {
        await c.query("CREATE TABLE public.image_denied(id int)");
      } catch (e) {
        denied = e.code === "42501";
      }
      if (!denied) throw new Error();
    });
  await connection(newEnv.TEST_DATABASE_URL, async (c) => {
    await c.query("BEGIN");
    let denied = false;
    try {
      await c.query("DELETE FROM game_events");
    } catch {
      denied = true;
    }
    await c.query("ROLLBACK");
    if (!denied) throw new Error();
  });
  stage = "restart persistence";
  await target.restart();
  if (
    !isDeepStrictEqual(before, await snapshot(newEnv.TEST_DATABASE_URL)) ||
    !isDeepStrictEqual(before, await snapshot(oldEnv.TEST_DATABASE_URL))
  )
    throw new Error();
  console.info(
    `PostgreSQL image transfer passed: 17 legacy fixture tests, ${Object.keys(before.rows).length} tables reconciled, Unicode/JSONB/constraints/triggers/grants preserved, legacy guard and runtime roles enforced, restart persisted; source untouched.`,
  );
} catch {
  console.error(
    `POSTGRES_IMAGE_TRANSFER_FAILED at ${stage}; no raw data or credentials are printed.`,
  );
  process.exitCode = 1;
} finally {
  for (const instance of [target, source])
    if (instance)
      try {
        await instance.stop();
      } catch {
        clean = false;
      }
  if (clean) await rm(directory, { recursive: true, force: true });
  else {
    console.error("POSTGRES_IMAGE_TRANSFER_CLEANUP_FAILED; private test artifacts preserved.");
    process.exitCode = 1;
  }
}
