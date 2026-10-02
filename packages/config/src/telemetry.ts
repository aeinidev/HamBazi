import { z } from "zod";
import { SecretValue } from "./secret-value.js";
import { OperationsConfigurationError } from "./operations.js";
const dsn = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const u = new URL(value);
      return (
        u.protocol === "https:" &&
        /^[a-f0-9]{32}$/.test(u.username) &&
        !u.password &&
        /^\/[1-9][0-9]{0,19}$/.test(u.pathname) &&
        !u.search &&
        !u.hash &&
        Boolean(u.hostname)
      );
    } catch {
      return false;
    }
  });
/** Export disabled by default. Trusted deployment config supplies an approved target separately. */
export function parseTelemetryConfig(
  env: Readonly<Record<string, string | undefined>>,
  role: "api" | "bot" | "worker",
) {
  if (!["api", "bot", "worker"].includes(role)) throw new OperationsConfigurationError(["ROLE"]);
  const prefix = role.toUpperCase();
  const enabled = `${prefix}_METRICS_ENABLED`,
    target = `${prefix}_SENTRY_DSN`,
    port = `${prefix}_HEALTH_PORT`;
  const parsed = z
    .object({ [enabled]: z.enum(["true", "false"]).optional(), [target]: dsn.optional() })
    .safeParse(env);
  if (!parsed.success)
    throw new OperationsConfigurationError([
      ...new Set(parsed.error.issues.map((i) => String(i.path[0]))),
    ]);
  const metricsEnabled = parsed.data[enabled] === "true";
  if (
    metricsEnabled &&
    (!/^\d+$/.test(env[port] ?? "") || Number(env[port]) < 1 || Number(env[port]) > 65535)
  )
    throw new OperationsConfigurationError([port]);
  return Object.freeze({
    metricsEnabled,
    sentryDsn: parsed.data[target] ? new SecretValue(parsed.data[target]) : undefined,
  });
}
