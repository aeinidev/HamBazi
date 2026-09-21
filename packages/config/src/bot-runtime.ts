import { BlockList, isIP } from "node:net";
import { z } from "zod";
import { SecretValue } from "./secret-value.js";
const privateIps = new BlockList();
for (const [network, prefix] of [
  ["127.0.0.0", 8],
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const)
  privateIps.addSubnet(network, prefix);
privateIps.addAddress("::1", "ipv6");
privateIps.addSubnet("fc00::", 7, "ipv6");
const privateIp = (value: string) => {
  const address = value.replace(/^\[|\]$/g, "");
  const family = isIP(address);
  return (
    !address.includes("%") &&
    family !== 0 &&
    privateIps.check(address, family === 4 ? "ipv4" : "ipv6")
  );
};
const integer = (min: number, max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));
const path = z
  .string()
  .min(1)
  .max(1024)
  .startsWith("/")
  .refine((v) => [...v].every((c) => c.charCodeAt(0) >= 32));
const url = (internal: boolean) => (value: string) => {
  try {
    const u = new URL(value);
    return (
      value === value.trim() &&
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !u.search &&
      (internal ? u.pathname === "/" && privateIp(u.hostname) : !!u.hostname)
    );
  } catch {
    return false;
  }
};
const shape = {
  NODE_ENV: z.enum(["test", "development", "production"]),
  TELEGRAM_BOT_TOKEN: z.string().regex(/^[1-9][0-9]{0,15}:[A-Za-z0-9_-]{30,100}$/),
  TELEGRAM_BOT_USERNAME: z
    .string()
    .regex(/^[A-Za-z0-9_]{5,32}$/)
    .refine((v) => v.toLowerCase().endsWith("bot")),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  BOT_SERVICE_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  BOT_SERVICE_KEY: z.string().min(43).max(86),
  BOT_API_ORIGIN: z.string().max(256).refine(url(true)),
  BOT_API_CA_FILE: path.optional(),
  BOT_BIND_ADDRESS: z.string().refine(privateIp),
  BOT_PORT: integer(1, 65535),
  BOT_TLS_KEY_FILE: path,
  BOT_TLS_CERT_FILE: path,
  BOT_MINI_APP_URL: z.string().max(2048).refine(url(false)),
  BOT_BACKEND_TIMEOUT_MS: integer(100, 5000),
  BOT_SEND_TIMEOUT_MS: integer(100, 5000),
  BOT_ONBOARDING_LEASE_MS: integer(1000, 60000),
  BOT_MAX_IN_FLIGHT: integer(1, 100),
};
export class BotRuntimeConfigurationError extends Error {
  readonly code = "INVALID_CONFIGURATION";
  readonly fields: readonly string[];
  constructor(fields: readonly string[]) {
    super("Bot runtime configuration is invalid");
    this.fields = Object.freeze([...new Set(fields)]);
  }
}
/** Bot-only inputs: no database, Redis, API session signing or previous service keys. */
export function parseBotRuntimeConfig(env: Readonly<Record<string, string | undefined>>) {
  const parsed = z.object(shape).safeParse(env);
  if (!parsed.success)
    throw new BotRuntimeConfigurationError(parsed.error.issues.map((i) => String(i.path[0])));
  const v = parsed.data;
  const bytes = Buffer.from(v.BOT_SERVICE_KEY, "base64url");
  if (
    bytes.length < 32 ||
    bytes.length > 64 ||
    bytes.toString("base64url") !== v.BOT_SERVICE_KEY ||
    [
      Buffer.from(v.TELEGRAM_BOT_TOKEN),
      Buffer.from(v.TELEGRAM_WEBHOOK_SECRET),
      Buffer.from(v.TELEGRAM_WEBHOOK_SECRET, "base64url"),
    ].some((b) => b.equals(bytes))
  )
    throw new BotRuntimeConfigurationError(["BOT_SERVICE_KEY"]);
  if (!Number.isSafeInteger(Number(v.TELEGRAM_BOT_TOKEN.split(":")[0])))
    throw new BotRuntimeConfigurationError(["TELEGRAM_BOT_TOKEN"]);
  if (v.BOT_ONBOARDING_LEASE_MS < 2 * v.BOT_BACKEND_TIMEOUT_MS + v.BOT_SEND_TIMEOUT_MS + 1000)
    throw new BotRuntimeConfigurationError(["BOT_ONBOARDING_LEASE_MS"]);
  return Object.freeze({
    environment: v.NODE_ENV,
    botToken: new SecretValue(v.TELEGRAM_BOT_TOKEN),
    botId: v.TELEGRAM_BOT_TOKEN.split(":")[0]!,
    botUsername: v.TELEGRAM_BOT_USERNAME,
    webhookSecret: new SecretValue(v.TELEGRAM_WEBHOOK_SECRET),
    serviceBearer: new SecretValue(`Bearer ${v.BOT_SERVICE_KEY_ID}.${v.BOT_SERVICE_KEY}`),
    apiOrigin: v.BOT_API_ORIGIN,
    apiCaFile: v.BOT_API_CA_FILE,
    bindAddress: v.BOT_BIND_ADDRESS,
    port: v.BOT_PORT,
    keyFile: v.BOT_TLS_KEY_FILE,
    certFile: v.BOT_TLS_CERT_FILE,
    miniAppUrl: v.BOT_MINI_APP_URL,
    backendTimeoutMs: v.BOT_BACKEND_TIMEOUT_MS,
    sendTimeoutMs: v.BOT_SEND_TIMEOUT_MS,
    requestTimeoutMs: 3 * v.BOT_BACKEND_TIMEOUT_MS + v.BOT_SEND_TIMEOUT_MS + 1000,
    maxInFlight: v.BOT_MAX_IN_FLIGHT,
  });
}
export type BotRuntimeConfig = ReturnType<typeof parseBotRuntimeConfig>;
