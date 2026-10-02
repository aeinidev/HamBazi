import { Worker } from "bullmq";
import type { createMatchResultPort } from "@hambazi/api/matches";
import type { createStatisticsProjection } from "@hambazi/api/leaderboard";
import { domainEventProcessor, outboxQueueNames } from "./outbox-dispatcher.js";
import { queueConnection } from "./queue-connection.js";
type Matches = ReturnType<typeof createMatchResultPort>;
type Statistics = ReturnType<typeof createStatisticsProjection>;
export function finishProcessor(matches: Matches, statistics: Statistics) {
  return domainEventProcessor("MATCH_FINISHED_V1", async (event) => {
    const recorded = await matches.record(event);
    return statistics.consume(recorded);
  });
}
export async function rebuildStatistics(matches: Matches, statistics: Statistics) {
  const id = await statistics.begin();
  try {
    let recovery: string | null = null;
    do {
      recovery = (await matches.recoverPage(recovery, 25)).next;
    } while (recovery);
    let cursor: string | null = null;
    do {
      const page = await matches.page(cursor, 25);
      await statistics.applyBatch(id, page.results);
      cursor = page.next;
    } while (cursor);
    await statistics.finish(id);
  } catch {
    await statistics.abort(id).catch(() => {});
    throw new Error("Statistics rebuild failed");
  }
}
export async function startStatisticsConsumer(options: {
  matches: Matches;
  statistics: Statistics;
  redisUrl: { reveal(): string };
  namespace: string;
  concurrency: number;
  drainTimeoutMs: number;
  unavailable(): void;
}) {
  if (
    !/^[A-Za-z0-9_-]{1,64}$/.test(options.namespace) ||
    !Number.isInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > 16 ||
    !Number.isInteger(options.drainTimeoutMs) ||
    options.drainTimeoutMs < 1000 ||
    options.drainTimeoutMs > 60000
  )
    throw new Error("Invalid statistics consumer configuration");
  const processing = finishProcessor(options.matches, options.statistics);
  const inflight = new Set<Promise<unknown>>();
  const worker = new Worker(
    outboxQueueNames.MATCH_FINISHED_V1,
    (job) => {
      const work = processing(job);
      inflight.add(work);
      void work.then(
        () => inflight.delete(work),
        () => inflight.delete(work),
      );
      return work;
    },
    {
      connection: queueConnection(options.redisUrl, true),
      prefix: `hambazi:jobs:${options.namespace}`,
      concurrency: options.concurrency,
    },
  );
  worker.on("error", () => {
    try {
      options.unavailable();
    } catch {
      /* best effort */
    }
  });
  async function bounded(task: Promise<unknown>, limit: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Statistics consumer deadline")), limit);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    await bounded(worker.waitUntilReady(), 5000);
  } catch {
    await worker.close(true).catch(() => {});
    throw new Error("Statistics consumer unavailable");
  }
  let closing: Promise<void> | undefined;
  return {
    close() {
      return (closing ??= (async () => {
        try {
          await bounded(
            worker.pause(true).then(() => Promise.allSettled([...inflight])),
            options.drainTimeoutMs,
          );
        } catch {
          throw new Error("Statistics consumer drain failed");
        } finally {
          await worker.close(true);
        }
      })());
    },
  };
}
