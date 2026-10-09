import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parse } from "yaml";
import { startIsolatedPostgres } from "../scripts/isolated-postgres.mjs";
import { runGate } from "../ci/gates.mjs";
import { validateInventory } from "./prepare.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
let stage = "inventory",
  checks = 0;
const assert = (condition) => {
  if (!condition) throw new Error("PACKAGING_CHECK_FAILED");
  checks++;
};
const run = (command, args, options = {}) =>
  runGate(`packaging-smoke-${stage}`, command, args, { cwd: root, ...options });
const delay = () => new Promise((accept) => setTimeout(accept, 200));
const containers = [];
let postgres;
let rollbackManifest;
let evidence;
const releaseRehearsal = process.argv.length === 5 && process.argv[3] === "--rollback-to";
const directory = await mkdtemp(join(tmpdir(), "hambazi-packaging-smoke-"));
try {
  if (process.argv.length !== 3 && !releaseRehearsal) throw new Error();
  const manifest = JSON.parse(await readFile(resolve(process.argv[2]), "utf8"));
  assert(
    manifest.purpose === "local-packaging-candidate" &&
      manifest.productionReleaseApproved === false &&
      manifest.images?.length === 4,
  );
  const images = Object.fromEntries(manifest.images.map(({ role, image }) => [role, image]));
  if (releaseRehearsal) {
    validateInventory(
      manifest,
      JSON.parse(await readFile(`${resolve(process.argv[2])}.scan.json`, "utf8")),
    );
    rollbackManifest = JSON.parse(await readFile(resolve(process.argv[4]), "utf8"));
    validateInventory(
      rollbackManifest,
      JSON.parse(await readFile(`${resolve(process.argv[4])}.scan.json`, "utf8")),
    );
    assert(
      JSON.stringify(manifest.browserPolicy) === JSON.stringify(rollbackManifest.browserPolicy),
    );
    assert(
      manifest.images.every((entry, index) => entry.image !== rollbackManifest.images[index].image),
    );
  }
  for (const role of ["api", "bot", "worker", "web"]) {
    assert(
      new RegExp(`^hambazi-candidate/${role}:[a-f0-9]{40}-[a-f0-9]{16}@sha256:[a-f0-9]{64}$`).test(
        images[role] ?? "",
      ),
    );
    stage = `${role}-filesystem`;
    const probe =
      "import fs from 'node:fs'; if(process.getuid()!==1000)process.exit(1); for(const p of ['/app/tests','/app/.env','/app/node_modules/typescript','/app/node_modules/vitest','/usr/local/bin/npm'])if(fs.existsSync(p))process.exit(1);";
    await run("docker", [
      "run",
      "--rm",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      images[role],
      "--input-type=module",
      "-e",
      probe,
    ]);
    checks++;
  }
  for (const role of ["api", "bot", "worker"]) {
    stage = `${role}-invalid-config`;
    const code = await run("docker", [
      "create",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      images[role],
    ]);
    const name = code.trim();
    containers.push(name);
    await run("docker", ["start", name]);
    assert((await run("docker", ["wait", name])).trim() === "1");
    const output = await run("docker", ["logs", name]);
    assert(!/token|initData|credential|stack|Error:/.test(output));
  }
  const credentials = Object.fromEntries(
    [
      "POSTGRES_PASSWORD",
      "POSTGRES_API_PASSWORD",
      "POSTGRES_WORKER_PASSWORD",
      "POSTGRES_MIGRATOR_PASSWORD",
      "REDIS_API_PASSWORD",
      "REDIS_WORKER_PASSWORD",
      "REDIS_HEALTH_PASSWORD",
    ].map((name) => [name, randomBytes(32).toString("hex")]),
  );
  stage = "postgres";
  postgres = await startIsolatedPostgres({ directory, port: 0, credentials });
  const migrationUrl = `postgresql://hambazi_migrator:${credentials.POSTGRES_MIGRATOR_PASSWORD}@127.0.0.1:${postgres.port}/hambazi`;
  stage = "migration";
  await run("pnpm", ["--filter", "@hambazi/database", "db:migrate"], {
    env: { ...process.env, MIGRATION_DATABASE_URL: migrationUrl },
  });
  await run("pnpm", ["--filter", "@hambazi/database", "db:migrate"], {
    env: { ...process.env, MIGRATION_DATABASE_URL: migrationUrl },
  });
  checks += 2;
  const compose = parse(await readFile(join(root, "infra/docker/compose.yaml"), "utf8"));
  async function envFile(name, values) {
    const path = join(directory, `${name}.env`);
    await writeFile(
      path,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
      { flag: "wx", mode: 0o600 },
    );
    return path;
  }
  stage = "redis";
  const redisName = `hambazi-packaging-${randomUUID()}`;
  containers.push(redisName);
  await run("docker", [
    "run",
    "--detach",
    "--name",
    redisName,
    "--network",
    postgres.name,
    "--log-driver=none",
    "--user=redis",
    "--env-file",
    await envFile(
      "redis",
      Object.fromEntries(Object.entries(credentials).filter(([key]) => key.startsWith("REDIS_"))),
    ),
    "--tmpfs",
    "/tmp:mode=1777",
    "--tmpfs",
    "/data:mode=1777",
    "--mount",
    `type=bind,source=${join(root, "infra/docker/redis/start.sh")},target=/start.sh,readonly`,
    "--entrypoint",
    "/bin/sh",
    compose.services.redis.image,
    "/start.sh",
  ]);
  let redisReady = false;
  for (let i = 0; i < 60; i++) {
    try {
      redisReady =
        (
          await run("docker", [
            "exec",
            redisName,
            "sh",
            "-c",
            'REDISCLI_AUTH="$REDIS_HEALTH_PASSWORD" redis-cli --user health ping',
          ])
        ).trim() === "PONG";
    } catch {
      /* Fixed stage only. */
    }
    if (redisReady) break;
    await delay();
  }
  assert(redisReady);
  stage = "tls";
  await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(directory, "key.pem"),
    "-out",
    join(directory, "cert.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ]);
  await chmod(join(directory, "key.pem"), 0o400);
  const tls = [
    "--mount",
    `type=bind,source=${join(directory, "key.pem")},target=/run/hambazi/tls/key.pem,readonly`,
    "--mount",
    `type=bind,source=${join(directory, "cert.pem")},target=/run/hambazi/tls/cert.pem,readonly`,
  ];
  const token = `123456789:${randomBytes(24).toString("base64url")}`;
  const signing = randomBytes(32).toString("base64url"),
    serviceKey = randomBytes(32).toString("base64url"),
    webhook = randomBytes(32).toString("base64url");
  const apiEnvironment = {
    NODE_ENV: "test",
    API_PORT: "8080",
    API_BIND_ADDRESS: "0.0.0.0",
    API_HEALTH_PORT: "8081",
    API_DATABASE_URL: `postgresql://hambazi_api:${credentials.POSTGRES_API_PASSWORD}@${postgres.name}:5432/hambazi`,
    API_REDIS_URL: `redis://api:${credentials.REDIS_API_PASSWORD}@${redisName}:6379/0`,
    ALLOWED_ORIGINS: "https://mini.example",
    API_DB_POOL_MAX: "5",
    API_TRUSTED_PROXIES: "",
    PROFILE_READ_LIMIT: "60",
    PROFILE_WRITE_LIMIT: "10",
    CATALOG_READ_LIMIT: "60",
    TELEGRAM_BOT_TOKEN: token,
    AUTH_SESSION_SECONDS: "900",
    AUTH_TELEGRAM_MAX_AGE_SECONDS: "300",
    AUTH_TELEGRAM_FUTURE_SKEW_SECONDS: "30",
    AUTH_IP_LIMIT: "30",
    AUTH_IDENTITY_LIMIT: "6",
    AUTH_ACTIVE_KEY_ID: "fixture",
    AUTH_ISSUER: "hambazi:packaging",
    AUTH_AUDIENCE: "packaging",
    AUTH_SIGNING_KEYS: JSON.stringify([{ id: "fixture", secret: signing }]),
    BOT_INTERNAL_ENABLED: "true",
    BOT_INTERNAL_BIND_ADDRESS: "127.0.0.1",
    BOT_INTERNAL_PORT: "9443",
    BOT_INTERNAL_TLS_KEY_FILE: "/run/hambazi/tls/key.pem",
    BOT_INTERNAL_TLS_CERT_FILE: "/run/hambazi/tls/cert.pem",
    BOT_INTERNAL_REQUEST_LIMIT: "100",
    BOT_INTERNAL_IDENTITY_LIMIT: "20",
    BOT_ONBOARDING_LEASE_MS: "15000",
    BOT_SERVICE_ACTIVE_KEY_ID: "fixture",
    BOT_SERVICE_KEYS: JSON.stringify([{ id: "fixture", secret: serviceKey }]),
    BOT_SERVICE_ALLOWED_PEERS: "127.0.0.1",
    TELEGRAM_WEBHOOK_SECRET: webhook,
  };
  const hardening = [
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--tmpfs",
    "/tmp:rw,nosuid,noexec,size=16m,mode=1777",
    "--log-driver=none",
  ];
  async function start(role, values, network = postgres.name, extra = []) {
    stage = `${role}-startup`;
    const name = `hambazi-packaging-${role}-${randomUUID()}`;
    containers.push(name);
    await run("docker", [
      "run",
      "--detach",
      "--name",
      name,
      "--network",
      network,
      ...hardening,
      "--env-file",
      await envFile(`${role}-${containers.length}`, values),
      ...extra,
      images[role],
    ]);
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        await run("docker", ["exec", name, "node", "/opt/hambazi/healthcheck.mjs"]);
        ready = true;
        break;
      } catch {
        /* Private details are discarded. */
      }
      await delay();
    }
    assert(ready);
    assert(
      (await run("docker", ["exec", name, "node", "-p", "process.getuid()"])).trim() === "1000",
    );
    return name;
  }
  let api = await start("api", apiEnvironment, postgres.name, [
    ...tls,
    "--publish",
    "127.0.0.1::8080",
  ]);
  stage = "api-account-session";
  const binding = (await run("docker", ["port", api, "8080/tcp"])).trim();
  assert(/^127\.0\.0\.1:\d+$/.test(binding));
  const origin = `http://${binding}`;
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 777000456, first_name: "Synthetic" }),
  });
  const data = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", key).update(data).digest("hex"));
  const body = { schemaVersion: 1, commandId: randomUUID(), initData: params.toString() };
  const create = await fetch(origin + "/v1/auth/telegram-mini-app/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, displayName: "Packaging fixture" }),
    signal: AbortSignal.timeout(5000),
  });
  assert(create.status === 201 || create.status === 200);
  const originalAccount = releaseRehearsal ? JSON.stringify(await create.json()) : undefined;
  // Technical account creation does not make the synthetic actor registered.
  const beforeRegistration = await fetch(origin + "/v1/auth/telegram-mini-app/registered-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, commandId: randomUUID() }),
    signal: AbortSignal.timeout(5000),
  });
  assert(
    beforeRegistration.status === 403 &&
      (await beforeRegistration.json()).error.code === "REGISTRATION_REQUIRED",
  );
  await run("docker", [
    "exec",
    api,
    "node",
    "--input-type=module",
    "-e",
    `
    import { createDatabase } from '@hambazi/database';
    import { createRegistrationPort } from './dist/users/index.js';
    const db = createDatabase({ databaseUrl: { reveal: () => process.env.API_DATABASE_URL }, poolMax: 2, connectionTimeoutMs: 2000, idleTimeoutMs: 1000, transactionMaxWaitMs: 5000, transactionTimeoutMs: 5000 });
    try { const r = await createRegistrationPort(db, { nowMs: () => Date.now() }).complete('777000456', 'Packaging fixture'); if (!r.ok) process.exitCode = 1; } finally { await db.disconnect(); }
  `,
  ]);
  const issued = await fetch(origin + "/v1/auth/telegram-mini-app", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, commandId: randomUUID() }),
    signal: AbortSignal.timeout(5000),
  });
  assert(issued.ok);
  const session = await issued.json();
  assert(typeof session.accessToken === "string");
  assert(
    (
      await fetch(origin + "/v1/me", {
        headers: { authorization: `Bearer ${session.accessToken}` },
        signal: AbortSignal.timeout(5000),
      })
    ).ok,
  );
  assert(
    (await fetch(origin + "/v1/health/ready", { signal: AbortSignal.timeout(5000) })).status ===
      404,
  );
  const workerEnvironment = {
    NODE_ENV: "test",
    WORKER_DATABASE_URL: `postgresql://hambazi_worker:${credentials.POSTGRES_WORKER_PASSWORD}@${postgres.name}:5432/hambazi`,
    WORKER_REDIS_URL: `redis://worker:${credentials.REDIS_WORKER_PASSWORD}@${redisName}:6379/0`,
    WORKER_QUEUE_NAMESPACE: "packaging",
    BOT_CLEANUP_INTERVAL_MS: "1000",
    BOT_CLEANUP_BATCH_SIZE: "10",
    BOT_CLEANUP_ATTEMPTS: "3",
    BOT_CLEANUP_BACKOFF_MS: "100",
    WORKER_DB_POOL_MAX: "3",
  };
  let worker = await start("worker", workerEnvironment);
  const botEnvironment = {
    NODE_ENV: "test",
    BOT_HEALTH_PORT: "8082",
    TELEGRAM_BOT_TOKEN: token,
    TELEGRAM_BOT_USERNAME: "HamBaziFixtureBot",
    TELEGRAM_WEBHOOK_SECRET: webhook,
    BOT_SERVICE_KEY_ID: "fixture",
    BOT_SERVICE_KEY: serviceKey,
    BOT_API_ORIGIN: "https://127.0.0.1:9443",
    BOT_API_CA_FILE: "/run/hambazi/tls/cert.pem",
    BOT_BIND_ADDRESS: "127.0.0.1",
    BOT_PORT: "9444",
    BOT_TLS_KEY_FILE: "/run/hambazi/tls/key.pem",
    BOT_TLS_CERT_FILE: "/run/hambazi/tls/cert.pem",
    BOT_MINI_APP_URL: "https://mini.example",
    BOT_BACKEND_TIMEOUT_MS: "1000",
    BOT_SEND_TIMEOUT_MS: "1000",
    BOT_ONBOARDING_LEASE_MS: "15000",
    BOT_MAX_IN_FLIGHT: "10",
  };
  let bot = await start("bot", botEnvironment, `container:${api}`, tls);
  let web = await start("web", {}, postgres.name, ["--publish", "127.0.0.1::8080"]);
  stage = "web-http";
  const webBinding = (await run("docker", ["port", web, "8080/tcp"])).trim();
  assert(/^127\.0\.0\.1:\d+$/.test(webBinding));
  const response = await fetch(`http://${webBinding}`, { signal: AbortSignal.timeout(5000) });
  assert(response.ok);
  assert(
    response.headers.get("content-security-policy") ===
      manifest.browserPolicy.headers["Content-Security-Policy"],
  );
  assert(response.headers.get("cache-control") === "no-store");
  assert((await response.text()).includes("<html"));
  stage = "web-browser";
  await run(
    "pnpm",
    ["--filter", "@hambazi/web", "test:browser", "--config", "packaging.playwright.config.ts"],
    {
      env: {
        ...process.env,
        TEST_WEB_IMAGE_ORIGIN: `http://${webBinding}`,
        PLAYWRIGHT_NO_COPY_PROMPT: "1",
      },
    },
  );
  checks += 2;
  async function stopCurrent() {
    for (const [role, name] of [
      ["web", web],
      ["bot", bot],
      ["worker", worker],
      ["api", api],
    ]) {
      stage = `${role}-sigterm`;
      await run("docker", ["stop", "--timeout=40", name]);
      assert(
        (await run("docker", ["inspect", "--format", "{{.State.ExitCode}}", name])).trim() === "0",
      );
    }
  }
  if (releaseRehearsal) {
    // Retain the same durable DB/Redis/config throughout reviewed image transitions.
    // The previous/current pair must also receive a separate source/pins/jobs review.
    const currentImages = { ...images };
    async function drainAcceptedRequest() {
      stage = "release-accepted-request-drain";
      const require = createRequire(
        new URL("../../packages/database/package.json", import.meta.url),
      );
      const { Client } = require("pg");
      const admin = new Client({
        connectionString: `postgresql://hambazi_local_admin:${credentials.POSTGRES_PASSWORD}@127.0.0.1:${postgres.port}/hambazi`,
        connectionTimeoutMillis: 2000,
      });
      const abort = new AbortController();
      let locked = false,
        pending;
      try {
        await admin.connect();
        await admin.query("BEGIN");
        locked = true;
        await admin.query("LOCK TABLE users IN ACCESS EXCLUSIVE MODE");
        const address = (await run("docker", ["port", api, "8080/tcp"])).trim();
        assert(/^127\.0\.0\.1:\d+$/.test(address));
        pending = fetch(`http://${address}/v1/me`, {
          headers: { authorization: `Bearer ${session.accessToken}` },
          signal: abort.signal,
        }).catch(() => undefined);
        let admitted = false;
        for (let i = 0; i < 10; i++) {
          const waiting = await admin.query(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename='hambazi_api' AND wait_event_type='Lock') AS waiting",
          );
          if (waiting.rows[0].waiting) {
            admitted = true;
            break;
          }
          await delay();
        }
        assert(admitted);
        await run("docker", ["kill", "--signal=SIGTERM", api]);
        const probe =
          "const r=await fetch('http://127.0.0.1:8081/v1/health/ready');const s=await r.json();if(s.status!=='NOT_READY')process.exit(1);";
        await run("docker", ["exec", api, "node", "--input-type=module", "-e", probe]);
        checks++;
        assert(
          (await run("docker", ["inspect", "--format", "{{.State.Running}}", api])).trim() ===
            "true",
        );
        await admin.query("COMMIT");
        locked = false;
        assert((await pending)?.ok === true);
        assert((await run("docker", ["wait", api])).trim() === "0");
      } finally {
        if (locked) await admin.query("ROLLBACK").catch(() => {});
        abort.abort();
        await pending;
        await admin.end();
      }
    }
    async function deploy(entries) {
      await drainAcceptedRequest();
      await stopCurrent();
      stage = "release-repeat-migration";
      await run("pnpm", ["--filter", "@hambazi/database", "db:migrate"], {
        env: { ...process.env, MIGRATION_DATABASE_URL: migrationUrl },
      });
      checks++;
      Object.assign(images, Object.fromEntries(entries.map(({ role, image }) => [role, image])));
      api = await start("api", apiEnvironment, postgres.name, [
        ...tls,
        "--publish",
        "127.0.0.1::8080",
      ]);
      worker = await start("worker", workerEnvironment);
      bot = await start("bot", botEnvironment, `container:${api}`, tls);
      web = await start("web", {}, postgres.name, ["--publish", "127.0.0.1::8080"]);
      stage = "release-original-intent-and-session";
      const address = (await run("docker", ["port", api, "8080/tcp"])).trim();
      assert(/^127\.0\.0\.1:\d+$/.test(address));
      const base = `http://${address}`;
      const retry = await fetch(base + "/v1/auth/telegram-mini-app/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, displayName: "Packaging fixture" }),
        signal: AbortSignal.timeout(5000),
      });
      assert(retry.ok);
      // Compare inside the private fixture; export only booleans/counts.
      assert(JSON.stringify(await retry.json()) === originalAccount);
      assert(
        (
          await fetch(base + "/v1/me", {
            headers: { authorization: `Bearer ${session.accessToken}` },
            signal: AbortSignal.timeout(5000),
          })
        ).ok,
      );
      const webAddress = (await run("docker", ["port", web, "8080/tcp"])).trim();
      assert(/^127\.0\.0\.1:\d+$/.test(webAddress));
      const page = await fetch(`http://${webAddress}`, { signal: AbortSignal.timeout(5000) });
      assert(
        page.ok &&
          page.headers.get("content-security-policy") ===
            manifest.browserPolicy.headers["Content-Security-Policy"],
      );
    }
    // Start the reviewed previous release; then candidate; then previous again.
    await deploy(rollbackManifest.images);
    await deploy(Object.entries(currentImages).map(([role, image]) => ({ role, image })));
    await deploy(rollbackManifest.images);
  }
  await stopCurrent();
  evidence = {
    schemaVersion: 1,
    purpose: releaseRehearsal ? "disposable-release-rehearsal" : "disposable-packaging-smoke",
    checks,
    browserCases: 2,
    passed: true,
    productionReady: false,
    ...(releaseRehearsal
      ? {
          transitions: 3,
          acceptedRequestDrainDrills: 3,
          stagingAccepted: false,
          candidateBuildInputSha256: manifest.buildInputSha256,
          rollbackBuildInputSha256: rollbackManifest.buildInputSha256,
        }
      : {}),
  };
} catch {
  console.error(`PACKAGING_SMOKE_FAILED:${stage}`);
  process.exitCode = 1;
} finally {
  let cleaned = true;
  for (const name of containers.reverse())
    try {
      await runGate("packaging-cleanup", "docker", ["rm", "--force", name]);
    } catch {
      cleaned = false;
    }
  try {
    await postgres?.stop();
  } catch {
    cleaned = false;
  }
  if (cleaned) await rm(directory, { recursive: true, force: true });
  else {
    console.error("PACKAGING_SMOKE_CLEANUP_FAILED");
    process.exitCode = 1;
  }
}
if (!process.exitCode && evidence) console.info(JSON.stringify(evidence));
