import { Queue, Worker, UnrecoverableError, type ConnectionOptions } from "bullmq";
import { z } from "zod";
export const cleanupJobSchema = z.strictObject({
  schemaVersion: z.literal(1),
  limit: z.number().int().min(1).max(500),
});
type Cleanup = (input: {
  schemaVersion: 1;
  limit: number;
}) => Promise<{ ok: boolean; receipts?: number; flows?: number; status?: string }>;
export function cleanupProcessor(cleanup: Cleanup, name = "bot-onboarding-cleanup-v1") {
  return async (job: { name: string; data: unknown }) => {
    const data = cleanupJobSchema.safeParse(job.data);
    if (job.name !== name || !data.success) throw new UnrecoverableError("Invalid cleanup job");
    try {
      const result = await cleanup(data.data);
      if (
        !result.ok ||
        result.status === "RETRY" ||
        ![result.receipts, result.flows].every(
          (count) => Number.isInteger(count) && count! >= 0 && count! <= data.data.limit,
        )
      )
        throw new Error();
      return { schemaVersion: 1, receipts: result.receipts, flows: result.flows };
    } catch {
      throw new Error("Onboarding cleanup failed");
    }
  };
}
function connection(secret: { reveal(): string }, worker: boolean): ConnectionOptions {
  const url = new URL(secret.reveal());
  if (!["redis:", "rediss:"].includes(url.protocol) || url.search || url.hash)
    throw new Error("Invalid cleanup Redis configuration");
  const db = Number(url.pathname.slice(1) || 0);
  if (!Number.isInteger(db) || db < 0 || db > 15)
    throw new Error("Invalid cleanup Redis configuration");
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || 6379),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    db,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    connectTimeout: 2000,
    retryStrategy: (attempt: number) => Math.min(attempt * 200, 2000),
  };
}
export async function startCleanupQueue(options: {
  name?: "bot-onboarding-cleanup-v1" | "profile-receipt-cleanup-v1";
  redisUrl: { reveal(): string };
  namespace: string;
  intervalMs: number;
  batchSize: number;
  attempts: number;
  backoffMs: number;
  cleanup: Cleanup;
  event(name: "worker.job_completed" | "worker.job_failed" | "worker.queue_unavailable"): void;
}) {
  const prefix = `hambazi:jobs:${options.namespace}`;
  const name = options.name ?? "bot-onboarding-cleanup-v1";
  const queue = new Queue(name, {
    connection: connection(options.redisUrl, false),
    prefix,
  });
  const worker = new Worker(name, cleanupProcessor(options.cleanup, name), {
    connection: connection(options.redisUrl, true),
    prefix,
    concurrency: 1,
    autorun: false,
    lockDuration: 30000,
    maxStalledCount: 1,
  });
  queue.on("error", () => options.event("worker.queue_unavailable"));
  worker.on("error", () => options.event("worker.queue_unavailable"));
  worker.on("failed", () => options.event("worker.job_failed"));
  worker.on("completed", () => options.event("worker.job_completed"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error()), 5000);
      }),
    ]);
    clearTimeout(timer);
    await queue.upsertJobScheduler(
      name,
      { every: options.intervalMs },
      {
        name,
        data: { schemaVersion: 1, limit: options.batchSize },
        opts: {
          attempts: options.attempts,
          backoff: { type: "exponential", delay: options.backoffMs },
          removeOnComplete: 10,
          removeOnFail: 100,
        },
      },
    );
    void worker.run().catch(() => options.event("worker.queue_unavailable"));
    let closing: Promise<void> | undefined;
    return {
      close() {
        return (closing ??= (async () => {
          await worker.close();
          await queue.close();
        })());
      },
    };
  } catch {
    clearTimeout(timer);
    await worker.close(true).catch(() => {});
    await queue.close().catch(() => {});
    throw new Error("Onboarding cleanup queue startup failed");
  }
}
