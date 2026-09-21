import { BlockList, isIP } from "node:net";
import { z } from "zod";
const addresses = new BlockList();
addresses.addSubnet("127.0.0.0", 8);
addresses.addSubnet("10.0.0.0", 8);
addresses.addSubnet("172.16.0.0", 12);
addresses.addSubnet("192.168.0.0", 16);
addresses.addAddress("::1", "ipv6");
addresses.addSubnet("fc00::", 7, "ipv6");
const integer = (min: number, max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));
const path = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^\//)
  .refine((v) => [...v].every((char) => char.charCodeAt(0) >= 32));
const shape = {
  BOT_INTERNAL_BIND_ADDRESS: z.string().refine((v) => {
    const family = isIP(v);
    return !v.includes("%") && !!family && addresses.check(v, family === 4 ? "ipv4" : "ipv6");
  }),
  BOT_INTERNAL_PORT: integer(1, 65535),
  BOT_INTERNAL_TLS_KEY_FILE: path,
  BOT_INTERNAL_TLS_CERT_FILE: path,
  BOT_INTERNAL_REQUEST_LIMIT: integer(1, 300),
  BOT_INTERNAL_IDENTITY_LIMIT: integer(1, 30),
  BOT_ONBOARDING_LEASE_MS: integer(1000, 60000),
};
export class BotInternalConfigurationError extends Error {
  readonly code = "INVALID_CONFIGURATION";
  constructor(readonly fields: readonly string[]) {
    super("Bot internal transport configuration is invalid");
  }
}
/** Opt-in expansion: absent/false preserves the previously deployed public API. */
export function parseBotInternalConfig(env: Readonly<Record<string, string | undefined>>) {
  if (env.BOT_INTERNAL_ENABLED === undefined || env.BOT_INTERNAL_ENABLED === "false")
    return undefined;
  if (env.BOT_INTERNAL_ENABLED !== "true")
    throw new BotInternalConfigurationError(["BOT_INTERNAL_ENABLED"]);
  const parsed = z.object(shape).safeParse(env);
  if (!parsed.success)
    throw new BotInternalConfigurationError([
      ...new Set(parsed.error.issues.map((i) => String(i.path[0]))),
    ]);
  const v = parsed.data;
  if (v.BOT_INTERNAL_PORT === Number(env.API_PORT))
    throw new BotInternalConfigurationError(["BOT_INTERNAL_PORT"]);
  return Object.freeze({
    bindAddress: v.BOT_INTERNAL_BIND_ADDRESS,
    port: v.BOT_INTERNAL_PORT,
    keyFile: v.BOT_INTERNAL_TLS_KEY_FILE,
    certFile: v.BOT_INTERNAL_TLS_CERT_FILE,
    requestLimit: v.BOT_INTERNAL_REQUEST_LIMIT,
    identityLimit: v.BOT_INTERNAL_IDENTITY_LIMIT,
    leaseMs: v.BOT_ONBOARDING_LEASE_MS,
  });
}
