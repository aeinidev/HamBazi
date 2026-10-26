import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import process from "node:process";
import { URL } from "node:url";
import { setTimeout } from "node:timers";
const run = promisify(execFile);
const require = createRequire(
  new URL("../../../../packages/database/package.json", import.meta.url),
);
const { Client } = require("pg");
const directory = await mkdtemp(join(tmpdir(), "hambazi-admin-disposable-"));
const name = `hambazi-admin-test-${randomBytes(6).toString("hex")}`;
// Existing local image, pinned digest. No target URL or running application DB is accepted.
const image = "postgres@sha256:3725f4e2499eef5134592b3b4ab79a543ed7f8e533b05b5b637af926630f6650";
const redisImage =
  "redis:8.10.2-alpine3.23@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0";
const redisName = name + "-redis";
const password = randomBytes(24).toString("hex");
let started = false,
  stage = "container";
let volumeCreated = false;
let redisStarted = false;
try {
  const envFile = join(directory, "postgres.env");
  await writeFile(envFile, `POSTGRES_PASSWORD=${password}\nPOSTGRES_DB=hambazi\n`, { mode: 0o600 });
  await run("docker", [
    "volume",
    "create",
    "--label",
    "hambazi.purpose=disposable-admin-test",
    name,
  ]);
  volumeCreated = true;
  await run(
    "docker",
    [
      "run",
      "--pull=never",
      "--detach",
      "--rm",
      "--name",
      name,
      "--label",
      "hambazi.purpose=disposable-admin-test",
      "--publish",
      "127.0.0.1::5432",
      "--mount",
      `type=volume,src=${name},dst=/var/lib/postgresql`,
      "--env-file",
      envFile,
      image,
    ],
    { timeout: 30000 },
  );
  started = true;
  const port = (
    await run("docker", [
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
      name,
    ])
  ).stdout.trim();
  const redisFile = join(directory, "redis.conf");
  await writeFile(
    redisFile,
    `bind 0.0.0.0\nprotected-mode yes\nrequirepass ${password}\nsave ""\nappendonly no\n`,
    { mode: 0o600 },
  );
  await run(
    "docker",
    [
      "run",
      "--pull=never",
      "--detach",
      "--rm",
      "--name",
      redisName,
      "--user",
      `${process.getuid()}:${process.getgid()}`,
      "--label",
      "hambazi.purpose=disposable-admin-test",
      "--publish",
      "127.0.0.1::6379",
      "--mount",
      `type=bind,src=${redisFile},dst=/private/redis.conf,readonly`,
      redisImage,
      "redis-server",
      "/private/redis.conf",
    ],
    { timeout: 30000 },
  );
  redisStarted = true;
  const redisPort = (
    await run("docker", [
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "6379/tcp") 0).HostPort}}',
      redisName,
    ])
  ).stdout.trim();
  const url = (role) => `postgresql://${role}:${password}@127.0.0.1:${port}/hambazi`;
  let root;
  for (let i = 0; i < 60; i++) {
    const c = new Client({ connectionString: url("postgres"), connectionTimeoutMillis: 1000 });
    try {
      await c.connect();
      root = c;
      break;
    } catch {
      await c.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!root) throw new Error();
  stage = "roles and migrations";
  try {
    for (const role of [
      "hambazi_api",
      "hambazi_worker",
      "hambazi_migrator",
      "hambazi_admin_runtime",
      "hambazi_admin_bootstrap",
      "hambazi_admin_recovery",
      "hambazi_admin_reader",
    ])
      await root.query(
        `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`,
      );
    await root.query(
      "REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE,CREATE ON SCHEMA public TO hambazi_migrator; GRANT USAGE ON SCHEMA public TO hambazi_api,hambazi_worker",
    );
  } finally {
    await root.end();
  }
  const env = {
    ...process.env,
    MIGRATION_DATABASE_URL: url("hambazi_migrator"),
    TEST_ADMIN_DATABASE_URL: url("postgres"),
    TEST_ADMIN_RUNTIME_URL: url("hambazi_admin_runtime"),
    TEST_ADMIN_BOOTSTRAP_URL: url("hambazi_admin_bootstrap"),
    TEST_ADMIN_RECOVERY_URL: url("hambazi_admin_recovery"),
    TEST_ADMIN_READER_URL: url("hambazi_admin_reader"),
    TEST_ADMIN_CONFIRM: "owned-disposable-admin",
    TEST_ADMIN_CONTAINER: name,
    TEST_ADMIN_REDIS_URL: `redis://:${password}@127.0.0.1:${redisPort}/0`,
    TEST_ADMIN_TLS_KEY: join(directory, "key.pem"),
    TEST_ADMIN_TLS_CERT: join(directory, "cert.pem"),
  };
  for (let n = 0; n < 2; n++)
    await run("pnpm", ["--filter", "@hambazi/database", "db:migrate"], {
      env,
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
    });
  const grant = new Client({ connectionString: url("postgres") });
  await grant.connect();
  try {
    await grant.query(
      await readFile(
        new URL("../../../../packages/database/prisma/admin-permissions.sql", import.meta.url),
        "utf8",
      ),
    );
  } finally {
    await grant.end();
  }
  await run(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      env.TEST_ADMIN_TLS_KEY,
      "-out",
      env.TEST_ADMIN_TLS_CERT,
      "-days",
      "1",
      "-subj",
      "/CN=admin.local",
      "-addext",
      "subjectAltName=DNS:admin.local,IP:127.0.0.1",
    ],
    { timeout: 10000 },
  );
  stage = "integration and TLS security";
  const tests = await run(
    "pnpm",
    ["--filter", "@hambazi/api", "exec", "vitest", "run", "tests/integration/admin-local.test.ts"],
    { env, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
  );
  const summary = tests.stdout.match(/Test Files[^\n]*|Tests\s+[^\n]*/g) ?? [];
  for (const line of summary) process.stdout.write(line + "\n");
  process.stdout.write("ADMIN_DISPOSABLE_INTEGRATION_PASSED\n");
} catch (error) {
  const stderr =
    error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
  const safe = stderr.match(/DATABASE_MIGRATION_FAILED at [a-z ]+(?: \([A-Z0-9_, ]+\))?/);
  if (safe) process.stderr.write(safe[0] + "\n");
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    /^[0-9A-Z_]{3,20}$/.test(String(error.code))
  )
    process.stderr.write(`ADMIN_TEST_ERROR_CODE:${error.code}\n`);
  // Source locations/test names only, not SQL, assertion data, credential files or commands.
  for (const line of stderr.split("\n")) {
    if (/^ FAIL\s+tests\/integration\/admin-local/.test(line)) process.stderr.write(line + "\n");
    const location = line.match(/tests\/integration\/admin-local.test.ts:\d+:\d+/);
    if (location) process.stderr.write(location[0] + "\n");
    const fixed = line.match(/ADMIN_TEST_[A-Z_]+/);
    if (fixed) process.stderr.write(fixed[0] + "\n");
  }
  process.stderr.write(`ADMIN_DISPOSABLE_TEST_FAILED:${stage}\n`);
  process.exitCode = 1;
} finally {
  if (redisStarted)
    try {
      await run("docker", ["rm", "--force", redisName], { timeout: 20000 });
    } catch {
      process.exitCode = 1;
      process.stderr.write("ADMIN_REDIS_TEST_CLEANUP_FAILED\n");
    }
  let stopped = !started;
  if (started)
    try {
      await run("docker", ["stop", "--time", "10", name], { timeout: 20000 });
      stopped = true;
    } catch {
      process.exitCode = 1;
      process.stderr.write("ADMIN_TEST_CLEANUP_FAILED\n");
    }
  if (stopped && volumeCreated) {
    for (let n = 0; n < 20; n++) {
      try {
        await run("docker", ["volume", "rm", name]);
        volumeCreated = false;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (volumeCreated) {
      process.exitCode = 1;
      process.stderr.write("ADMIN_TEST_VOLUME_CLEANUP_FAILED\n");
    }
  }
  if (stopped) await rm(directory, { recursive: true, force: true });
}
