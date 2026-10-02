import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";

export interface Correlation {
  readonly requestId: string;
  readonly traceparent: string;
}
const storage = new AsyncLocalStorage<Correlation>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Read only an own scalar data property: never invoke getters/toJSON on telemetry input. */
export function ownValue(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}
export function safeId(value: unknown): string | undefined {
  return typeof value === "string" && value.length === 36 && uuid.test(value)
    ? value.toLowerCase()
    : undefined;
}
export function safeTraceparent(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length === 55 &&
    /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/.test(value) &&
    value.slice(3, 35) !== "0".repeat(32) &&
    value.slice(36, 52) !== "0".repeat(16)
    ? value
    : undefined;
}
function randomHex(size: number): string {
  let value: string;
  do {
    value = randomBytes(size).toString("hex");
  } while (/^0+$/.test(value));
  return value;
}
/** A server-owned root, or a child of validated trusted internal metadata. Never pass public headers. */
export function createCorrelation(parent?: unknown): Correlation {
  const traceparent = safeTraceparent(ownValue(parent, "traceparent"));
  return Object.freeze({
    requestId: safeId(ownValue(parent, "requestId")) ?? randomUUID(),
    traceparent: `00-${traceparent?.slice(3, 35) ?? randomHex(16)}-${randomHex(8)}-${traceparent?.slice(53) ?? "00"}`,
  });
}
export function currentCorrelation(): Correlation | undefined {
  return storage.getStore();
}
/** run restores the caller's context after success, rejection or a synchronous throw. */
export function withCorrelation<T>(context: Correlation, operation: () => T): T {
  const requestId = safeId(ownValue(context, "requestId"));
  const traceparent = safeTraceparent(ownValue(context, "traceparent"));
  if (!requestId || !traceparent) throw new Error("Invalid telemetry context");
  return storage.run(Object.freeze({ requestId, traceparent }), operation);
}
