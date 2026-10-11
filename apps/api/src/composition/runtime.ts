import { parseBotExperienceConfig } from "@hambazi/config";
import { createPersonalMatchPort } from "../matches/index.js";
import { createPersonalCoupGame, createPersonalAnarchistCoupGame } from "./personal-coup.js";
import { withPersonalPublicNames } from "./personal-public-names.js";
import { parsePersonalGameplayConfig } from "@hambazi/config";
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
  parseTransportAdmissionConfig,
  parseOwnerAdmissionConfig,
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
  createFileOwnerAdmission,
} from "../auth/index.js";
import {
  createUserIdentityPort,
  createRegistrationPort,
  createAccountCreationPort,
  createProfilePort,
  createProfileRate,
} from "../users/index.js";
import { createHttpApplication } from "./http.js";
import type { SafeLogger } from "./safe-logger.js";
import { startBotInternalTransport } from "./bot-internal-runtime.js";
import { parseOperationsConfig, parseTelemetryConfig } from "@hambazi/config";
import { startHealthServer, withDeadline, createMetricCollection } from "@hambazi/observability";
import {
  createMatchDiagnostics,
  createOutboxDiagnostics,
  createAdmissionDiagnostics,
} from "../matches/index.js";
import { createRoomDiagnostics } from "../rooms/index.js";
import { createApiHealth } from "../health/index.js";
import { createRedisTransportAdmission } from "../realtime/index.js";

