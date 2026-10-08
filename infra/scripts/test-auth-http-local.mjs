import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { promisify, parseEnv } from "node:util";
import { parse } from "yaml";
import { createLocalEnvironment } from "./create-local-env.mjs";

const run = promisify(execFile);
if (!process.env.TEST_POSTGRES_BIN)
  throw new Error("Supply TEST_POSTGRES_BIN for the isolated native PostgreSQL harness");
for (const executable of ["initdb", "pg_ctl", "psql"])
  await access(join(process.env.TEST_POSTGRES_BIN, executable), constants.X_OK);
const directory = await mkdtemp(join(tmpdir(), "hambazi-auth-http-"));
const name = `hambazi-auth-http-${randomUUID()}`;
let attempted = false;
let env = {};
let stage = "environment";
try {
  await createLocalEnvironment(directory);
  env = parseEnv(await readFile(join(directory, ".env"), "utf8"));
  const compose = parse(await readFile(new URL("../docker/compose.yaml", import.meta.url), "utf8"));
  const image = compose.services.redis.image;
  if (!/^redis:[^@]+@sha256:[a-f0-9]{64}$/.test(image))
    throw new Error("Expected pinned Redis image");
  // Docker's automatic published port can change on stop/start; keep this test endpoint stable.
  const reservation = createServer();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Expected a loopback test port");
  const requestedPort = address.port;
  await new Promise((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  attempted = true;
  stage = "Redis container startup";
  await run(
    "docker",
    [
      "run",
      "--detach",
      "--name",
      name,
      "--label",
      "hambazi.test=auth-http",
      "--user",
      "redis",
      "--env-file",
      join(directory, ".env"),
      "--publish",
      `127.0.0.1:${requestedPort}:6379`,
      "--tmpfs",
      "/tmp:mode=1777",
      "--tmpfs",
      "/data:mode=1777",
      "--mount",
      `type=bind,source=${resolve("infra/docker/redis/start.sh")},target=/usr/local/bin/hambazi-redis.sh,readonly`,
      "--entrypoint",
      "/bin/sh",
      image,
      "/usr/local/bin/hambazi-redis.sh",
    ],
    { timeout: 60000 },
  );
  stage = "Redis authenticated health";
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const probe = await run(
        "docker",
        [
          "exec",
          name,
          "sh",
          "-c",
          'REDISCLI_AUTH="$REDIS_HEALTH_PASSWORD" redis-cli --user health ping',
        ],
        { timeout: 2000 },
      );
      if (probe.stdout.trim() === "PONG") {
        ready = true;
        break;
      }
    } catch {
      /* Only this disposable service is probed, and diagnostics contain no credentials. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error("Isolated Redis did not become ready");
  stage = "Redis loopback port";
  const published = await run("docker", ["port", name, "6379/tcp"]);
  const port = /^127\.0\.0\.1:(\d+)\s*$/.exec(published.stdout)?.[1];
  if (!port) throw new Error("Expected loopback-only Redis binding");
  const url = `redis://api:${env.REDIS_API_PASSWORD}@127.0.0.1:${port}/0`;
  stage = "PostgreSQL and HTTP integration";
  const result = await run(
    "pnpm",
    [process.argv.includes("--personal") ? "test:personal:local" : "test:auth:local"],
    {
      env: {
        ...process.env,
        TEST_AUTH_REDIS_URL: url,
        TEST_AUTH_REDIS_CONTAINER: name,
        TEST_WORKER_REDIS_URL: `redis://worker:${env.REDIS_WORKER_PASSWORD}@127.0.0.1:${port}/0`,
      },
      timeout: process.env.TEST_RELEASE_BROWSER === "isolated" ? 600000 : 240000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  console.info(result.stdout);
  console.info(
    "Isolated HTTP/PostgreSQL/Redis integration passed; no live Telegram credentials were used.",
  );
} catch (error) {
  let output = error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
  for (const [key, value] of Object.entries(env))
    if (key.endsWith("PASSWORD")) output = output.replaceAll(value, "[REDACTED]");
  if (output) console.error(output);
  if (error && typeof error === "object" && "stderr" in error) {
    const safe = String(error.stderr)
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("DATABASE_LOCAL_TEST_FAILED at ") ||
          line.startsWith("RESTORE_DRILL_FAILED at ") ||
          line.startsWith("Integration failure location: ") ||
          line.startsWith("Release browser failure location: ") ||
          line.startsWith("RELEASE_FIXTURE_FAILED at ") ||
          line.startsWith("Error: Process from config.webServer") ||
          line.startsWith("Error: Timed out waiting") ||
          /^ FAIL {2}tests\/integration\/[A-Za-z0-9_.-]+/.test(line),
      );
    if (safe.length) console.error(safe.join("\n"));
  }
  console.error(
    `AUTH_HTTP_LOCAL_TEST_FAILED at ${stage}; raw service/connection diagnostics are suppressed.`,
  );
  process.exitCode = 1;
} finally {
  let stopped = !attempted;
  if (attempted) {
    try {
      await run("docker", ["rm", "--force", name], { timeout: 15000 });
      stopped = true;
    } catch {
      console.error(
        "Could not remove the harness-owned Redis container; temporary environment preserved.",
      );
      process.exitCode = 1;
    }
  }
  if (stopped) await rm(directory, { recursive: true, force: true });
}
