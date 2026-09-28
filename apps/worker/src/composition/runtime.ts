import { parseOutboxWorkerConfig } from "@hambazi/config";
import { createMatchOutboxPort } from "@hambazi/api/matches";
import {
  createOutboxDispatcher,
  createBullMqDomainPublisher,
  startOutboxLoop,
  type OutboxReporter,
} from "../outbox-dispatcher.js";
import { parseRuntimeConfig, parseOnboardingWorkerConfig } from "@hambazi/config";
import { createDatabase } from "@hambazi/database";
import { createBotOnboardingCleanup } from "@hambazi/api/auth";
import { createProfileCleanup } from "@hambazi/api/users";
import { startCleanupQueue } from "../onboarding-cleanup.js";
export async function startWorker(
  environment: Readonly<Record<string, string | undefined>>,
  event: (
    event:
      | Parameters<Parameters<typeof startCleanupQueue>[0]["event"]>[0]
      | Parameters<OutboxReporter>[0],
    fields?: Parameters<OutboxReporter>[1],
  ) => void,
) {
  const runtime = parseRuntimeConfig(environment, "worker");
  const config = parseOnboardingWorkerConfig(environment);
  const outboxConfig = parseOutboxWorkerConfig(environment);
  const database = createDatabase({
    databaseUrl: runtime.databaseUrl,
    poolMax: config.poolMax,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 10000,
    transactionMaxWaitMs: 2000,
    transactionTimeoutMs: 5000,
  });
  let queue: Awaited<ReturnType<typeof startCleanupQueue>> | undefined;
  let profileQueue: Awaited<ReturnType<typeof startCleanupQueue>> | undefined;
  let publisher: Awaited<ReturnType<typeof createBullMqDomainPublisher>> | undefined;
  let outboxLoop: ReturnType<typeof startOutboxLoop> | undefined;
  try {
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
          }),
          publisher,
          batchSize: outboxConfig.batchSize,
          publishTimeoutMs: outboxConfig.publishTimeoutMs,
          event,
        }),
        outboxConfig.intervalMs,
      );
    }
    let closing: Promise<void> | undefined;
    return {
      close() {
        return (closing ??= (async () => {
          try {
            const drains = await Promise.allSettled([
              queue!.close(),
              profileQueue!.close(),
              outboxLoop?.close(),
            ]);
            await publisher?.close();
            if (drains.some((result) => result.status === "rejected"))
              throw new Error("Worker drain failed");
          } finally {
            await database.disconnect();
          }
        })());
      },
    };
  } catch {
    await outboxLoop?.close().catch(() => {});
    await publisher?.close().catch(() => {});
    await queue?.close().catch(() => {});
    await profileQueue?.close().catch(() => {});
    await database.disconnect().catch(() => {});
    throw new Error("Worker startup failed");
  }
}