export async function startApi(
  environment: Readonly<Record<string, string | undefined>>,
  logger: SafeLogger,
) {
  const runtime = parseRuntimeConfig(environment, "api");
  if (runtime.role !== "api") throw new Error("Invalid runtime role");
  const auth = parseAuthRuntimeConfig(environment);
  const ownerConfig = parseOwnerAdmissionConfig(environment);
  const personalConfig = parsePersonalGameplayConfig(environment, "api");
  const profileConfig = parseProfileConfig(environment);
  const catalogConfig = parseCatalogConfig(environment);
  const roomsConfig = parseRoomsConfig(environment);
  const statsConfig = parseStatisticsConfig(environment, "api");
  const operations = parseOperationsConfig(environment, "api");
  const telemetryConfig = parseTelemetryConfig(environment, "api");
  const admissionPolicy = parseTransportAdmissionConfig(environment);
  const admission = admissionPolicy
    ? createRedisTransportAdmission({
        url: runtime.redisUrl,
        namespace: auth.signing.issuer,
        policy: admissionPolicy,
      })
    : undefined;
  const metrics = logger.metrics;
  const database = createDatabase({
    databaseUrl: runtime.databaseUrl,
    poolMax: auth.poolMax,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 10000,
    transactionMaxWaitMs: 2000,
    transactionTimeoutMs: 5000,
    observe: (durationMs, success) =>
      logger.telemetry.emit("database.completed", {
        durationMs,
        ...(success ? {} : { errorCode: "INTERNAL_ERROR" }),
      }),
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
          ...(admission ? [admission.probe(signal)] : []),
        ])
      ).every(Boolean),
    timeoutMs: operations.probeTimeoutMs,
    metrics,
  });
  let healthServer: Awaited<ReturnType<typeof startHealthServer>> | undefined;
  try {
    const ownerAdmission = ownerConfig
      ? createFileOwnerAdmission(
          ownerConfig.file,
          createUserIdentityPort(database),
          ownerConfig.testFile,
        )
      : undefined;
    if (ownerAdmission && !(await ownerAdmission.telegramId()))
      throw new Error("OWNER_ADMISSION_POLICY_INVALID");
    const collect = createMetricCollection(
      metrics,
      [
        {
          name: "database",
          read: async () => {
            const p = database.poolSnapshot();
            return {
              db_pool_max: p.max,
              db_pool_total: p.total,
              db_pool_idle: p.idle,
              db_pool_waiting: p.waiting,
            };
          },
        },
        { name: "matches", read: createMatchDiagnostics(database) },
        { name: "admissions", read: createAdmissionDiagnostics(database) },
        { name: "outbox", read: createOutboxDiagnostics(database) },
        ...(roomsConfig ? [{ name: "rooms" as const, read: createRoomDiagnostics(database) }] : []),
      ],
      operations.probeTimeoutMs,
    );
    if (operations.port)
      healthServer = await startHealthServer(
        health,
        operations.port,
        telemetryConfig.metricsEnabled ? { metrics, collect } : undefined,
      );
    const telegram = createTelegramVerifier(auth.botToken, auth.telegram);
    const clock = { nowMs: () => Date.now() };
    const onboarding = createMiniAppOnboarding({
      ...(ownerAdmission ? { ownerAdmission } : {}),
      registration: createRegistrationPort(database, clock),
      users: createUserIdentityPort(database),
      telegram,
      clock,
    });
    const sessions = createAuthSessions({
      ...(ownerAdmission ? { ownerAdmission } : {}),
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
    await admission?.connect().catch(() => {});
    http = await createHttpApplication({
      ...(personalConfig && ownerAdmission && admission && admissionPolicy
        ? {
            personal: {
              matches: withPersonalPublicNames(
                createPersonalMatchPort(database, {
                  clock,
                  game: createPersonalAnarchistCoupGame(),
                  retainedGames: [createPersonalCoupGame()],
                  owner: ownerAdmission,
                }),
                createPublicNamesPort(database),
              ),
              sessions,
              rate: admission.rate,
              ip: admission.ip,
              policy: admissionPolicy,
              trustedProxies: auth.trustedProxies,
              allowedOrigins: runtime.allowedOrigins,
              production: runtime.environment === "production",
            },
          }
        : {}),
      ...(admission && admissionPolicy
        ? { admission: { policy: admissionPolicy, ip: admission.ip } }
        : {}),
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
          ...(ownerAdmission ? { ownerAdmission } : {}),
          database,
          accounts: createAccountCreationPort(database),
          users: createUserIdentityPort(database),
          clock,
          leaseMs,
          registration: createRegistrationPort(database, clock),
          supportTimeoutMs: parseBotExperienceConfig(environment).supportTimeoutMs,
        }),
      health,
      probeTimeoutMs: operations.probeTimeoutMs,
    });
    await http.app.listen(runtime.port, auth.bindAddress);
    health.started();
    logger.lifecycle("api.started");
    let closing: Promise<void> | undefined;
    let drainStarted = 0;
    return {
      health,
      drainTimeoutMs: operations.drainTimeoutMs,
      close() {
        if (!closing) drainStarted = performance.now();
        health.stopAdmission();
        http!.stopAdmission();
        internal?.stopAdmission();
        return (closing ??= withDeadline(
          (async () => {
            const drains = await Promise.allSettled([
              http?.realtime?.close(),
              http?.personal?.close(),
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
            admission?.close();
            await database.disconnect();
            health.stopped();
            await healthServer?.close();
            logger.lifecycle("api.stopped");
          })(),
          operations.drainTimeoutMs,
        ).then(
          () => {
            metrics.drain("completed", performance.now() - drainStarted);
          },
          () => {
            metrics.drain("failed", performance.now() - drainStarted);
            throw new Error("API drain failed");
          },
        ));
      },
    };
  } catch {
    health.stopAdmission();
    await internal?.close().catch(() => {});
    await http?.realtime?.close().catch(() => {});
    await http?.personal?.close().catch(() => {});
    await http?.app.close().catch(() => {});
    rate.close();
    profileRate.close();
    catalogRate.close();
    roomsRate?.close();
    statisticsRate?.close();
    admission?.close();
    await database.disconnect().catch(() => {});
    health.stopped();
    await healthServer?.close().catch(() => {});
    throw new Error("API startup failed");
  }
}
