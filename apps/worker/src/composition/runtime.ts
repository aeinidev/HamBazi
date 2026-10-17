import { createPersonalCoupGames } from "@hambazi/api";
import { parsePersonalGameplayConfig } from "@hambazi/config";
import { parseKahrobaRuntimeConfig } from "@hambazi/config";
import { startStatisticsConsumer } from "../statistics.js";
import { createStatisticsProjection } from "@hambazi/api/leaderboard";
import { createMatchResultPort } from "@hambazi/api/matches";
import { parseStatisticsConfig } from "@hambazi/config";
import { startMatchAutomation } from "../match-automation.js";
import {
  createMatchAutomationPort,
  createMatchReconnectPort,
  type MatchGame,
  type ReconnectPolicy,
} from "@hambazi/api/matches";
import { parseOutboxWorkerConfig } from "@hambazi/config";
import {
  createMatchOutboxPort,
  createMatchDiagnostics,
  createOutboxDiagnostics,
} from "@hambazi/api/matches";
import {
  createOutboxDispatcher,
  decodeDelivery,
  outboxQueueNames,
  createBullMqDomainPublisher,
  startOutboxLoop,
  type OutboxReporter,
} from "../outbox-dispatcher.js";
import { parseRuntimeConfig, parseOnboardingWorkerConfig } from "@hambazi/config";
import { createDatabase } from "@hambazi/database";
import { createBotOnboardingCleanup } from "@hambazi/api/auth";
import { createProfileCleanup } from "@hambazi/api/users";
import { startCleanupQueue } from "../onboarding-cleanup.js";
import { parseOperationsConfig, parseTelemetryConfig } from "@hambazi/config";
import {
  createServiceHealth,
  startHealthServer,
  withDeadline,
  createMetricCollection,
  type OperationalMetrics,
  createMetrics,
  type Telemetry,
} from "@hambazi/observability";
export async function startWorker(
  environment: Readonly<Record<string, string | undefined>>,
  event: (
    event:
      | Parameters<Parameters<typeof startCleanupQueue>[0]["event"]>[0]
      | Parameters<OutboxReporter>[0],
    fields?: Parameters<OutboxReporter>[1],
  ) => void,
  resilience?: {
    games: readonly MatchGame[];
    policy: ReconnectPolicy;
    intervalMs: number;
    batchSize: number;
    attempts: number;
    backoffMs: number;
    drainTimeoutMs: number;
  },
  metrics: OperationalMetrics = createMetrics("worker"),
  telemetry?: Telemetry,
) {
  const runtime = parseRuntimeConfig(environment, "worker");
  // v2 consumers/outbox are required before an explicitly private producer can be enabled.
  const kahroba = parseKahrobaRuntimeConfig(environment, "worker");
  if (kahroba && resilience) throw new Error("KAHROBA_RUNTIME_CONFIGURATION_INVALID");
  const personal = parsePersonalGameplayConfig(environment, "worker");
  if (personal && resilience) throw new Error("PERSONAL_GAMEPLAY_CONFIGURATION_INVALID");
  if (personal)
    resilience = {
      games: createPersonalCoupGames(),
      policy: { schemaVersion: 1, graceMs: 30000, leaseMs: 30000, maxConnections: 1 },
      intervalMs: 500,
      batchSize: 10,
      attempts: 3,
      backoffMs: 1000,
      drainTimeoutMs: 30000,
    };
  const config = parseOnboardingWorkerConfig(environment);
  const outboxConfig = parseOutboxWorkerConfig(environment);
  const statsConfig = parseStatisticsConfig(environment, "worker");
  const operations = parseOperationsConfig(environment, "worker");
  const telemetryConfig = parseTelemetryConfig(environment, "worker");
  const database = createDatabase({
    databaseUrl: runtime.databaseUrl,
    poolMax: config.poolMax,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 10000,
    transactionMaxWaitMs: 2000,
    transactionTimeoutMs: 5000,
    observe: (durationMs, success) =>
      metrics?.emit("database.completed", {
        durationMs,
        ...(success ? {} : { errorCode: "INTERNAL_ERROR" }),
      }),
  });
  let statistics: Awaited<ReturnType<typeof startStatisticsConsumer>> | undefined;
  let automation: Awaited<ReturnType<typeof startMatchAutomation>> | undefined;
  let queue: Awaited<ReturnType<typeof startCleanupQueue>> | undefined;
  let profileQueue: Awaited<ReturnType<typeof startCleanupQueue>> | undefined;
  let publisher: Awaited<ReturnType<typeof createBullMqDomainPublisher>> | undefined;
  let outboxLoop: ReturnType<typeof startOutboxLoop> | undefined;
  const health = createServiceHealth(
    [
      { name: "postgres", required: true, probe: () => database.probe() },
      {
        name: "redis",
        required: true,
        probe: async () => {
          const results = await Promise.all([
            queue?.probe(),
            profileQueue?.probe(),
            ...(outboxConfig ? [publisher?.probe?.()] : []),
            ...(resilience ? [automation?.probe()] : []),
            ...(statsConfig ? [statistics?.probe()] : []),
          ]);
          return results.every((v) => v === true);
        },
      },
    ],
    operations.probeTimeoutMs,
    metrics,
  );
  let healthServer: Awaited<ReturnType<typeof startHealthServer>> | undefined;
  try {
    const collect = metrics
      ? createMetricCollection(
          metrics,
          [
            {
              name: "database",
              read: async () => {
                const p = database.poolSnapshot();
                return {
                  db_pool_max: p.max,
                  db_pool_total: p.total,
                  db_pool_idle: p.idle,
                  db_pool_waiting: p.waiting,
                };
              },
            },
            { name: "matches", read: createMatchDiagnostics(database) },
            { name: "outbox", read: createOutboxDiagnostics(database) },
            {
              name: "queues",
              read: async () => {
                const counts = await Promise.all([
                  queue!.counts(),
                  profileQueue!.counts(),
                  ...(publisher ? [publisher.counts!()] : []),
                  ...(automation ? [automation.counts()] : []),
                  ...(!publisher && statistics ? [statistics.counts()] : []),
                ]);
                const sum = (key: "waiting" | "active" | "delayed" | "failed") =>
                  counts.reduce((n, c) => n + (c[key] ?? 0), 0);
                return {
                  queue_waiting: sum("waiting"),
                  queue_active: sum("active"),
                  queue_delayed: sum("delayed"),
                  queue_failed: sum("failed"),
                };
              },
            },
          ],
          operations.probeTimeoutMs,
        )
      : undefined;
    if (operations.port)
      healthServer = await startHealthServer(
        health,
        operations.port,
        telemetryConfig.metricsEnabled && metrics
          ? { metrics, ...(collect ? { collect } : {}) }
          : undefined,
      );
    await database.connect();
    queue = await startCleanupQueue({
      ...config,
      redisUrl: runtime.redisUrl,
      cleanup: createBotOnboardingCleanup(database, { nowMs: () => Date.now() }),
      event,
    });
    profileQueue = await startCleanupQueue({
      ...config,
      name: "profile-receipt-cleanup-v1",
      redisUrl: runtime.redisUrl,
      cleanup: createProfileCleanup(database, { nowMs: () => Date.now() }),
      event,
    });
    if (outboxConfig) {
      publisher = await createBullMqDomainPublisher({
        redisUrl: runtime.redisUrl,
        namespace: config.namespace,
        timeoutMs: outboxConfig.publishTimeoutMs,
        attempts: outboxConfig.policy.maxAttempts,
        backoffMs: outboxConfig.policy.backoffMs,
        event,
      });
      outboxLoop = startOutboxLoop(
        createOutboxDispatcher({
          outbox: createMatchOutboxPort(database, {
            clock: { nowMs: () => Date.now() },
            policy: outboxConfig.policy,
            decode: decodeDelivery,
            eventTypes: Object.keys(outboxQueueNames),
          }),
          publisher,
          batchSize: outboxConfig.batchSize,
          publishTimeoutMs: outboxConfig.publishTimeoutMs,
          event,
        }),
        outboxConfig.intervalMs,
      );
    }
    if (resilience) {
      const clock = { nowMs: () => Date.now() };
      automation = await startMatchAutomation({
        redisUrl: runtime.redisUrl,
        namespace: config.namespace,
        intervalMs: resilience.intervalMs,
        batchSize: resilience.batchSize,
        attempts: resilience.attempts,
        backoffMs: resilience.backoffMs,
        drainTimeoutMs: resilience.drainTimeoutMs,
        event,
        automation: createMatchAutomationPort(database, {
          clock,
          games: resilience.games,
          ...(personal ? { personal: true } : {}),
        }),
        reconnect: createMatchReconnectPort(database, { clock, policy: resilience.policy }),
      });
    }
    if (statsConfig && "concurrency" in statsConfig)
      statistics = await startStatisticsConsumer({
        matches: createMatchResultPort(database),
        statistics: createStatisticsProjection(database, { nowMs: () => Date.now() }),
        redisUrl: runtime.redisUrl,
        namespace: config.namespace,
        concurrency: statsConfig.concurrency,
        drainTimeoutMs: statsConfig.drainTimeoutMs,
        unavailable: () => event("worker.outbox_unavailable"),
        ...(telemetry ? { telemetry } : {}),
        diagnostics: telemetryConfig.metricsEnabled && !outboxConfig,
      });
    let closing: Promise<void> | undefined;
    let drainStarted = 0;
    health.started();
    return {
      health,
      drainTimeoutMs: operations.drainTimeoutMs,
      close() {
        if (!closing) drainStarted = performance.now();
        health.stopAdmission();
        return (closing ??= withDeadline(
          (async () => {
            const drains = await Promise.allSettled([
              queue!.close(),
              profileQueue!.close(),
              outboxLoop?.close(),
              automation?.close(),
              statistics?.close(),
            ]);
            // Feature-specific deadlines can fail before an application transaction settles.
            await Promise.all([
              queue!.settled(),
              profileQueue!.settled(),
              automation?.settled(),
              statistics?.settled(),
            ]);
            await publisher?.close();
            await database.disconnect();
            health.stopped();
            await healthServer?.close();
            if (drains.some((result) => result.status === "rejected"))
              throw new Error("Worker drain failed");
          })(),
          operations.drainTimeoutMs,
        ).then(
          () => {
            metrics?.drain("completed", performance.now() - drainStarted);
          },
          () => {
            metrics?.drain("failed", performance.now() - drainStarted);
            throw new Error("Worker drain failed");
          },
        ));
      },
    };
  } catch {
    health.stopAdmission();
    await statistics?.close().catch(() => {});
    await automation?.close().catch(() => {});
    await outboxLoop?.close().catch(() => {});
    await publisher?.close().catch(() => {});
    await queue?.close().catch(() => {});
    await profileQueue?.close().catch(() => {});
    await database.disconnect().catch(() => {});
    health.stopped();
    await healthServer?.close().catch(() => {});
    throw new Error("Worker startup failed");
  }
}
