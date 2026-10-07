import { execFile, fork } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir, cpus, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { parse } from "yaml";
import { startIsolatedPostgres } from "./isolated-postgres.mjs";
import {
  capacityFailureKey,
  capacityDatabaseActivity,
  capacityAutomationObservation,
} from "./capacity-diagnostics.mjs";
import {
  capacityProfile,
  capacityConnectionProfile,
  capacityFixtureLimits,
  capacityFixturePresencePolicy,
  capacityResources,
  capacityDriverBudgetSeconds,
} from "./capacity-model.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const run = promisify(execFile);
const pg = createRequire(new URL("../../packages/database/package.json", import.meta.url))("pg");
const { createClient } = createRequire(new URL("../../apps/api/package.json", import.meta.url))(
  "redis",
);
let directory,
  postgres,
  redisAttempted = false,
  server,
  driver,
  admin,
  redis;
const redisName = `hambazi-capacity-${randomUUID()}`;
let stage = "profile",
  report,
  cleanupFailed = false;
let measurementsReady = false,
  firstPoolResourceWork = Promise.resolve();
const args = process.argv.slice(2);
const smoke = args.length === 1 && args[0] === "--smoke";
const diagnostic =
  args.length === 3 &&
  args[0] === "--profile" &&
  ["--normal-and-stress", "--stress-only"].includes(args[2]);
const stressOnly = diagnostic && args[2] === "--stress-only";
const cpuProfile = diagnostic && process.env.TEST_CAPACITY_CPU_PROFILE === "isolated";
const queryWork = diagnostic && process.env.TEST_CAPACITY_QUERY_WORK === "isolated";
async function reservePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
const exitChild = async (child, allowFailedExit = false) => {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("CAPACITY_STOP_TIMEOUT"));
    }, 12000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 || allowFailedExit ? resolve() : reject(new Error("CAPACITY_CHILD_EXIT"));
    });
    child.kill("SIGTERM");
  });
};
process.once("SIGTERM", () => {
  driver?.kill("SIGTERM");
});
process.once("SIGINT", () => {
  driver?.kill("SIGTERM");
});

