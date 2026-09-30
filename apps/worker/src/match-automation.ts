import { hash, randomUUID } from "node:crypto";
import { Queue, Worker, UnrecoverableError } from "bullmq";
import { z } from "zod";
import {
  automationIntentSchema,
  matchCorrelationSchema,
  disconnectTimeoutSchema,
  type MatchAutomationPort,
  type MatchReconnectPort,
} from "@hambazi/api/matches";
import { queueConnection } from "./queue-connection.js";

export const matchJobSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    schemaVersion: z.literal(1),
    correlation: matchCorrelationSchema.optional(),
    kind: z.literal("DISCONNECT"),
    payload: disconnectTimeoutSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    correlation: matchCorrelationSchema.optional(),
    kind: z.literal("AUTOMATION"),
    payload: automationIntentSchema,
  }),
]);
export type MatchJob = z.infer<typeof matchJobSchema>;
const name = "match-automation-v1";
export const matchJobId = (job: MatchJob) => {
  const parsed = matchJobSchema.parse(job);
  return hash(
    "sha256",
    JSON.stringify({
      schemaVersion: parsed.schemaVersion,
      kind: parsed.kind,
      payload: parsed.payload,
    }),
  );
};
export function matchJobProcessor(ports: {
  automation: MatchAutomationPort;
  reconnect: MatchReconnectPort;
}) {
  return async (job: { name: string; data: unknown }) => {
    const parsed = matchJobSchema.safeParse(job.data);
    if (job.name !== name || !parsed.success) throw new UnrecoverableError("Invalid Match job");
    try {
      const input = parsed.data;
      const context = input.correlation ?? { requestId: randomUUID() };
      if (input.kind === "AUTOMATION") await ports.automation.execute(input.payload, context);
      else {
        const result = await ports.reconnect.timeout(input.payload, context);
        if (!result.ok) throw new Error();
      }
      return { schemaVersion: 1 };
    } catch {
      throw new Error("Match job failed");
    }
  };
}
const settings = z.strictObject({
  namespace: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  intervalMs: z.number().int().min(10).max(86400000),
  batchSize: z.number().int().min(1).max(100),
  attempts: z.number().int().min(1).max(10),
  backoffMs: z.number().int().min(1).max(60000),
  drainTimeoutMs: z.number().int().min(100).max(60000),
});
/** Opt-in composition: all timing/settings and pinned Match ports are supplied explicitly. */
export async function startMatchAutomation(
  options: z.infer<typeof settings> & {
    redisUrl: { reveal(): string };
    automation: MatchAutomationPort;
    reconnect: MatchReconnectPort;
    event(name: "worker.job_completed" | "worker.job_failed" | "worker.queue_unavailable"): void;
  },
) {
  const config = settings.parse({
    namespace: options.namespace,
    intervalMs: options.intervalMs,
    batchSize: options.batchSize,
    attempts: options.attempts,
    backoffMs: options.backoffMs,
    drainTimeoutMs: options.drainTimeoutMs,
  });
  const prefix = `hambazi:jobs:${config.namespace}`;
  const queue = new Queue(name, {
    connection: queueConnection(options.redisUrl, false, 2000),
    prefix,
  });
  let stopping = false;
  const active = new Set<Promise<unknown>>();
  const process = matchJobProcessor(options);
  const worker = new Worker(
    name,
    async (job) => {
      if (stopping) throw new Error("Match automation closed");
      const operation = process(job);
      active.add(operation);
      try {
        return await operation;
      } finally {
        active.delete(operation);
      }
    },
    {
      connection: queueConnection(options.redisUrl, true),
      prefix,
      autorun: false,
      concurrency: 1,
      maxStalledCount: 1,
      lockDuration: 30000,
    },
  );
  queue.on("error", () => options.event("worker.queue_unavailable"));
  worker.on("error", () => options.event("worker.queue_unavailable"));
  worker.on("failed", () => options.event("worker.job_failed"));
  worker.on("completed", () => options.event("worker.job_completed"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let after: string | null = null;
  async function schedule(job: MatchJob) {
    if (stopping) throw new Error("Match automation closed");
    const parsed = matchJobSchema.parse(job);
    await queue.add(
      name,
      { ...parsed, correlation: parsed.correlation ?? { requestId: randomUUID() } },
      {
        jobId: matchJobId(job),
        delay: Math.max(0, job.payload.deadlineAt - Date.now()),
        attempts: config.attempts,
        backoff: { type: "exponential", delay: config.backoffMs },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
  async function recover() {
    const page = await options.automation.recover({
      schemaVersion: 1,
      after,
      limit: config.batchSize,
    });
    for (const matchId of page.matchIds) {
      if (stopping) break;
      try {
        const plan = await options.automation.plan(matchId);
        for (const playerId of plan?.playerIds ?? []) {
          const result = await options.reconnect.reconcile({ schemaVersion: 1, matchId, playerId });
          if (!result.ok) throw new Error();
          if (result.value.timeout)
            await schedule({ schemaVersion: 1, kind: "DISCONNECT", payload: result.value.timeout });
        }
        // Presence reconciliation may have advanced the Match version. Plan only after it commits.
        const fresh = await options.automation.plan(matchId);
        if (fresh?.intent)
          await schedule({ schemaVersion: 1, kind: "AUTOMATION", payload: fresh.intent });
      } catch {
        options.event("worker.job_failed");
      }
    }
    after = page.next;
  }
  function tick() {
    running = recover()
      .catch(() => options.event("worker.queue_unavailable"))
      .finally(() => {
        if (!stopping) {
          timer = setTimeout(tick, config.intervalMs);
          timer.unref();
        }
      });
  }
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]),
      new Promise<never>((_, reject) => {
        startupTimer = setTimeout(() => reject(new Error()), 5000);
      }),
    ]);
    clearTimeout(startupTimer);
    void worker.run().catch(() => options.event("worker.queue_unavailable"));
    tick();
    let closing: Promise<void> | undefined;
    return Object.freeze({
      schedule,
      // Cancellation is an optimization only. An active/racing job is fenced in PostgreSQL.
      async cancel(job: MatchJob) {
        try {
          await queue.remove(matchJobId(job));
        } catch {
          /* recovery and durable guards remain authoritative */
        }
      },
      close() {
        return (closing ??= (async () => {
          stopping = true;
          clearTimeout(timer);
          await worker.pause(true);
          let deadline: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              Promise.allSettled([running, ...active]),
              new Promise<never>((_, reject) => {
                deadline = setTimeout(
                  () => reject(new Error("Match automation drain deadline")),
                  config.drainTimeoutMs,
                );
              }),
            ]);
          } finally {
            clearTimeout(deadline);
            // Application writes have drained (or the caller receives a deadline failure).
            // Force-close Redis even during an outage; unacknowledged jobs safely recover.
            await worker.close(true);
            await queue.disconnect();
            await queue.close();
          }
        })());
      },
    });
  } catch {
    clearTimeout(startupTimer);
    stopping = true;
    clearTimeout(timer);
    await worker.close(true).catch(() => {});
    await queue.close().catch(() => {});
    throw new Error("Match automation startup failed");
  }
}
