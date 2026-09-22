import { parseRuntimeConfig, parseOnboardingWorkerConfig } from "@hambazi/config";
import { createDatabase } from "@hambazi/database";
import { createBotOnboardingCleanup } from "@hambazi/api/auth";
import { createProfileCleanup } from "@hambazi/api/users";
import { startCleanupQueue } from "../onboarding-cleanup.js";
export async function startWorker(
  environment: Readonly<Record<string, string | undefined>>,
  event: Parameters<typeof startCleanupQueue>[0]["event"],
) {
  const runtime = parseRuntimeConfig(environment, "worker");
  const config = parseOnboardingWorkerConfig(environment);
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
    let closing: Promise<void> | undefined;
    return {
      close() {
        return (closing ??= (async () => {
          try {
            await Promise.all([queue!.close(), profileQueue!.close()]);
          } finally {
            await database.disconnect();
          }
        })());
      },
    };
  } catch {
    await queue?.close().catch(() => {});
    await profileQueue?.close().catch(() => {});
    await database.disconnect().catch(() => {});
    throw new Error("Worker startup failed");
  }
}
