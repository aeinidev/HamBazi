import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { promisify, parseEnv } from "node:util";
import { parse } from "yaml";
import { createLocalEnvironment } from "./create-local-env.mjs";
import { startIsolatedPostgres } from "./isolated-postgres.mjs";

const run = promisify(execFile);
async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
const require = createRequire(new URL("../../packages/database/package.json", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "hambazi-kahroba-"));
const name = `hambazi-auth-http-${randomUUID()}`;
let postgres,
  redisStarted = false,
  stage = "environment",
  credentials = {};
try {
  await createLocalEnvironment(directory);
  credentials = parseEnv(await readFile(join(directory, ".env"), "utf8"));
  stage = "isolated PostgreSQL";
  postgres = await startIsolatedPostgres({ directory, port: await reservePort(), credentials });
  stage = "isolated Redis";
  const compose = parse(await readFile(new URL("../docker/compose.yaml", import.meta.url), "utf8"));
  redisStarted = true;
  const redisRequestedPort = await reservePort();
  await run(
    "docker",
    [
      "run",
      "--detach",
      "--name",
      name,
      "--label",
      "hambazi.test=kahroba-k2",
      "--user",
      "redis",
      "--env-file",
      join(directory, ".env"),
      "--publish",
      `127.0.0.1:${redisRequestedPort}:6379`,
      "--tmpfs",
      "/tmp:mode=1777",
      "--tmpfs",
      "/data:mode=1777",
      "--mount",
      `type=bind,source=${resolve("infra/docker/redis/start.sh")},target=/usr/local/bin/hambazi-redis.sh,readonly`,
      "--entrypoint",
      "/bin/sh",
      compose.services.redis.image,
      "/usr/local/bin/hambazi-redis.sh",
    ],
    { timeout: 60000 },
  );
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await run("docker", [
        "exec",
        name,
        "sh",
        "-c",
        'REDISCLI_AUTH="$REDIS_HEALTH_PASSWORD" redis-cli --user health ping',
      ]);
      if (r.stdout.trim() === "PONG") break;
    } catch {
      /* Only the disposable service is probed; raw diagnostics stay private. */
    }
    if (attempt >= 40) throw new Error();
    await new Promise((r) => setTimeout(r, 200));
  }
  const published = await run("docker", ["port", name, "6379/tcp"]);
  const redisPort = /^127\.0\.0\.1:(\d+)\s*$/.exec(published.stdout)?.[1];
  if (!redisPort) throw new Error();
  const childEnv = {
    ...process.env,
    ...credentials,
    TEST_DATABASE_CONFIRM: "isolated-hambazi-test",
    TEST_AUTH_DATABASE_READY: "foundation-completed",
    TEST_DATABASE_RUN_ID: randomUUID(),
    TEST_AUTH_REDIS_CONTAINER: name,
    TEST_KAHROBA_POSTGRES_CONTAINER: postgres.name,
    TEST_KAHROBA_RUN: "isolated-k2",
    ...(process.argv.includes("--runtime") ? { TEST_KAHROBA_RUNTIME: "isolated-k4a" } : {}),
  };
  for (const key of ["API_DATABASE_URL", "WORKER_DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
    const u = new URL(credentials[key]);
    u.port = String(postgres.port);
    childEnv[key] = u.toString();
  }
  childEnv.TEST_DATABASE_URL = `postgresql://hambazi_local_admin:${credentials.POSTGRES_PASSWORD}@127.0.0.1:${postgres.port}/hambazi`;
  childEnv.TEST_AUTH_REDIS_URL = `redis://api:${credentials.REDIS_API_PASSWORD}@127.0.0.1:${redisPort}/0`;
  childEnv.TEST_WORKER_REDIS_URL = `redis://worker:${credentials.REDIS_WORKER_PASSWORD}@127.0.0.1:${redisPort}/0`;
  // Apply only the repository's existing schema to this freshly owned disposable database.
  stage = "existing schema initialization";
  await run(process.execPath, [resolve("packages/database/scripts/migrate.mjs")], {
    cwd: resolve("packages/database"),
    env: childEnv,
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
  async function suite(owner, file) {
    stage = `${owner} ${file}`;
    const r = await run(process.execPath, [vitest, "run", file], {
      cwd: resolve(owner),
      env: childEnv,
      timeout: process.argv.includes("--runtime") ? 600000 : 180000,
      maxBuffer: 8 * 1024 * 1024,
    });
    console.info(r.stdout);
  }
  await suite("packages/database", "tests/integration");
  const apiSuites = [
    "sessions.test.ts",
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
    "kahroba.test.ts",
  ];
  for (const file of process.argv.includes("--outbox-only")
    ? []
    : process.argv.includes("--bot-regression")
      ? ["sessions.test.ts", "bot-delivery.test.mjs"]
      : process.argv.includes("--runtime")
        ? ["kahroba-runtime.test.mjs"]
        : process.argv.includes("--kahroba-only")
          ? ["kahroba.test.ts"]
          : apiSuites)
    await suite("apps/api", `tests/integration/${file}`);
  // Rebuild before the existing outbox quarantine suite inserts deliberately corrupt truth.
  const workerSuites = [
    "statistics.test.ts",
    "kahroba.test.ts",
    "cleanup.test.ts",
    "outbox.test.ts",
    "match-automation.test.ts",
    "personal-automation.test.ts",
  ];
  for (const file of process.argv.includes("--outbox-only")
    ? ["outbox.test.ts"]
    : process.argv.includes("--bot-regression")
      ? []
      : process.argv.includes("--runtime")
        ? ["kahroba.test.ts"]
        : process.argv.includes("--kahroba-only")
          ? ["kahroba.test.ts"]
          : workerSuites)
    await suite("apps/worker", `tests/integration/${file}`);
  console.info(
    "KAHROBA_K2_LOCAL_PASSED: fresh PostgreSQL/Redis, uncached API/Worker integration inventory; no deployment.",
  );
} catch (error) {
  let output = error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
  for (const [key, value] of Object.entries(credentials))
    if (key.endsWith("PASSWORD")) output = output.replaceAll(value, "[REDACTED]");
  if (output) console.error(output);
  const diagnostic =
    error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
  for (const line of diagnostic.split("\n")) {
    if (/^Error: [A-Za-z]+ fixture failed(?:: [A-Z_]+)?$/.test(line)) console.error(line);
    if (
      /^(?:Error: (?:Local command failed: [A-Z_]+|Local snapshot unavailable|Private [A-Za-z ]+ failed|Signed local authentication failed|Local runtime condition timed out)|TimeoutError: (?:locator\.[A-Za-z]+|page\.[A-Za-z]+): Timeout \d+ms exceeded\.)$/.test(
        line,
      )
    )
      console.error(line);
    if (/^ FAIL {2}tests\/integration\/[A-Za-z0-9_.-]+/.test(line)) console.error(line);
    const frame = line.match(/tests\/(?:integration|fixtures)\/[A-Za-z0-9_.-]+:\d+:\d+/);
    if (frame) console.error(`Integration failure location: ${frame[0]}`);
  }
  console.error(
    `KAHROBA_K2_LOCAL_FAILED at ${stage}; raw connection/service diagnostics suppressed.`,
  );
  process.exitCode = 1;
} finally {
  let stopped = true;
  if (redisStarted)
    try {
      await run("docker", ["rm", "--force", name], { timeout: 15000 });
    } catch {
      stopped = false;
    }
  if (postgres)
    try {
      await postgres.stop();
    } catch {
      stopped = false;
    }
  if (stopped) await rm(directory, { recursive: true, force: true });
  else {
    console.error("Harness-owned service cleanup failed; private directory preserved.");
    process.exitCode = 1;
  }
}
