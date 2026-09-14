import { isIP } from "node:net";
import { z } from "zod";
import { SecretValue } from "./secret-value.js";

const integer = (min: number, max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));
const keyId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const binding = z.string().regex(/^[\x21-\x7E]{1,256}$/);
function proxy(value: string): boolean {
  const [address, prefix, extra] = value.split("/");
  const family = isIP(address ?? "");
  return (
    !!family &&
    extra === undefined &&
    (prefix === undefined ||
      (/^\d{1,3}$/.test(prefix) &&
        Number(prefix) >= 1 &&
        Number(prefix) <= (family === 4 ? 32 : 128)))
  );
}
const shape = {
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d{1,20}:[A-Za-z0-9_-]{20,200}$/),
  AUTH_SESSION_SECONDS: integer(60, 1800),
  AUTH_TELEGRAM_MAX_AGE_SECONDS: integer(30, 600),
  AUTH_TELEGRAM_FUTURE_SKEW_SECONDS: integer(0, 30),
  AUTH_IP_LIMIT: integer(1, 300),
  AUTH_IDENTITY_LIMIT: integer(1, 30),
  AUTH_ACTIVE_KEY_ID: keyId,
  AUTH_ISSUER: binding,
  AUTH_AUDIENCE: binding,
  AUTH_SIGNING_KEYS: z.string().min(1).max(8192),
  API_TRUSTED_PROXIES: z
    .string()
    .max(2048)
    .transform((v) => (v === "" ? [] : v.split(",")))
    .pipe(z.array(z.string().refine(proxy)).max(32)),
  API_BIND_ADDRESS: z.string().refine((v) => isIP(v) !== 0),
  API_DB_POOL_MAX: integer(1, 100),
};
type Field = keyof typeof shape;
export class AuthConfigurationError extends Error {
  readonly code = "INVALID_CONFIGURATION";
  readonly fields: readonly Field[];
  constructor(fields: readonly Field[]) {
    super("Authentication configuration is invalid");
    this.fields = Object.freeze([...new Set(fields)]);
  }
}
const keysSchema = z
  .array(z.strictObject({ id: keyId, secret: z.string().regex(/^[A-Za-z0-9_-]{43,86}$/) }))
  .min(1)
  .max(8);

/** Explicit deployment inputs. Never fall back to development credentials or timeout defaults. */
export function parseAuthRuntimeConfig(environment: Readonly<Record<string, string | undefined>>) {
  const parsed = z.object(shape).safeParse(environment);
  if (!parsed.success)
    throw new AuthConfigurationError(parsed.error.issues.map((i) => i.path[0] as Field));
  const v = parsed.data;
  let keys: z.infer<typeof keysSchema>;
  try {
    keys = keysSchema.parse(JSON.parse(v.AUTH_SIGNING_KEYS));
    const ids = new Set<string>();
    const secrets = new Set<string>();
    for (const key of keys) {
      const bytes = Buffer.from(key.secret, "base64url");
      if (
        bytes.length < 32 ||
        bytes.length > 64 ||
        bytes.toString("base64url") !== key.secret ||
        ids.has(key.id) ||
        secrets.has(key.secret) ||
        bytes.equals(Buffer.from(v.TELEGRAM_BOT_TOKEN, "utf8"))
      )
        throw new Error();
      ids.add(key.id);
      secrets.add(key.secret);
    }
    if (!ids.has(v.AUTH_ACTIVE_KEY_ID)) throw new Error();
  } catch {
    throw new AuthConfigurationError(["AUTH_SIGNING_KEYS", "AUTH_ACTIVE_KEY_ID"]);
  }
  return Object.freeze({
    botToken: new SecretValue(v.TELEGRAM_BOT_TOKEN),
    lifetimeSeconds: v.AUTH_SESSION_SECONDS,
    telegram: Object.freeze({
      maxAgeSeconds: v.AUTH_TELEGRAM_MAX_AGE_SECONDS,
      maxFutureSkewSeconds: v.AUTH_TELEGRAM_FUTURE_SKEW_SECONDS,
      maxBytes: 16384,
      maxFields: 32,
    }),
    ipLimit: v.AUTH_IP_LIMIT,
    identityLimit: v.AUTH_IDENTITY_LIMIT,
    signing: Object.freeze({
      activeKeyId: v.AUTH_ACTIVE_KEY_ID,
      issuer: v.AUTH_ISSUER,
      audience: v.AUTH_AUDIENCE,
      keys: Object.freeze(
        keys.map((k) => Object.freeze({ id: k.id, secret: new SecretValue(k.secret) })),
      ),
    }),
    trustedProxies: Object.freeze(v.API_TRUSTED_PROXIES),
    bindAddress: v.API_BIND_ADDRESS,
    poolMax: v.API_DB_POOL_MAX,
  });
}
export type AuthRuntimeConfig = ReturnType<typeof parseAuthRuntimeConfig>;
