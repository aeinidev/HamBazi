import { chatDeliverySchema } from "../chat/index.js";
import {
  createCorrelation,
  withCorrelation,
  createTelemetryLogger,
  reportTelemetry,
  withDeadline,
  type Telemetry,
} from "@hambazi/observability";
import { Worker, UnrecoverableError, WaitingError } from "bullmq";
import { matchDomainEventSchema } from "../matches/index.js";
/** One explicit Match or Chat delivery queue; results and matchmaking retain their owners. */
export function realtimeJobProcessor(
  publish: (event: unknown) => Promise<void>,
  kind: "MATCH_CHANGED_V1" | "CHAT_MESSAGE_V1" = "MATCH_CHANGED_V1",
  telemetry: Telemetry = createTelemetryLogger(),
) {
  return async (job: { name: string; data: unknown }) => {
    const event =
      kind === "CHAT_MESSAGE_V1"
        ? chatDeliverySchema.safeParse(job.data)
        : matchDomainEventSchema.safeParse(job.data);
    if (!event.success || event.data.type !== kind || job.name !== kind)
      throw new UnrecoverableError("Invalid realtime job");
    return withCorrelation(createCorrelation(event.data.correlation), async () => {
      const started = performance.now();
      try {
        await publish(event.data);
        reportTelemetry(telemetry, "realtime.delivery_completed", {
          matchId: event.data.aggregateId,
          durationMs: performance.now() - started,
        });
      } catch {
        reportTelemetry(telemetry, "realtime.delivery_failed", {
          matchId: event.data.aggregateId,
          errorCode: "INTERNAL_ERROR",
          durationMs: performance.now() - started,
        });
        throw new Error("Realtime delivery failed");
      }
      return { schemaVersion: 1, status: "DELIVERED" };
    });
  };
}
export function createRealtimeConsumer(options: {
  kind?: "MATCH_CHANGED_V1" | "CHAT_MESSAGE_V1";
  redisUrl: { reveal(): string };
  namespace: string;
  publish(event: unknown): Promise<void>;
  unavailable(): void;
  drainTimeoutMs?: number;
  concurrency?: number;
}) {
  const drainTimeoutMs = options.drainTimeoutMs ?? 15000;
  const concurrency = options.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100)
    throw new Error("Invalid realtime consumer concurrency");
  if (!Number.isInteger(drainTimeoutMs) || drainTimeoutMs < 1 || drainTimeoutMs > 120000)
    throw new Error("Invalid realtime consumer drain timeout");
  const url = new URL(options.redisUrl.reveal());
  if (
    !/^[A-Za-z0-9_-]{1,64}$/.test(options.namespace) ||
    !["redis:", "rediss:"].includes(url.protocol) ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid realtime queue configuration");
  const db = Number(url.pathname.slice(1) || 0);
  if (!Number.isInteger(db) || db < 0 || db > 15)
    throw new Error("Invalid realtime queue configuration");
  const active = new Set<Promise<unknown>>();
  let stopping = false;
  const processing = realtimeJobProcessor(options.publish, options.kind);
  const worker = new Worker(
    options.kind === "CHAT_MESSAGE_V1" ? "chat-message-v1" : "match-changed-v1",
    async (job, token) => {
      if (stopping) {
        await job.moveToWait(token);
        throw new WaitingError();
      }
      const work = processing(job);
      active.add(work);
      try {
        return await work;
      } finally {
        active.delete(work);
      }
    },
    {
      prefix: `hambazi:jobs:${options.namespace}`,
      connection: {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: Number(url.port || 6379),
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        db,
        ...(url.protocol === "rediss:" ? { tls: {} } : {}),
        maxRetriesPerRequest: null,
        connectTimeout: 2000,
      },
      concurrency,
    },
  );
  worker.on("error", () => {
    try {
      options.unavailable();
    } catch {
      /* best effort */
    }
  });
  let closing: Promise<void> | undefined;
  return Object.freeze({
    ready: () => worker.waitUntilReady().then(() => {}),
    close: () => {
      stopping = true;
      return (closing ??= withDeadline(
        (async () => {
          await worker.pause(true);
          await Promise.allSettled([...active]);
          await worker.close();
        })(),
        drainTimeoutMs,
      ));
    },
  });
}