try {
  const connectionOnly = args.length === 2 && args[0] === "--connections";
  if (!smoke && !connectionOnly && !diagnostic && (args.length !== 2 || args[0] !== "--profile"))
    throw new Error("CAPACITY_PROFILE_INVALID");
  const validatedProfile = connectionOnly
    ? capacityConnectionProfile(/^\d+$/.test(args[1]) ? Number(args[1]) : NaN)
    : capacityProfile(
        smoke
          ? { peakCcu: 2, peakMatches: 1, peakCommandsPerSecond: 1, soakSeconds: 10 }
          : JSON.parse(await readFile(args[1], "utf8")),
        smoke,
      );
  const profile = diagnostic
    ? Object.freeze({
        ...validatedProfile,
        diagnostic: true,
        stressOnly,
        ...(cpuProfile ? { cpuProfile: true } : {}),
      })
    : validatedProfile;
  const kind = connectionOnly
    ? "connection-probe"
    : smoke
      ? "smoke"
      : diagnostic
        ? stressOnly
          ? "stress-diagnostic"
          : "normal-stress-diagnostic"
        : "local-fixture-capacity";
  const transportPolicy = capacityFixtureLimits(profile.ccu);
  report = {
    schemaVersion: 2,
    kind,
    releaseApproved: false,
    profile,
    correctnessPassed: false,
    databaseFailureCounts: {},
    workerDatabaseFailureCounts: {},
    outboxObservations: {},
    workerAutomationObservations: {},
    ...(diagnostic
      ? {
          omittedStages: [
            ...(stressOnly ? ["normal-load", "normal-reconnect"] : []),
            "worker-recovery",
            "api-recovery",
            "postgres-recovery",
            "redis-recovery",
            "soak",
          ],
          minimumSoakPassed: false,
        }
      : {}),
  };
  stage = "build";
  await run(
    "pnpm",
    ["exec", "turbo", "run", "build", "--filter=@hambazi/worker", "--concurrency=1"],
    { cwd: root, timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
  );
  directory = await mkdtemp(join(tmpdir(), "hambazi-capacity-"));
  const credentials = Object.fromEntries(
    [
      "POSTGRES_PASSWORD",
      "POSTGRES_API_PASSWORD",
      "POSTGRES_WORKER_PASSWORD",
      "POSTGRES_MIGRATOR_PASSWORD",
    ].map((key) => [key, randomBytes(32).toString("hex")]),
  );
  stage = "owned PostgreSQL";
  postgres = await startIsolatedPostgres({ directory, port: await reservePort(), credentials });
  const databaseUrl = (role, password, db = "hambazi_release") =>
    `postgresql://${role}:${password}@127.0.0.1:${postgres.port}/${db}`;
  admin = new pg.Client({
    connectionString: databaseUrl("hambazi_local_admin", credentials.POSTGRES_PASSWORD, "hambazi"),
    connectionTimeoutMillis: 5000,
  });
  await admin.connect();
  await admin.query("CREATE DATABASE hambazi_release");
  await admin.query("REVOKE ALL ON DATABASE hambazi_release FROM PUBLIC");
  await admin.query(
    "GRANT CONNECT ON DATABASE hambazi_release TO hambazi_api, hambazi_worker, hambazi_migrator",
  );
  await admin.end();
  admin = new pg.Client({
    connectionString: databaseUrl("hambazi_local_admin", credentials.POSTGRES_PASSWORD),
    connectionTimeoutMillis: 5000,
  });
  await admin.connect();
  await admin.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
  await admin.query("GRANT USAGE ON SCHEMA public TO hambazi_api, hambazi_worker");
  await admin.query("GRANT USAGE, CREATE ON SCHEMA public TO hambazi_migrator");
  stage = "owned schema migrations";
  const env = {
    NODE_ENV: "test",
    PATH: process.env.PATH,
    TEST_DATABASE_CONFIRM: "isolated-hambazi-test",
    TEST_AUTH_DATABASE_READY: "foundation-completed",
    TEST_RELEASE_BROWSER: "isolated",
    TEST_CAPACITY_MODE: "isolated",
    TEST_CAPACITY_CCU: String(profile.ccu),
    ...(cpuProfile ? { TEST_CAPACITY_CPU_PROFILE: "isolated" } : {}),
    ...(queryWork ? { TEST_CAPACITY_QUERY_WORK: "isolated" } : {}),
    API_DATABASE_URL: databaseUrl("hambazi_api", credentials.POSTGRES_API_PASSWORD),
    WORKER_DATABASE_URL: databaseUrl("hambazi_worker", credentials.POSTGRES_WORKER_PASSWORD),
    TEST_DATABASE_URL: databaseUrl("hambazi_local_admin", credentials.POSTGRES_PASSWORD),
  };
  await run("pnpm", ["--filter", "@hambazi/database", "db:migrate"], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      MIGRATION_DATABASE_URL: databaseUrl(
        "hambazi_migrator",
        credentials.POSTGRES_MIGRATOR_PASSWORD,
      ),
    },
    timeout: 120000,
  });
  const redisCredentials = Object.fromEntries(
    ["REDIS_API_PASSWORD", "REDIS_WORKER_PASSWORD", "REDIS_HEALTH_PASSWORD"].map((key) => [
      key,
      randomBytes(32).toString("hex"),
    ]),
  );
  const redisEnv = join(directory, "redis.env");
  await writeFile(
    redisEnv,
    Object.entries(redisCredentials)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
    { mode: 0o600, flag: "wx" },
  );
  const compose = parse(await readFile(join(root, "infra/docker/compose.yaml"), "utf8"));
  if (!/^redis:[^@]+@sha256:[a-f0-9]{64}$/.test(compose.services.redis.image))
    throw new Error("CAPACITY_IMAGE_INVALID");
  stage = "owned Redis";
  const redisPort = await reservePort();
  redisAttempted = true;
  await run(
    "docker",
    [
      "run",
      "--detach",
      "--name",
      redisName,
      "--label",
      "hambazi.test=capacity",
      "--user",
      "redis",
      "--env-file",
      redisEnv,
      "--publish",
      `127.0.0.1:${redisPort}:6379`,
      "--tmpfs",
      "/tmp:mode=1777",
      "--tmpfs",
      "/data:mode=1777",
      "--mount",
      `type=bind,source=${join(root, "infra/docker/redis/start.sh")},target=/usr/local/bin/hambazi-redis.sh,readonly`,
      "--entrypoint",
      "/bin/sh",
      compose.services.redis.image,
      "/usr/local/bin/hambazi-redis.sh",
    ],
    { timeout: 60000 },
  );
  const portOutput = await run("docker", ["port", redisName, "6379/tcp"]);
  const port = /^127\.0\.0\.1:(\d+)\s*$/.exec(portOutput.stdout)?.[1];
  if (!port) throw new Error("CAPACITY_BINDING_INVALID");
  env.TEST_AUTH_REDIS_URL = `redis://api:${redisCredentials.REDIS_API_PASSWORD}@127.0.0.1:${port}/0`;
  env.TEST_WORKER_REDIS_URL = `redis://worker:${redisCredentials.REDIS_WORKER_PASSWORD}@127.0.0.1:${port}/0`;
  async function redisHealth() {
    for (let i = 0; i < 40; i++) {
      try {
        const probe = await run(
          "docker",
          [
            "exec",
            redisName,
            "sh",
            "-c",
            'REDISCLI_AUTH="$REDIS_HEALTH_PASSWORD" redis-cli --user health ping',
          ],
          { timeout: 2000 },
        );
        if (probe.stdout.trim() === "PONG") {
          return;
        }
      } catch {
        /* Suppress owned service diagnostics. */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("CAPACITY_REDIS_NOT_READY");
  }
  await redisHealth();
  redis = createClient({
    url: env.TEST_AUTH_REDIS_URL,
    socket: { reconnectStrategy: false, connectTimeout: 5000 },
  });
  redis.on("error", () => {});
  await redis.connect();
  stage = "real-service fixture";
  // Fixed release-fixture ports intentionally fail on collision; existing servers are never stopped.
  server = fork(join(root, "apps/api/tests/fixtures/release-server.mjs"), [], {
    env,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("CAPACITY_FIXTURE_NOT_READY")), 20000);
    server.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("CAPACITY_FIXTURE_FAILED"));
    });
    server.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("CAPACITY_FIXTURE_FAILED"));
    });
    server.on("message", (message) => {
      if (capacityAutomationObservation(message)) {
        const value = (report.workerAutomationObservations[message.outcome] ??= {
          count: 0,
          maximumMs: 0,
        });
        value.count++;
        value.maximumMs = Math.max(value.maximumMs, message.durationMs);
      }
      const key = capacityFailureKey(message);
      if (key) report.databaseFailureCounts[key] = (report.databaseFailureCounts[key] ?? 0) + 1;
      if (
        key === "database/pool:connect/PG_POOL_ACQUIRE_TIMEOUT" &&
        report.firstPoolAcquisitionFailureAt === undefined
      ) {
        report.firstPoolAcquisitionFailureAt = new Date().toISOString();
        report.databaseFailuresAtFirstPoolTimeout = { ...report.databaseFailureCounts };
        if (measurementsReady)
          firstPoolResourceWork = failureResources("resourcesAtFirstPoolTimeout").catch(() => {
            report.poolResourceProbePassed = false;
          });
      }
      if (
        message.type === "capacity-database-work" &&
        report.databaseWorkAtFirstPoolTimeout === undefined
      )
        report.databaseWorkAtFirstPoolTimeout = {
          work: message.work,
          pool: message.pool,
          gameWork: message.gameWork,
        };
      if (message.type === "capacity-worker-failure") {
        const workerKey = capacityFailureKey({ ...message, type: "capacity-failure" });
        if (workerKey)
          report.workerDatabaseFailureCounts[workerKey] =
            (report.workerDatabaseFailureCounts[workerKey] ?? 0) + 1;
      }
      if (
        message.type === "capacity-outbox" &&
        [
          "worker.outbox_published",
          "worker.outbox_retry",
          "worker.outbox_failed",
          "worker.outbox_unavailable",
        ].includes(message.name)
      )
        report.outboxObservations[message.name] =
          (report.outboxObservations[message.name] ?? 0) + 1;
      if (message.ready === true) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  const revision = (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  const workingDiff = await run("git", ["diff", "HEAD", "--", ".", ":(exclude).aws"], {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  });
  const workingTreeDiffSha256 = createHash("sha256").update(workingDiff.stdout).digest("hex");
  const sourceHash = createHash("sha256");
  for (const file of [
    "infra/scripts/test-capacity-local.mjs",
    "infra/scripts/capacity-model.mjs",
    "infra/scripts/capacity-diagnostics.mjs",
    "apps/api/tests/capacity/client.mjs",
    "apps/api/tests/fixtures/release-server.mjs",
    "apps/worker/tests/fixtures/release-worker.mjs",
    "pnpm-lock.yaml",
  ])
    sourceHash.update(file).update(await readFile(join(root, file)));
  const samples = [];
  const faults = [];
  let faultActive = false,
    samplingWork = Promise.resolve(),
    failureResourceWork = Promise.resolve();
  async function failureResources(resultKey = "resourcesAtFirstFailure") {
    const response = await fetch("http://127.0.0.1:4176/capacity/metrics", {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error();
    const { pool, databaseWork, databaseQueryWork, realtimeWork, ...api } = await response.json();
    const activity = await admin.query(`
      SELECT state, wait_event_type, count(*)::int AS connections,
        count(*) FILTER (WHERE cardinality(pg_blocking_pids(pid)) > 0)::int AS blocked,
        max(EXTRACT(EPOCH FROM clock_timestamp() - xact_start) * 1000)::float8 AS maximum_transaction_ms
      FROM pg_stat_activity
      WHERE datname = 'hambazi_release' AND pid <> pg_backend_pid() AND backend_type = 'client backend'
      GROUP BY state, wait_event_type`);
    // Only fixed aggregate states/counts escape; no SQL text, parameters or backend identities.
    const db = (
      await admin.query(
        "SELECT numbackends, xact_commit, xact_rollback, deadlocks FROM pg_stat_database WHERE datname = 'hambazi_release'",
      )
    ).rows[0];
    const info = await redis.info();
    report[resultKey] = {
      ...capacityResources(api, db, info),
      apiPool: pool,
      databaseWork,
      ...(databaseQueryWork ? { databaseQueryWork } : {}),
      realtimeWork,
      databaseActivity: capacityDatabaseActivity(activity.rows),
      elapsedSeconds: (Date.now() - started) / 1000,
    };
  }
  async function sample() {
    const response = await fetch("http://127.0.0.1:4176/capacity/metrics", {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("CAPACITY_METRICS_UNAVAILABLE");
    const api = await response.json();
    const { pool, databaseWork, databaseQueryWork, realtimeWork, ...resources } = api;
    const db = (
      await admin.query(
        "SELECT numbackends, xact_commit, xact_rollback, deadlocks FROM pg_stat_database WHERE datname = 'hambazi_release'",
      )
    ).rows[0];
    const info = await redis.info();
    samples.push({
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      ...capacityResources(resources, db, info),
      apiPool: pool,
      databaseWork,
      ...(databaseQueryWork ? { databaseQueryWork } : {}),
      realtimeWork,
    });
  }
  const started = Date.now();
  Object.assign(report, {
    startedAt: new Date(started).toISOString(),
    samples,
    faults,
    environment: {
      topology: "single-laptop-loopback-disposable-release-fixture",
      publicGameplayEnabled: false,
      node: process.version,
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
      apiPool: 10,
      workerPool: 4,
      realtimeMatchDeliveryConcurrency: 4,
      realtimeHeartbeatConcurrency: 4,
      realtimeIntentConcurrency: 4,
      realtimeDisconnectConcurrency: 4,
      ...(cpuProfile ? { cpuProfilingSeconds: 10, cpuProfilingStage: "work-backlog" } : {}),
      ...(queryWork ? { queryWorkObservation: "driver-wall-time-fixed-categories" } : {}),
      transportPolicy,
      clientSource: "distinct-synthetic-127.1-loopback-addresses",
      authIpLimitPerMinute: 300,
      authIdentityLimitPerMinute: 30,
      presencePolicy: capacityFixturePresencePolicy,
      driverBudgetSeconds: capacityDriverBudgetSeconds(profile),
      sourceRevision: revision,
      workingTreeDiffSha256,
      scenarioSha256: sourceHash.digest("hex"),
      postgresImage: compose.services.postgres.image,
      redisImage: compose.services.redis.image,
    },
  });
  await sample();
  measurementsReady = true;
  stage = "load/reconnect/soak";
  driver = fork(join(root, "apps/api/tests/capacity/client.mjs"), [], {
    env: { NODE_ENV: "test", TEST_CAPACITY_MODE: "isolated" },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let sampling;
  let driverDeadline;
  const result = await new Promise((resolve, reject) => {
    driverDeadline = setTimeout(
      () => {
        driver.kill("SIGTERM");
        reject(new Error("CAPACITY_DRIVER_DEADLINE"));
      },
      capacityDriverBudgetSeconds(profile) * 1000,
    );
    driver.once("error", () => reject(new Error("CAPACITY_DRIVER_FAILED")));
    driver.once("exit", () => reject(new Error("CAPACITY_DRIVER_FAILED")));
    driver.on("message", (message) => {
      if (message.type === "driver-cleanup-failed") cleanupFailed = true;
      if (message.type === "first-failure") {
        report.databaseFailuresAtFirstFailure = { ...report.databaseFailureCounts };
        report.workerAutomationAtFirstFailure = structuredClone(
          report.workerAutomationObservations,
        );
        failureResourceWork = failureResources().catch(() => {
          report.failureResourceProbePassed = false;
        });
        report.firstFailedOperation = [
          "room:join",
          "room:start",
          "matchmaking:search",
          "matchmaking:status",
          "matchmaking:found",
          "matchmaking:admit",
          "match:subscribe",
          "match:catchup",
          "match:ready",
          "game:command",
          "UNKNOWN",
        ].includes(message.operation)
          ? message.operation
          : null;
        report.connectedAtFirstSocketAckFailure =
          message.reason === "CAPACITY_SOCKET_ACK_FAILED" && typeof message.connected === "boolean"
            ? message.connected
            : null;
      }
      if (message.type === "progress")
        console.info(
          `CAPACITY ${message.phase}: ${message.elapsedSeconds}s, connected=${message.connected}/${message.requested}, activeMatches=${message.activeMatches}/${message.requestedMatches}, accepted=${message.accepted}, missed=${message.missed}`,
        );
      if (message.type === "result") resolve(message.report);
      if (message.type === "failed") {
        report.databaseFailuresAtDriverStop = { ...report.databaseFailureCounts };
        report.driverFailure = {
          stage: message.stage,
          counts: message.counts,
          holds: message.holds,
          reconnectLatency: message.reconnectLatency,
          stages: message.stages,
          normalReconnect: message.normalReconnect,
          normalGateFailures: message.normalGateFailures,
          firstWait: message.firstWait,
        };
        reject(new Error(message.reason));
      }
      if (
        message.type === "fault" &&
        !faultActive &&
        ["postgres", "redis"].includes(message.service) &&
        /^[a-f0-9-]{36}$/.test(message.id)
      ) {
        faultActive = true;
        const faultStarted = Date.now();
        void (async () => {
          await samplingWork;
          if (message.service === "postgres") {
            await admin.end();
            await postgres.restart();
            admin = new pg.Client({
              connectionString: env.TEST_DATABASE_URL,
              connectionTimeoutMillis: 5000,
            });
            admin.on("error", () => {});
            await admin.connect();
          } else {
            await redis.close();
            await run("docker", ["restart", redisName], { timeout: 30000 });
            await redisHealth();
            redis = createClient({
              url: env.TEST_AUTH_REDIS_URL,
              socket: { reconnectStrategy: false, connectTimeout: 5000 },
            });
            redis.on("error", () => {});
            await redis.connect();
          }
          faults.push({
            service: message.service,
            operation: "owned-container-restart",
            elapsedMs: Date.now() - faultStarted,
            metricsPaused: true,
            counterEpochResetPossible: true,
          });
          faultActive = false;
          driver.send({ type: "fault-complete", id: message.id });
        })().catch(() => {
          driver.kill("SIGTERM");
          reject(new Error("CAPACITY_SERVICE_RECOVERY_FAILED"));
        });
      }
    });
    sampling = setInterval(
      () => {
        if (faultActive) return;
        samplingWork = sample().catch(() => {
          driver.kill("SIGTERM");
          reject(new Error("CAPACITY_METRICS_FAILED"));
        });
      },
      profile.connectionOnly ? 15000 : 60000,
    );
    driver.send({ profile });
  }).finally(async () => {
    clearInterval(sampling);
    clearTimeout(driverDeadline);
    await samplingWork;
    await failureResourceWork;
    await firstPoolResourceWork;
  });
  await sample();
  const dispatchResponse = await fetch("http://127.0.0.1:4176/capacity/dispatch", {
    signal: AbortSignal.timeout(5000),
  });
  if (!dispatchResponse.ok) throw new Error("CAPACITY_METRICS_UNAVAILABLE");
  report.dispatchObservation = await dispatchResponse.json();
  report = {
    ...report,
    elapsedSeconds: (Date.now() - started) / 1000,
    ...result,
    samples,
    faults,
  };
} catch (error) {
  const reason = /^CAPACITY_[A-Za-z_-]{1,80}$/.test(error?.message ?? "")
    ? error.message
    : "CAPACITY_UNAVAILABLE";
  if (report) Object.assign(report, { failureStage: stage, reason });
  if (report?.startedAt) report.elapsedSeconds = (Date.now() - Date.parse(report.startedAt)) / 1000;
  if (report?.startedAt) {
    try {
      const response = await fetch("http://127.0.0.1:4176/capacity/dispatch", {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) report.dispatchObservation = await response.json();
    } catch {
      // Diagnostics never replace the primary failure.
    }
  }
  console.error(
    `CAPACITY_LOCAL_FAILED at ${stage} (${reason}); raw payloads and service diagnostics suppressed.`,
  );
  process.exitCode = 1;
} finally {
  for (const stop of [
    () => exitChild(driver, true),
    () => exitChild(server),
    () => redis?.close(),
    () => admin?.end(),
    () =>
      redisAttempted ? run("docker", ["rm", "--force", redisName], { timeout: 15000 }) : undefined,
    () => postgres?.stop(),
  ]) {
    try {
      await stop();
    } catch {
      cleanupFailed = true;
      process.exitCode = 1;
    }
  }
  if (!cleanupFailed && directory) await rm(directory, { recursive: true, force: true });
  if (cleanupFailed)
    console.error("CAPACITY_CLEANUP_FAILED; owned temporary resources require inspection.");
  if (report) {
    report.cleanupPassed = !cleanupFailed;
    await mkdir(join(root, ".capacity-results"), { recursive: true, mode: 0o700 });
    const destination = join(root, ".capacity-results", `${randomUUID()}.json`);
    await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    console.info(`Capacity evidence: ${destination}; releaseApproved=false`);
    if (!report.correctnessPassed) process.exitCode = 1;
    // A focused diagnostic never satisfies full capacity acceptance, even if
    // its measured stages pass. Default full-profile gates remain unchanged.
    if (diagnostic) process.exitCode = 1;
    if (
      !smoke &&
      !report.profile.connectionOnly &&
      (!report.requestedRateSustained ||
        !report.workloadTargetsPassed ||
        !report.minimumSoakPassed ||
        !report.latencyTargetsPassed)
    )
      process.exitCode = 1;
  }
}
