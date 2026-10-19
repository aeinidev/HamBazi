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
  parseGameAvailabilityConfig,
  parseRoomsConfig,
  parseTransportAdmissionConfig,
  parseOwnerAdmissionConfig,
} from "@hambazi/config";
import { createRoomsPort, createRoomsRate } from "../rooms/index.js";
import { createCatalogPort, createCatalogRate, lobbyAvailability } from "../games/index.js";
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
import { createRealtimeRedisAdapter, createRealtimeConsumer } from "../realtime/index.js";
import { parseKahrobaRuntimeConfig } from "@hambazi/config";
import { createKahrobaLocalAdmission } from "./kahroba-local-admission.js";
import { createKahrobaRuntimePorts } from "./kahroba-runtime.js";

export async function startApi(
  environment: Readonly<Record<string, string | undefined>>,
  logger: SafeLogger,
) {
  const runtime = parseRuntimeConfig(environment, "api");
  const kahrobaConfig = parseKahrobaRuntimeConfig(environment, "api");
  if (runtime.role !== "api") throw new Error("Invalid runtime role");
  const auth = parseAuthRuntimeConfig(environment);
  const ownerConfig = parseOwnerAdmissionConfig(environment);
  const personalConfig = parsePersonalGameplayConfig(environment, "api");
  const profileConfig = parseProfileConfig(environment);
  const catalogConfig = parseCatalogConfig(environment);
  const availability = parseGameAvailabilityConfig(environment);
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
  let kahrobaRedis: Awaited<ReturnType<typeof createRealtimeRedisAdapter>> | undefined;
  let kahrobaConsumer: ReturnType<typeof createRealtimeConsumer> | undefined;
  let kahrobaDeliveryReady = false;
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
          ...(kahrobaConfig?.routes
            ? [Promise.resolve(kahrobaDeliveryReady && kahrobaRedis?.ready() === true)]
            : []),
        ])
      ).every(Boolean),
    timeoutMs: operations.probeTimeoutMs,
    metrics,
  });
  let healthServer: Awaited<ReturnType<typeof startHealthServer>> | undefined;
  try {
    const ownerAdmission = kahrobaConfig?.localAdmissionFile
      ? createKahrobaLocalAdmission(
          kahrobaConfig.localAdmissionFile,
          createUserIdentityPort(database),
        )
      : ownerConfig
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
    let kahroba: ReturnType<typeof createKahrobaRuntimePorts> | undefined;
    if (kahrobaConfig?.routes) {
      if (!ownerAdmission || !roomsConfig || !roomsRate || !admission || !admissionPolicy)
        throw new Error("KAHROBA_RUNTIME_CONFIGURATION_INVALID");
      const ids = await ownerAdmission.admittedTelegramIds();
      if (ids.length < 2 || (!kahrobaConfig.local && ids.length !== 2))
        throw new Error("KAHROBA_RUNTIME_CONFIGURATION_INVALID");
      kahroba = createKahrobaRuntimePorts(database, {
        config: kahrobaConfig,
        clock,
        sessions,
        owner: ownerAdmission,
        roomConfig: roomsConfig,
        roomRate: roomsRate.consume,
        transport: admission,
        policy: admissionPolicy,
        origins: runtime.allowedOrigins,
        coexists: !!personalConfig,
      });
      if (!(await kahroba.catalog.find("kahroba")).ok)
        throw new Error("KAHROBA_REGISTRATION_REQUIRED");
      kahrobaRedis = await createRealtimeRedisAdapter({
        redisUrl: runtime.redisUrl,
        namespace: kahrobaConfig.namespace,
        timeoutMs: operations.probeTimeoutMs,
      });
      kahroba.realtime.delivery!.redis = kahrobaRedis;
    }
    http = await createHttpApplication({
      ...(kahroba && kahrobaConfig && ownerAdmission && roomsRate
        ? {
            realtime: kahroba.realtime,
            kahroba: {
              rooms: {
                rooms: kahroba.rooms,
                authenticate: async (token: string) => {
                  const r = await sessions.authenticate(token);
                  return r.ok ? { ok: true as const, userId: r.session.userId } : r;
                },
                rate: roomsRate.consume,
              },
              metadata: {
                sessions,
                admission: ownerAdmission,
                config: kahrobaConfig,
                canCreate: kahroba.canCreate,
                privateRooms: kahroba.privateRooms,
                resync: kahroba.resync,
                names: kahroba.names,
                rooms: kahroba.rooms,
                rate: (userId) => roomsRate.consume("read", userId),
              },
            },
          }
        : {}),
      ...(personalConfig && ownerAdmission && admission && admissionPolicy
        ? {
            personal: {
              matches: withPersonalPublicNames(
                createPersonalMatchPort(database, {
                  clock,
                  game: createPersonalAnarchistCoupGame(),
                  retainedGames: [createPersonalCoupGame()],
                  owner: ownerAdmission,
                  newMatchesAllowed: !availability.coupTemporarilyDisabled,
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
      ...(roomsConfig && roomsRate && !kahrobaConfig?.routes
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
        lobbyAvailability: async (userId) =>
          lobbyAvailability(
            availability,
            !!personalConfig &&
              !!ownerAdmission &&
              !!admission &&
              !!admissionPolicy &&
              (await ownerAdmission.allowsUserId(userId)),
          ),
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
    if (kahrobaConfig?.routes && http.realtime) {
      const gateway = http.realtime;
      kahrobaConsumer = createRealtimeConsumer({
        redisUrl: runtime.redisUrl,
        namespace: kahrobaConfig.namespace,
        publish: (event) => gateway.publish(event),
        unavailable: () => {
          kahrobaDeliveryReady = false;
        },
        drainTimeoutMs: operations.drainTimeoutMs,
      });
      await withDeadline(kahrobaConsumer.ready(), operations.probeTimeoutMs);
      kahrobaDeliveryReady = true;
    }
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
              kahrobaConsumer?.close(),
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
            await kahrobaRedis?.close();
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
    await kahrobaConsumer?.close().catch(() => {});
    await kahrobaRedis?.close().catch(() => {});
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
