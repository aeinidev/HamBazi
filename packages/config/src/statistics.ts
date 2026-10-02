import { z } from "zod";
export function parseStatisticsConfig(
  env: Readonly<Record<string, string | undefined>>,
  role: "api",
): { enabled: true } | undefined;
export function parseStatisticsConfig(
  env: Readonly<Record<string, string | undefined>>,
  role: "worker",
): { enabled: true; concurrency: number; drainTimeoutMs: number } | undefined;
export function parseStatisticsConfig(
  env: Readonly<Record<string, string | undefined>>,
  role: "api" | "worker",
) {
  if (
    env.STATS_ENABLED === "false" ||
    (env.STATS_ENABLED === undefined &&
      env.STATS_CONCURRENCY === undefined &&
      env.STATS_DRAIN_TIMEOUT_MS === undefined)
  )
    return undefined;
  if (env.STATS_ENABLED !== "true") throw new Error("Statistics configuration is invalid");
  if (role === "api") return { enabled: true as const };
  const integer = (min: number, max: number) =>
    z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));
  const parsed = z
    .object({ STATS_CONCURRENCY: integer(1, 16), STATS_DRAIN_TIMEOUT_MS: integer(1000, 60000) })
    .safeParse(env);
  if (!parsed.success) throw new Error("Statistics configuration is invalid");
  return {
    enabled: true as const,
    concurrency: parsed.data.STATS_CONCURRENCY,
    drainTimeoutMs: parsed.data.STATS_DRAIN_TIMEOUT_MS,
  };
}
