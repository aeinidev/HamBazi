import {
  parseRuntimeConfig,
  parseAuthRuntimeConfig,
  parseProfileConfig,
  parseCatalogConfig,
  parseRoomsConfig,
} from "@hambazi/config";
import { createRoomsPort, createRoomsRate } from "../rooms/index.js";
import { createCatalogPort, createCatalogRate } from "../games/index.js";
import { createDatabase } from "@hambazi/database";
import {
  createAuthSessions,
  createTelegramVerifier,
  createRedisAuthRateLimiter,
  createMiniAppOnboarding,
  createBotOnboarding,
} from "../auth/index.js";
import {
  createUserIdentityPort,
  createAccountCreationPort,
  createProfilePort,
  createProfileRate,
} from "../users/index.js";
import { createHttpApplication } from "./http.js";
import type { SafeLogger } from "./safe-logger.js";
import { startBotInternalTransport } from "./bot-internal-runtime.js";

export async function startApi(
  environment: Readonly<Record<string, string | undefined>>,
  logger: SafeLogger,
) {
  const runtime = parseRuntimeConfig(environment, "api");
  if (runtime.role !== "api") throw new Error("Invalid runtime role");
  const auth = parseAuthRuntimeConfig(environment);
  const profileConfig = parseProfileConfig(environment);
  const catalogConfig = parseCatalogConfig(environment);
  const roomsConfig = parseRoomsConfig(environment);
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
  const profileRate = createProfileRate({
    url: runtime.redisUrl,
    namespace: auth.signing.issuer,
    ...profileConfig,
  });
  let http: Awaited<ReturnType<typeof createHttpApplication>> | undefined;
  const catalogRate = createCatalogRate({
    url: runtime.redisUrl,
    namespace: auth.signing.issuer,
    ...catalogConfig,
  });
  const roomsRate = roomsConfig
    ? createRoomsRate({ url: runtime.redisUrl, namespace: auth.signing.issuer, ...roomsConfig })
    : undefined;
  let internal: Awaited<ReturnType<typeof startBotInternalTransport>>;
  try {
    const telegram = createTelegramVerifier(auth.botToken, auth.telegram);
    const clock = { nowMs: () => Date.now() };
    const onboarding = createMiniAppOnboarding({
      accounts: createAccountCreationPort(database),
      users: createUserIdentityPort(database),
      telegram,
      clock,
    });
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
    await profileRate.connect().catch(() => {});
    await catalogRate.connect().catch(() => {});
    await roomsRate?.connect().catch(() => {});
    http = await createHttpApplication({
      ...(roomsConfig && roomsRate
        ? {
            rooms: {
              rooms: createRoomsPort(
                database,
                { clock, ttlSeconds: roomsConfig.ttlSeconds },
                {
                  users: createUserIdentityPort(database),
                  games: createCatalogPort(database),
                  ...(roomsConfig.target
                    ? {
                        invites: {
                          target: roomsConfig.target,
                          consume: (userId: string) => roomsRate.consume("invite", userId),
                        },
                      }
                    : {}),
                },
              ),
              authenticate: async (token: string) => {
                const result = await sessions.authenticate(token);
                return result.ok ? { ok: true as const, userId: result.session.userId } : result;
              },
              rate: roomsRate.consume,
            },
          }
        : {}),
      auth: { sessions, telegram, clock, limiter: rate.limiter, onboarding },
      profile: {
        profile: createProfilePort(database, clock),
        authenticate: async (token) => {
          const result = await sessions.authenticate(token);
          return result.ok ? { ok: true, userId: result.session.userId } : result;
        },
        rate: profileRate.consume,
        degraded: logger.profileRateUnavailable,
      },
      allowedOrigins: runtime.allowedOrigins,
      catalog: {
        catalog: createCatalogPort(database),
        authenticate: async (token) => {
          const result = await sessions.authenticate(token);
          return result.ok ? { ok: true, userId: result.session.userId } : result;
        },
        rate: catalogRate.consume,
        degraded: logger.catalogRateUnavailable,
      },
      trustedProxies: auth.trustedProxies,
      production: runtime.environment === "production",
      logger,
    });
    internal = await startBotInternalTransport({
      environment,
      redisUrl: runtime.redisUrl,
      logger,
      onboarding: (leaseMs) =>
        createBotOnboarding({
          database,
          accounts: createAccountCreationPort(database),
          users: createUserIdentityPort(database),
          clock,
          leaseMs,
        }),
    });
    await http.app.listen(runtime.port, auth.bindAddress);
    logger.lifecycle("api.started");
    return {
      async close() {
        try {
          await http?.realtime?.close();
          await Promise.all([http?.app.close(), internal?.close()]);
        } finally {
          rate.close();
          profileRate.close();
          catalogRate.close();
          roomsRate?.close();
          await database.disconnect();
        }
        logger.lifecycle("api.stopped");
      },
    };
  } catch {
    await internal?.close().catch(() => {});
    await http?.realtime?.close().catch(() => {});
    await http?.app.close().catch(() => {});
    rate.close();
    profileRate.close();
    catalogRate.close();
    roomsRate?.close();
    await database.disconnect().catch(() => {});
    throw new Error("API startup failed");
  }
}
