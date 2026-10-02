import { z } from "zod";
const integer = (min: number, max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));
export class OperationsConfigurationError extends Error {
  readonly code = "INVALID_CONFIGURATION";
  constructor(readonly fields: readonly string[]) {
    super("Operations configuration is invalid");
  }
}
/** No public bind address, credential, exporter or final SLO policy is selected here. */
export function parseOperationsConfig(
  env: Readonly<Record<string, string | undefined>>,
  role: "api" | "bot" | "worker",
) {
  if (!["api", "bot", "worker"].includes(role)) throw new OperationsConfigurationError(["ROLE"]);
  const prefix = role.toUpperCase();
  const port = `${prefix}_HEALTH_PORT`;
  const probe = `${prefix}_HEALTH_PROBE_TIMEOUT_MS`;
  const drain = `${prefix}_DRAIN_TIMEOUT_MS`;
  const parsed = z
    .object({
      [port]: integer(1, 65535).optional(),
      [probe]: integer(100, 5000).optional(),
      [drain]: integer(1000, 120000).optional(),
    })
    .safeParse(env);
  if (!parsed.success)
    throw new OperationsConfigurationError([
      ...new Set(parsed.error.issues.map((i) => String(i.path[0]))),
    ]);
  return Object.freeze({
    port: parsed.data[port],
    probeTimeoutMs: parsed.data[probe] ?? 1000,
    // Preserve preceding process supervisors' budgets, not a finalized production SLO.
    drainTimeoutMs: parsed.data[drain] ?? (role === "bot" ? 30000 : 15000),
  });
}
