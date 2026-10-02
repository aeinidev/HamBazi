import { hash } from "node:crypto";
import { createStatisticsPort } from "../leaderboard/index.js";
import { createPublicNamesPort } from "../users/index.js";
import { parseStatisticsConfig } from "@hambazi/config";
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
import { parseOperationsConfig } from "@hambazi/config";
import { startHealthServer, withDeadline } from "@hambazi/observability";
import { createApiHealth } from "../health/index.js";

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
  const statsConfig = parseStatisticsConfig(environment, "api");
  const operations = parseOperationsConfig(environment, "api");
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
  const statisticsRate = statsConfig
    ? createCatalogRate({
        url: runtime.redisUrl,
        namespace: "statistics:" + hash("sha256", auth.signing.issuer),
        ...catalogConfig,
      })
    : undefined;
  const roomsRate = roomsConfig
    ? createRoomsRate({ url: runtime.redisUrl, namespace: auth.signing.issuer, ...roomsConfig })
    : undefined;
  let internal: Awaited<ReturnType<typeof startBotInternalTransport>>;
  const health = createApiHealth({
    postgres: () => database.probe(),
    redis: async (signal) =>
      (
        await Promise.all([
          rate.probe(signal),
          profileRate.probe(signal),
          catalogRate.probe(signal),
          ...(roomsRate ? [roomsRate.probe(signal)] : []),
          ...(statisticsRate ? [statisticsRate.probe(signal)] : []),
        ])
      ).every(Boolean),
    timeoutMs: operations.probeTimeoutMs,
  });
  let healthServer: Awaited<ReturnType<typeof startHealthServer>> | undefined;
  try {
    if (operations.port) healthServer = await startHealthServer(health, operations.port);
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
    await statisticsRate?.connect().catch(() => {});
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
      ...(statsConfig && statisticsRate
        ? {
            statistics: {
              statistics: createStatisticsPort(database, {
                clock,
                users: createUserIdentityPort(database),
                names: createPublicNamesPort(database),
              }),
              authenticate: async (token: string) => {
                const result = await sessions.authenticate(token);
                return result.ok ? { ok: true as const, userId: result.session.userId } : result;
              },
              rate: statisticsRate.consume,
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
      health,
      probeTimeoutMs: operations.probeTimeoutMs,
    });
    await http.app.listen(runtime.port, auth.bindAddress);
    health.started();
    logger.lifecycle("api.started");
    let closing: Promise<void> | undefined;
    return {
      health,
      drainTimeoutMs: operations.drainTimeoutMs,
      close() {
        health.stopAdmission();
        http!.stopAdmission();
        internal?.stopAdmission();
        return (closing ??= withDeadline(
          (async () => {
            const drains = await Promise.allSettled([
              http?.realtime?.close(),
              (async () => {
                await http!.app.close();
                await http!.settled();
              })(),
              internal?.close(),
            ]);
            if (drains.some((d) => d.status === "rejected")) throw new Error("API drain failed");
            rate.close();
            profileRate.close();
            catalogRate.close();
            roomsRate?.close();
            statisticsRate?.close();
            await database.disconnect();
            health.stopped();
            await healthServer?.close();
            logger.lifecycle("api.stopped");
          })(),
          operations.drainTimeoutMs,
        ));
      },
    };
  } catch {
    health.stopAdmission();
    await internal?.close().catch(() => {});
    await http?.realtime?.close().catch(() => {});
    await http?.app.close().catch(() => {});
    rate.close();
    profileRate.close();
    catalogRate.close();
    roomsRate?.close();
    statisticsRate?.close();
    await database.disconnect().catch(() => {});
    health.stopped();
    await healthServer?.close().catch(() => {});
    throw new Error("API startup failed");
  }
}
