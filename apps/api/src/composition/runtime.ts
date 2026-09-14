import { parseRuntimeConfig, parseAuthRuntimeConfig } from "@hambazi/config";
import { createDatabase } from "@hambazi/database";
import {
  createAuthSessions,
  createTelegramVerifier,
  createRedisAuthRateLimiter,
} from "../auth/index.js";
import { createUserIdentityPort } from "../users/index.js";
import { createHttpApplication } from "./http.js";
import type { SafeLogger } from "./safe-logger.js";

export async function startApi(
  environment: Readonly<Record<string, string | undefined>>,
  logger: SafeLogger,
) {
  const runtime = parseRuntimeConfig(environment, "api");
  if (runtime.role !== "api") throw new Error("Invalid runtime role");
  const auth = parseAuthRuntimeConfig(environment);
  const database = createDatabase({
    databaseUrl: runtime.databaseUrl,
    poolMax: auth.poolMax,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 10000,
    transactionMaxWaitMs: 2000,
    transactionTimeoutMs: 5000,
  });
  const rate = createRedisAuthRateLimiter({
    url: runtime.redisUrl,
    namespace: auth.signing.issuer,
    ipLimit: auth.ipLimit,
    identityLimit: auth.identityLimit,
  });
  let http: Awaited<ReturnType<typeof createHttpApplication>> | undefined;
  try {
    const telegram = createTelegramVerifier(auth.botToken, auth.telegram);
    const clock = { nowMs: () => Date.now() };
    const sessions = createAuthSessions({
      database,
      users: createUserIdentityPort(database),
      telegram,
      clock,
      lifetimeSeconds: auth.lifetimeSeconds,
      signing: auth.signing,
    });
    await database.connect();
    // Existing durable sessions/logout can work while Redis is unavailable; issuance fails closed.
    await rate.connect().catch(() => {});
    http = await createHttpApplication({
      auth: { sessions, telegram, clock, limiter: rate.limiter },
      allowedOrigins: runtime.allowedOrigins,
      trustedProxies: auth.trustedProxies,
      production: runtime.environment === "production",
      logger,
    });
    await http.app.listen(runtime.port, auth.bindAddress);
    logger.lifecycle("api.started");
    return {
      async close() {
        try {
          await http?.app.close();
        } finally {
          rate.close();
          await database.disconnect();
        }
        logger.lifecycle("api.stopped");
      },
    };
  } catch {
    await http?.app.close().catch(() => {});
    rate.close();
    await database.disconnect().catch(() => {});
    throw new Error("API startup failed");
  }
}
