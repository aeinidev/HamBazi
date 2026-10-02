import { queueConnection, probeQueue, requeueForDrain } from "./queue-connection.js";
import { Queue, Worker, UnrecoverableError } from "bullmq";
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
  let stopping = false;
  const active = new Set<Promise<unknown>>();
  const processing = cleanupProcessor(options.cleanup, name);
  const queue = new Queue(name, {
    connection: queueConnection(options.redisUrl, false),
    prefix,
  });
  const worker = new Worker(
    name,
    async (job, token) => {
      if (stopping) return requeueForDrain(job, token!);
      const work = processing(job);
      active.add(work);
      try {
        return await work;
      } finally {
        active.delete(work);
      }
    },
    {
      connection: queueConnection(options.redisUrl, true),
      prefix,
      concurrency: 1,
      autorun: false,
      lockDuration: 30000,
      maxStalledCount: 1,
    },
  );
  queue.on("error", () => options.event("worker.queue_unavailable"));
  worker.on("error", () => options.event("worker.queue_unavailable"));
  worker.on("failed", () => options.event("worker.job_failed"));
  worker.on("completed", () => options.event("worker.job_completed"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let paused: Promise<void> | undefined;
  const stopAdmission = () => {
    stopping = true;
    return (paused ??= worker.pause(true));
  };
  const settled = async () => {
    await paused?.catch(() => {});
    await Promise.allSettled([...active]);
  };
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
      counts: () => queue.getJobCounts("waiting", "active", "delayed", "failed"),
      stopAdmission,
      settled,
      probe: async () => !stopping && (await probeQueue(queue)) && (await probeQueue(worker)),
      close() {
        const pause = stopAdmission();
        return (closing ??= (async () => {
          await pause;
          await settled();
          await worker.close();
          await queue.disconnect();
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
