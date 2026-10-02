import type { ConnectionOptions } from "bullmq";
import { WaitingError } from "bullmq";
/** A fetch racing local pause is returned without consuming a failure attempt. */
export async function requeueForDrain(
  job: { moveToWait(token?: string): Promise<number> },
  token: string,
): Promise<never> {
  await job.moveToWait(token);
  throw new WaitingError();
}
export async function probeQueue(transport: {
  getBackend(): { readonly client: Promise<{ readonly status: string; info(): Promise<string> }> };
}) {
  try {
    const client = await transport.getBackend().client;
    // BullMQ 6 exposes INFO, not PING, on its public Redis client contract.
    // Discard all server details; no queue mutation or application key read.
    return client.status === "ready" && typeof (await client.info()) === "string";
  } catch {
    return false;
  }
}
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
