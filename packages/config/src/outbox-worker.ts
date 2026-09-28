import { z } from "zod";
const integer = (min: number, max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));
const schema = z
  .object({
    MATCH_OUTBOX_ENABLED: z.literal("true"),
    MATCH_OUTBOX_INTERVAL_MS: integer(100, 60000),
    MATCH_OUTBOX_BATCH_SIZE: integer(1, 100),
    MATCH_OUTBOX_LEASE_MS: integer(1000, 300000),
    MATCH_OUTBOX_ATTEMPTS: integer(1, 20),
    MATCH_OUTBOX_BACKOFF_MS: integer(100, 60000),
    MATCH_OUTBOX_MAX_BACKOFF_MS: integer(100, 3600000),
    MATCH_OUTBOX_PUBLISH_TIMEOUT_MS: integer(100, 30000),
  })
  .refine(
    (v) =>
      v.MATCH_OUTBOX_LEASE_MS > v.MATCH_OUTBOX_PUBLISH_TIMEOUT_MS &&
      v.MATCH_OUTBOX_MAX_BACKOFF_MS >= v.MATCH_OUTBOX_BACKOFF_MS,
  );
export function parseOutboxWorkerConfig(env: Readonly<Record<string, string | undefined>>) {
  const enabled = env.MATCH_OUTBOX_ENABLED;
  if (enabled === "false") return undefined;
  if (
    enabled === undefined &&
    !Object.keys(env).some(
      (key) =>
        key.startsWith("MATCH_OUTBOX_") && key !== "MATCH_OUTBOX_ENABLED" && env[key] !== undefined,
    )
  )
    return undefined;
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error("Invalid outbox worker configuration");
  const v = parsed.data;
  return Object.freeze({
    intervalMs: v.MATCH_OUTBOX_INTERVAL_MS,
    batchSize: v.MATCH_OUTBOX_BATCH_SIZE,
    publishTimeoutMs: v.MATCH_OUTBOX_PUBLISH_TIMEOUT_MS,
    policy: {
      leaseMs: v.MATCH_OUTBOX_LEASE_MS,
      maxAttempts: v.MATCH_OUTBOX_ATTEMPTS,
      backoffMs: v.MATCH_OUTBOX_BACKOFF_MS,
      maxBackoffMs: v.MATCH_OUTBOX_MAX_BACKOFF_MS,
    },
  });
}
