import { isIP } from "node:net";
import { z } from "zod";
import { SecretValue } from "./secret-value.js";
const integer = (min: number, max: number) =>
  z
    .string()
    .regex(/^[0-9]+$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
const key = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .refine(
    (v) =>
      Buffer.from(v, "base64url").length === 32 &&
      Buffer.from(v, "base64url").toString("base64url") === v,
  );
const privateIp = (v: string) =>
  isIP(v) === 4 && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(v);
const schema = z.object({
  ADMIN_REALM: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  ADMIN_ENVIRONMENT: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  ADMIN_ORIGIN: z
    .string()
    .url()
    .refine((v) => {
      const u = new URL(v);
      return u.protocol === "https:" && u.origin === v && !u.username && !u.password;
    }),
  ADMIN_BIND_ADDRESS: z.string().refine(privateIp),
  ADMIN_PORT: integer(1, 65535),
  ADMIN_PRIVATE_PEERS: z
    .string()
    .transform((v) => v.split(","))
    .pipe(z.array(z.string().refine(privateIp)).min(1).max(16)),
  ADMIN_DATABASE_URL: z.string().url(),
  ADMIN_READ_DATABASE_URL: z.string().url(),
  ADMIN_DB_POOL_MAX: integer(1, 10),
  ADMIN_SESSION_SECONDS: integer(60, 28800),
  ADMIN_IDLE_SECONDS: integer(30, 3600),
  ADMIN_PENDING_SECONDS: integer(30, 300),
  ADMIN_SIGNING_KEY: key,
  ADMIN_PIN_PEPPER: key,
  ADMIN_COMMAND_KEY: key,
  ADMIN_ISSUER: z.string().regex(/^[\x21-\x7e]{1,256}$/),
  ADMIN_AUDIENCE: z.string().regex(/^[\x21-\x7e]{1,256}$/),
  ADMIN_ARGON_MEMORY_KIB: integer(19456, 262144),
  ADMIN_ARGON_TIME: integer(2, 6),
  ADMIN_CRYPTO_CONCURRENCY: integer(1, 2),
  ADMIN_MAX_IN_FLIGHT: integer(1, 32),
  ADMIN_TLS_KEY_FILE: z.string().startsWith("/"),
  ADMIN_TLS_CERT_FILE: z.string().startsWith("/"),
  ADMIN_RATE_LIMIT: integer(1, 120),
  ADMIN_REDIS_URL: z.string().url(),
});
export function parseAdminConfig(environment: Readonly<Record<string, string | undefined>>) {
  if (environment.ADMIN_ENABLED === undefined || environment.ADMIN_ENABLED === "false") return null;
  if (environment.ADMIN_ENABLED !== "true") throw new Error("ADMIN_CONFIGURATION_INVALID");
  const p = schema.safeParse(environment);
  if (!p.success) throw new Error("ADMIN_CONFIGURATION_INVALID");
  const v = p.data;
  const keys = [v.ADMIN_SIGNING_KEY, v.ADMIN_PIN_PEPPER, v.ADMIN_COMMAND_KEY];
  if (
    new Set(keys).size !== keys.length ||
    keys.some((k) => environment.AUTH_SIGNING_KEYS?.includes(k)) ||
    v.ADMIN_IDLE_SECONDS > v.ADMIN_SESSION_SECONDS
  )
    throw new Error("ADMIN_CONFIGURATION_INVALID");
  for (const url of [v.ADMIN_DATABASE_URL, v.ADMIN_READ_DATABASE_URL]) {
    const u = new URL(url);
    if (
      !["postgres:", "postgresql:"].includes(u.protocol) ||
      !u.username ||
      !u.password ||
      u.pathname === "/" ||
      (environment.NODE_ENV === "production" && u.searchParams.get("sslmode") !== "verify-full")
    )
      throw new Error("ADMIN_CONFIGURATION_INVALID");
  }
  const redis = new URL(v.ADMIN_REDIS_URL);
  if (
    !["redis:", "rediss:"].includes(redis.protocol) ||
    !redis.password ||
    (environment.NODE_ENV === "production" && redis.protocol !== "rediss:")
  )
    throw new Error("ADMIN_CONFIGURATION_INVALID");
  return Object.freeze({
    realmId: v.ADMIN_REALM,
    environment: v.ADMIN_ENVIRONMENT,
    origin: v.ADMIN_ORIGIN,
    bindAddress: v.ADMIN_BIND_ADDRESS,
    port: v.ADMIN_PORT,
    privatePeers: v.ADMIN_PRIVATE_PEERS,
    databaseUrl: new SecretValue(v.ADMIN_DATABASE_URL),
    readDatabaseUrl: new SecretValue(v.ADMIN_READ_DATABASE_URL),
    poolMax: v.ADMIN_DB_POOL_MAX,
    sessionSeconds: v.ADMIN_SESSION_SECONDS,
    idleSeconds: v.ADMIN_IDLE_SECONDS,
    pendingSeconds: v.ADMIN_PENDING_SECONDS,
    signingKey: new SecretValue(v.ADMIN_SIGNING_KEY),
    pinPepper: new SecretValue(v.ADMIN_PIN_PEPPER),
    commandKey: new SecretValue(v.ADMIN_COMMAND_KEY),
    issuer: v.ADMIN_ISSUER,
    audience: v.ADMIN_AUDIENCE,
    memoryCost: v.ADMIN_ARGON_MEMORY_KIB,
    timeCost: v.ADMIN_ARGON_TIME,
    maxCryptoInFlight: v.ADMIN_CRYPTO_CONCURRENCY,
    maxInFlight: v.ADMIN_MAX_IN_FLIGHT,
    tlsKeyFile: v.ADMIN_TLS_KEY_FILE,
    tlsCertFile: v.ADMIN_TLS_CERT_FILE,
    rateLimit: v.ADMIN_RATE_LIMIT,
    redisUrl: new SecretValue(v.ADMIN_REDIS_URL),
  });
}
export type AdminConfig = NonNullable<ReturnType<typeof parseAdminConfig>>;
