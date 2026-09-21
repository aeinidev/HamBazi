import { BlockList, isIP } from "node:net";
import { z } from "zod";
import { parseAuthRuntimeConfig } from "./auth-runtime.js";
import { SecretValue } from "./secret-value.js";

const keyId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const keysSchema = z
  .array(z.strictObject({ id: keyId, secret: z.string().max(86) }))
  .min(1)
  .max(2);
const privateAddresses = new BlockList();
privateAddresses.addSubnet("127.0.0.0", 8);
privateAddresses.addSubnet("10.0.0.0", 8);
privateAddresses.addSubnet("172.16.0.0", 12);
privateAddresses.addSubnet("192.168.0.0", 16);
privateAddresses.addAddress("::1", "ipv6");
privateAddresses.addSubnet("fc00::", 7, "ipv6");

const shape = {
  BOT_SERVICE_ACTIVE_KEY_ID: keyId,
  BOT_SERVICE_KEYS: z.string().min(1).max(1024),
  BOT_SERVICE_ALLOWED_PEERS: z
    .string()
    .min(1)
    .max(2048)
    .transform((v) => v.split(","))
    .pipe(
      z
        .array(
          z.string().refine((address) => {
            const family = isIP(address);
            return (
              !address.includes("%") &&
              family !== 0 &&
              privateAddresses.check(address, family === 4 ? "ipv4" : "ipv6")
            );
          }),
        )
        .min(1)
        .max(32),
    ),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
};
type Field = keyof typeof shape;
export class BotServiceConfigurationError extends Error {
  readonly code = "INVALID_CONFIGURATION";
  readonly fields: readonly Field[];
  constructor(fields: readonly Field[]) {
    super("Bot service configuration is invalid");
    this.fields = Object.freeze([...new Set(fields)]);
  }
}

/** API-side verifier configuration; not a Bot-process config or an environment reader. */
export function parseBotServiceConfig(environment: Readonly<Record<string, string | undefined>>) {
  const auth = parseAuthRuntimeConfig(environment);
  const parsed = z.object(shape).safeParse(environment);
  if (!parsed.success)
    throw new BotServiceConfigurationError(parsed.error.issues.map((i) => i.path[0] as Field));
  const v = parsed.data;
  let keys: z.infer<typeof keysSchema>;
  try {
    keys = keysSchema.parse(JSON.parse(v.BOT_SERVICE_KEYS));
    const forbidden = [
      Buffer.from(auth.botToken.reveal(), "utf8"),
      Buffer.from(v.TELEGRAM_WEBHOOK_SECRET, "utf8"),
      Buffer.from(v.TELEGRAM_WEBHOOK_SECRET, "base64url"),
      ...auth.signing.keys.flatMap((key) => [
        Buffer.from(key.secret.reveal(), "base64url"),
        Buffer.from(key.secret.reveal(), "utf8"),
      ]),
    ];
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
        forbidden.some((other) => bytes.equals(other))
      )
        throw new Error();
      ids.add(key.id);
      secrets.add(key.secret);
    }
    if (!ids.has(v.BOT_SERVICE_ACTIVE_KEY_ID)) throw new Error();
  } catch {
    throw new BotServiceConfigurationError(["BOT_SERVICE_KEYS", "BOT_SERVICE_ACTIVE_KEY_ID"]);
  }
  return Object.freeze({
    botId: auth.botToken.reveal().split(":")[0]!,
    activeKeyId: v.BOT_SERVICE_ACTIVE_KEY_ID,
    keys: Object.freeze(
      keys.map((key) => Object.freeze({ id: key.id, secret: new SecretValue(key.secret) })),
    ),
    allowedPeers: Object.freeze(v.BOT_SERVICE_ALLOWED_PEERS),
  });
}
export type BotServiceConfig = ReturnType<typeof parseBotServiceConfig>;
