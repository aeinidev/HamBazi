import { Queue, Worker } from "bullmq";
import type { createMatchResultPort } from "@hambazi/api/matches";
import type { createStatisticsProjection } from "@hambazi/api/leaderboard";
import { domainEventProcessor, outboxQueueNames } from "./outbox-dispatcher.js";
import { queueConnection, probeQueue, requeueForDrain } from "./queue-connection.js";
import type { Telemetry } from "@hambazi/observability";
type Matches = ReturnType<typeof createMatchResultPort>;
type Statistics = ReturnType<typeof createStatisticsProjection>;
export function finishProcessor(
  matches: Matches,
  statistics: Statistics,
  telemetry?: Telemetry,
  version: 1 | 2 = 1,
) {
  return domainEventProcessor(
    version === 2 ? "MATCH_FINISHED_V2" : "MATCH_FINISHED_V1",
    async (event) => {
      const recorded = await matches.record(event);
      return statistics.consume(recorded);
    },
    telemetry,
  );
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
async function startVersionedStatisticsConsumer(
  options: {
    matches: Matches;
    statistics: Statistics;
    redisUrl: { reveal(): string };
    namespace: string;
    concurrency: number;
    drainTimeoutMs: number;
    unavailable(): void;
    telemetry?: Telemetry;
    diagnostics?: boolean;
  },
  version: 1 | 2,
) {
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
  const processing = finishProcessor(
    options.matches,
    options.statistics,
    options.telemetry,
    version,
  );
  const inflight = new Set<Promise<unknown>>();
  let stopping = false;
  let paused: Promise<void> | undefined;
  const diagnosticQueue = options.diagnostics
    ? new Queue(outboxQueueNames[version === 2 ? "MATCH_FINISHED_V2" : "MATCH_FINISHED_V1"], {
        connection: queueConnection(options.redisUrl, false),
        prefix: `hambazi:jobs:${options.namespace}`,
      })
    : undefined;
  diagnosticQueue?.on("error", () => {
    /* Collection validity carries this failure; never report raw diagnostics. */
  });
  const worker = new Worker(
    outboxQueueNames[version === 2 ? "MATCH_FINISHED_V2" : "MATCH_FINISHED_V1"],
    (job, token) => {
      if (stopping) return requeueForDrain(job, token!);
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
    await diagnosticQueue?.close().catch(() => {});
    throw new Error("Statistics consumer unavailable");
  }
  let closing: Promise<void> | undefined;
  const stopAdmission = () => {
    stopping = true;
    return (paused ??= worker.pause(true));
  };
  const settled = async () => {
    await paused?.catch(() => {});
    await Promise.allSettled([...inflight]);
  };
  return {
    counts: async () => {
      if (!diagnosticQueue) throw new Error("Statistics diagnostics disabled");
      return diagnosticQueue.getJobCounts("waiting", "active", "delayed", "failed");
    },
    stopAdmission,
    settled,
    probe: async () => !stopping && (await probeQueue(worker)),
    close() {
      const pause = stopAdmission();
      return (closing ??= (async () => {
        try {
          await bounded(
            pause.then(() => Promise.allSettled([...inflight])),
            options.drainTimeoutMs,
          );
        } catch {
          throw new Error("Statistics consumer drain failed");
        } finally {
          await worker.close(true);
          await diagnosticQueue?.close();
        }
      })());
    },
  };
}

export async function startStatisticsConsumer(
  options: Parameters<typeof startVersionedStatisticsConsumer>[0],
) {
  const first = await startVersionedStatisticsConsumer(options, 1);
  let second: Awaited<ReturnType<typeof startVersionedStatisticsConsumer>>;
  try {
    second = await startVersionedStatisticsConsumer(options, 2);
  } catch {
    await first.close();
    throw new Error("Statistics consumer unavailable");
  }
  const both = [first, second];
  return {
    stopAdmission: () => Promise.all(both.map((w) => w.stopAdmission())).then(() => {}),
    settled: () => Promise.all(both.map((w) => w.settled())).then(() => {}),
    probe: async () => (await Promise.all(both.map((w) => w.probe()))).every(Boolean),
    counts: async () => {
      const counts = await Promise.all(both.map((w) => w.counts()));
      return Object.fromEntries(
        ["waiting", "active", "delayed", "failed"].map((key) => [
          key,
          counts.reduce((n, c) => n + (c[key] ?? 0), 0),
        ]),
      );
    },
    close: async () => {
      const outcomes = await Promise.allSettled(both.map((w) => w.close()));
      if (outcomes.some((r) => r.status === "rejected"))
        throw new Error("Statistics consumer drain failed");
    },
  };
}
