import type { ConnectionOptions } from "bullmq";
export function queueConnection(
  secret: { reveal(): string },
  worker: boolean,
  commandTimeoutMs?: number,
): ConnectionOptions {
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
    ...(commandTimeoutMs === undefined ? {} : { commandTimeout: commandTimeoutMs }),
    retryStrategy: (attempt: number) => Math.min(attempt * 200, 2000),
  };
}
