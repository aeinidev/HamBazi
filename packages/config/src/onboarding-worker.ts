import { z } from "zod";
const integer = (min: number, max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));
const shape = {
  WORKER_QUEUE_NAMESPACE: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  BOT_CLEANUP_INTERVAL_MS: integer(1000, 3600000),
  BOT_CLEANUP_BATCH_SIZE: integer(1, 500),
  BOT_CLEANUP_ATTEMPTS: integer(1, 5),
  BOT_CLEANUP_BACKOFF_MS: integer(100, 60000),
  WORKER_DB_POOL_MAX: integer(1, 20),
};
export class OnboardingWorkerConfigurationError extends Error {
  readonly code = "INVALID_CONFIGURATION";
  constructor(readonly fields: readonly string[]) {
    super("Onboarding worker configuration is invalid");
  }
}
export function parseOnboardingWorkerConfig(env: Readonly<Record<string, string | undefined>>) {
  const parsed = z.object(shape).safeParse(env);
  if (!parsed.success)
    throw new OnboardingWorkerConfigurationError([
      ...new Set(parsed.error.issues.map((i) => String(i.path[0]))),
    ]);
  const v = parsed.data;
  return Object.freeze({
    namespace: v.WORKER_QUEUE_NAMESPACE,
    intervalMs: v.BOT_CLEANUP_INTERVAL_MS,
    batchSize: v.BOT_CLEANUP_BATCH_SIZE,
    attempts: v.BOT_CLEANUP_ATTEMPTS,
    backoffMs: v.BOT_CLEANUP_BACKOFF_MS,
    poolMax: v.WORKER_DB_POOL_MAX,
  });
}
