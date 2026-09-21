import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { SecretValue, parseBotInternalConfig, parseBotServiceConfig } from "@hambazi/config";
import {
  createBotServiceAuthenticator,
  createRedisAuthRateLimiter,
  type createBotOnboarding,
} from "../auth/index.js";
import { createBotInternalHttpApplication } from "./bot-internal-http.js";
import type { SafeLogger } from "./safe-logger.js";

async function pem(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > 65536) throw new Error("Invalid TLS file");
  const bytes = await readFile(path);
  if (bytes.length > 65536) throw new Error("Invalid TLS file");
  return bytes.toString("utf8");
}
export async function startBotInternalTransport(options: {
  environment: Readonly<Record<string, string | undefined>>;
  redisUrl: { reveal(): string };
  onboarding: (leaseMs: number) => ReturnType<typeof createBotOnboarding>;
  logger: SafeLogger;
}) {
  const config = parseBotInternalConfig(options.environment);
  if (!config) return undefined;
  const service = parseBotServiceConfig(options.environment);
  const rate = createRedisAuthRateLimiter({
    url: options.redisUrl,
    namespace: `bot-internal:${createHash("sha256").update(options.environment.AUTH_ISSUER!).digest("hex")}`,
    ipLimit: config.requestLimit,
    identityLimit: config.identityLimit,
  });
  let http: Awaited<ReturnType<typeof createBotInternalHttpApplication>> | undefined;
  try {
    const [key, cert] = await Promise.all([pem(config.keyFile), pem(config.certFile)]);
    // Startup fails closed for the privileged listener if distributed admission is unavailable.
    await rate.connect();
    http = await createBotInternalHttpApplication({
      authenticator: createBotServiceAuthenticator(service),
      onboarding: options.onboarding(config.leaseMs),
      limiter: rate.limiter,
      tls: { key: new SecretValue(key), cert },
      logger: options.logger,
    });
    await http.app.listen(config.port, config.bindAddress);
    let closing: Promise<void> | undefined;
    return {
      close() {
        return (closing ??= (async () => {
          try {
            await http!.app.close();
          } finally {
            rate.close();
          }
        })());
      },
    };
  } catch {
    await http?.app.close().catch(() => {});
    rate.close();
    throw new Error("Bot internal transport startup failed");
  }
}
