import { Worker, UnrecoverableError } from "bullmq";
import { matchDomainEventSchema } from "../matches/index.js";
/** Only the MATCH_CHANGED queue is consumed here. Results and matchmaking retain their owners. */
export function realtimeJobProcessor(publish: (event: unknown) => Promise<void>) {
  return async (job: { name: string; data: unknown }) => {
    const event = matchDomainEventSchema.safeParse(job.data);
    if (!event.success || event.data.type !== "MATCH_CHANGED_V1" || job.name !== "MATCH_CHANGED_V1")
      throw new UnrecoverableError("Invalid realtime job");
    try {
      await publish(event.data);
    } catch {
      throw new Error("Realtime delivery failed");
    }
    return { schemaVersion: 1, status: "DELIVERED" };
  };
}
export function createRealtimeConsumer(options: {
  redisUrl: { reveal(): string };
  namespace: string;
  publish(event: unknown): Promise<void>;
  unavailable(): void;
}) {
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
  const worker = new Worker("match-changed-v1", realtimeJobProcessor(options.publish), {
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
    concurrency: 1,
  });
  worker.on("error", () => {
    try {
      options.unavailable();
    } catch {
      /* best effort */
    }
  });
  return Object.freeze({
    ready: () => worker.waitUntilReady().then(() => {}),
    close: () => worker.close(),
  });
}
