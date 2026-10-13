import { isAbsolute } from "node:path";
import { z } from "zod";
import { parseOwnerAdmissionConfig } from "./owner-admission.js";

const invalid = (): never => {
  throw new Error("KAHROBA_RUNTIME_CONFIGURATION_INVALID");
};
const flag = z.enum(["true", "false"]).transform((v) => v === "true");
const integer = (min: number, max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));
/** Dormant by default. Local synthetic admission is never valid in production. */
export function parseKahrobaRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>,
  role: "api" | "worker",
) {
  if (!Object.keys(env).some((k) => k.startsWith("KAHROBA_") && env[k] !== undefined))
    return undefined;
  const parsed = z
    .object({
      KAHROBA_RUNTIME_PROFILE: z.enum(["local-private-v1", "restricted-staging-v1"]),
      KAHROBA_ENGINE_REGISTERED: flag,
      KAHROBA_RUNTIME_ENABLED: flag,
      KAHROBA_ROUTES_ENABLED: flag,
      KAHROBA_ADMISSION_ENABLED: flag,
      KAHROBA_QUEUE_NAMESPACE: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      KAHROBA_RECONNECT_LEASE_MS: integer(1000, 86400000),
      KAHROBA_RECONNECT_GRACE_MS: integer(1000, 86400000),
    })
    .safeParse(env);
  if (!parsed.success) return invalid();
  const v = parsed.data;
  if (
    (v.KAHROBA_RUNTIME_ENABLED && !v.KAHROBA_ENGINE_REGISTERED) ||
    (v.KAHROBA_ROUTES_ENABLED && !v.KAHROBA_RUNTIME_ENABLED) ||
    (v.KAHROBA_ADMISSION_ENABLED && !v.KAHROBA_ROUTES_ENABLED)
  )
    return invalid();
  const local = v.KAHROBA_RUNTIME_PROFILE === "local-private-v1";
  if (local) {
    if (
      !["development", "test"].includes(env.NODE_ENV ?? "") ||
      env.PERSONAL_GAMEPLAY_PROFILE !== undefined ||
      env.AUTH_ADMISSION_POLICY !== undefined
    )
      return invalid();
    for (const key of role === "api"
      ? ["API_DATABASE_URL", "API_REDIS_URL"]
      : ["WORKER_DATABASE_URL", "WORKER_REDIS_URL"]) {
      try {
        if (new URL(env[key] ?? "").hostname !== "127.0.0.1") return invalid();
      } catch {
        return invalid();
      }
    }
    if (role === "api") {
      if (
        env.API_BIND_ADDRESS !== "127.0.0.1" ||
        !env.KAHROBA_LOCAL_ADMISSION_FILE ||
        !isAbsolute(env.KAHROBA_LOCAL_ADMISSION_FILE)
      )
        return invalid();
      try {
        if (
          !env.ALLOWED_ORIGINS?.split(",").every((o) => {
            const u = new URL(o);
            return u.hostname === "127.0.0.1" && u.protocol === "http:";
          })
        )
          return invalid();
      } catch {
        return invalid();
      }
    }
  } else {
    if (
      env.NODE_ENV !== "production" ||
      env.KAHROBA_LOCAL_ADMISSION_FILE !== undefined ||
      env.PERSONAL_GAMEPLAY_PROFILE !== "owner-bots-v1"
    )
      return invalid();
    if (
      role === "api" &&
      (!parseOwnerAdmissionConfig(env)?.testFile ||
        env.ALLOWED_ORIGINS !== "https://staging.hambazi.top")
    )
      return invalid();
  }
  if (
    role === "worker" &&
    (env.WORKER_QUEUE_NAMESPACE !== v.KAHROBA_QUEUE_NAMESPACE ||
      env.STATS_ENABLED !== "true" ||
      env.MATCH_OUTBOX_ENABLED !== "true")
  )
    return invalid();
  return Object.freeze({
    profile: v.KAHROBA_RUNTIME_PROFILE,
    local,
    maxPlayers: local ? 4 : 2,
    registered: v.KAHROBA_ENGINE_REGISTERED,
    enabled: v.KAHROBA_RUNTIME_ENABLED,
    routes: v.KAHROBA_ROUTES_ENABLED,
    admission: v.KAHROBA_ADMISSION_ENABLED,
    namespace: v.KAHROBA_QUEUE_NAMESPACE,
    reconnect: {
      schemaVersion: 1 as const,
      leaseMs: v.KAHROBA_RECONNECT_LEASE_MS,
      graceMs: v.KAHROBA_RECONNECT_GRACE_MS,
      maxConnections: 4,
    },
    ...(local && role === "api" ? { localAdmissionFile: env.KAHROBA_LOCAL_ADMISSION_FILE! } : {}),
  });
}
export type KahrobaRuntimeConfig = NonNullable<ReturnType<typeof parseKahrobaRuntimeConfig>>;
