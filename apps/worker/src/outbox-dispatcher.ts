import { Queue, UnrecoverableError } from "bullmq";
import {
  matchDomainEventSchema,
  type MatchDomainEvent,
  type MatchOutboxPort,
} from "@hambazi/api/matches";
import { queueConnection } from "./queue-connection.js";
export const outboxQueueNames = Object.freeze({
  "matchmaking.found": "matchmaking-found-v1",
  MATCH_CHANGED_V1: "match-changed-v1",
  MATCH_FINISHED_V1: "match-finished-v1",
});
export type OutboxEventName =
  | "worker.outbox_published"
  | "worker.outbox_retry"
  | "worker.outbox_failed"
  | "worker.outbox_unavailable";
export interface OutboxObservation {
  matchId: string;
  stateVersion?: number;
  requestId?: string;
}
export type OutboxReporter = (event: OutboxEventName, fields?: OutboxObservation) => void;
export interface DomainPublisher {
  publish(event: MatchDomainEvent): Promise<void>;
  close(): Promise<void>;
}
export function createOutboxDispatcher(options: {
  outbox: MatchOutboxPort;
  publisher: DomainPublisher;
  batchSize: number;
  publishTimeoutMs: number;
  event: OutboxReporter;
}) {
  if (
    !Number.isInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > 100 ||
    !Number.isInteger(options.publishTimeoutMs) ||
    options.publishTimeoutMs < 1
  )
    throw new Error("Invalid dispatcher configuration");
  let active: Promise<void> | undefined;
  let closed = false;
  function report(name: OutboxEventName, event?: MatchDomainEvent) {
    // Observer failures cannot change delivery or database decisions.
    try {
      options.event(
        name,
        event
          ? {
              matchId: event.aggregateId,
              ...("stateVersion" in event.payload
                ? { stateVersion: event.payload.stateVersion }
                : {}),
              ...(event.correlation.requestId === undefined
                ? {}
                : { requestId: event.correlation.requestId }),
            }
          : undefined,
      );
    } catch {
      /* telemetry is best effort */
    }
  }
  async function dispatch() {
    const claims = await options.outbox.claim(options.batchSize);
    const results = await Promise.allSettled(
      claims.map(async (claim) => {
        if (claim.event === null) {
          await options.outbox.failed(claim.eventId, claim.attempt, true);
          report("worker.outbox_failed");
          return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            options.publisher.publish(claim.event),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Publish deadline")),
                options.publishTimeoutMs,
              );
            }),
          ]);
        } catch {
          await options.outbox.failed(claim.eventId, claim.attempt);
          report("worker.outbox_retry", claim.event);
          return;
        } finally {
          clearTimeout(timer);
        }
        // A failed/uncertain mark is not treated as a failed publication. Lease recovery redelivers.
        if (await options.outbox.published(claim.eventId, claim.attempt))
          report("worker.outbox_published", claim.event);
      }),
    );
    if (results.some((result) => result.status === "rejected")) report("worker.outbox_unavailable");
  }
  return Object.freeze({
    runOnce(): Promise<void> {
      if (closed) return Promise.resolve();
      if (!active)
        active = dispatch()
          .catch(() => {
            report("worker.outbox_unavailable");
          })
          .finally(() => {
            active = undefined;
          });
      return active;
    },
    async close() {
      closed = true;
      await active;
    },
  });
}
export async function createBullMqDomainPublisher(options: {
  redisUrl: { reveal(): string };
  namespace: string;
  timeoutMs: number;
  attempts: number;
  backoffMs: number;
  event: OutboxReporter;
}): Promise<DomainPublisher> {
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 100 ||
    options.timeoutMs > 30000 ||
    !Number.isInteger(options.attempts) ||
    options.attempts < 1 ||
    options.attempts > 20 ||
    !Number.isInteger(options.backoffMs) ||
    options.backoffMs < 100 ||
    options.backoffMs > 60000 ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(options.namespace)
  )
    throw new Error("Invalid outbox namespace");
  const queues = Object.fromEntries(
    Object.entries(outboxQueueNames).map(([type, name]) => {
      const queue = new Queue(name, {
        connection: queueConnection(options.redisUrl, false, options.timeoutMs),
        prefix: `hambazi:jobs:${options.namespace}`,
      });
      queue.on("error", () => {
        try {
          options.event("worker.outbox_unavailable");
        } catch {
          /* best effort */
        }
      });
      return [type, queue];
    }),
  ) as Record<MatchDomainEvent["type"], Queue>;
  let closing: Promise<void> | undefined;
  return {
    async publish(input) {
      if (closing) throw new Error("Outbox publisher closed");
      const event = matchDomainEventSchema.safeParse(input);
      if (!event.success) throw new Error("Invalid domain event");
      try {
        await queues[event.data.type].add(event.data.type, event.data, {
          jobId: event.data.eventId,
          attempts: options.attempts,
          backoff: { type: "exponential", delay: options.backoffMs },
          removeOnComplete: true,
          removeOnFail: false,
        });
      } catch {
        throw new Error("Domain publication failed");
      }
    },
    close() {
      return (closing ??= Promise.all(Object.values(queues).map((q) => q.close())).then(() => {}));
    },
  };
}
/** Owning consumer must atomically commit its effect and receipt via consumeOnce. */
export function domainEventProcessor(
  type: MatchDomainEvent["type"],
  consume: (event: MatchDomainEvent) => Promise<"APPLIED" | "DUPLICATE">,
) {
  return async (job: { name: string; data: unknown }) => {
    const parsed = matchDomainEventSchema.safeParse(job.data);
    if (!parsed.success || job.name !== type || parsed.data.type !== type)
      throw new UnrecoverableError("Invalid domain job");
    try {
      const status = await consume(parsed.data);
      if (status !== "APPLIED" && status !== "DUPLICATE") throw new Error();
      return { schemaVersion: 1, status };
    } catch {
      throw new Error("Domain consumer failed");
    }
  };
}
export function startOutboxLoop(
  dispatcher: ReturnType<typeof createOutboxDispatcher>,
  intervalMs: number,
) {
  if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60000)
    throw new Error("Invalid outbox interval");
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function tick() {
    await dispatcher.runOnce();
    if (!stopped)
      timer = setTimeout(() => {
        void tick();
      }, intervalMs);
  }
  void tick();
  return {
    async close() {
      stopped = true;
      clearTimeout(timer);
      await dispatcher.close();
    },
  };
}
