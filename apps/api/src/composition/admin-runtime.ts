import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { parseAdminConfig } from "@hambazi/config";
import { createDatabase } from "@hambazi/database";
import { adminAuditPageSchema, adminOverviewSchema, adminPageSchema } from "@hambazi/validation";
import { createAdminCrypto, createAdminModule, type AdminReadPort } from "../admin/index.js";
import { createRedisAuthRateLimiter } from "../auth/index.js";
import { createUsersAdminOperations, createUsersAdminRead } from "../users/index.js";
import { createGamesAdminOperations, createGamesAdminRead } from "../games/index.js";
import {
  createRoomsAdminOperations,
  createRoomsAdminRead,
  createRoomDiagnostics,
} from "../rooms/index.js";
import {
  createMatchesAdminRead,
  createMatchesAdminOperations,
  createMatchDiagnostics,
  createOutboxDiagnostics,
} from "../matches/index.js";
import { createAdminHttpApplication } from "./admin-http.js";

/** Explicit separate entry point reuses API owners. Public player composition never registers Admin routes. */
export async function startAdmin(environment: Readonly<Record<string, string | undefined>>) {
  const config = parseAdminConfig(environment);
  if (!config) return null;
  if (
    new URL(config.databaseUrl.reveal()).username !== "hambazi_admin_runtime" ||
    new URL(config.readDatabaseUrl.reveal()).username !== "hambazi_admin_reader" ||
    (config.operationsDatabaseUrl &&
      new URL(config.operationsDatabaseUrl.reveal()).username !== "hambazi_admin_operations")
  )
    throw new Error("ADMIN_STARTUP_FAILED");
  const options = {
    poolMax: config.poolMax,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 10000,
    transactionMaxWaitMs: 2000,
    transactionTimeoutMs: 5000,
  };
  const database = createDatabase({ ...options, databaseUrl: config.databaseUrl });
  const readDatabase = createDatabase({ ...options, databaseUrl: config.readDatabaseUrl });
  const operationsDatabase = config.operationsDatabaseUrl
    ? createDatabase({ ...options, databaseUrl: config.operationsDatabaseUrl })
    : null;
  const limiter = createRedisAuthRateLimiter({
    url: config.redisUrl,
    namespace: `admin-v1:${config.realmId}`,
    ipLimit: config.rateLimit,
    identityLimit: Math.min(config.rateLimit, 30),
  });
  let reconciliation: ReturnType<typeof setInterval> | undefined;
  let app: Awaited<ReturnType<typeof createAdminHttpApplication>> | undefined;
  try {
    await Promise.all([
      database.connect(),
      readDatabase.connect(),
      limiter.connect(),
      ...(operationsDatabase ? [operationsDatabase.connect()] : []),
    ]);
    const clock = { nowMs: () => Date.now() };
    const crypto = createAdminCrypto({ ...config, clock });
    const userOperations = operationsDatabase
      ? createUsersAdminOperations(operationsDatabase, clock)
      : undefined;
    const module = createAdminModule(
      database,
      config.realmId,
      {
        crypto,
        policy: config,
        clock,
        newId: randomUUID,
        dummyPasswordVerifier: await crypto.hash(randomBytes(32).toString("base64url"), "password"),
      },
      operationsDatabase
        ? {
            USER_DISPLAY_NAME: userOperations!,
            GAME_AVAILABILITY: createGamesAdminOperations(operationsDatabase, clock),
            ROOM_CLOSE: createRoomsAdminOperations(operationsDatabase, clock),
            MATCH_TERMINATE: createMatchesAdminOperations(operationsDatabase, clock),
          }
        : undefined,
    );
    let reconciling = false;
    if (module.management) {
      reconciliation = setInterval(() => {
        if (reconciling) return;
        reconciling = true;
        void module
          .management!.reconcilePending()
          .catch(() => {})
          .finally(() => {
            reconciling = false;
          });
      }, 5000);
      reconciliation.unref();
    }
    const pages = {
      users: createUsersAdminRead(readDatabase),
      games: createGamesAdminRead(readDatabase),
      rooms: createRoomsAdminRead(readDatabase),
      matches: createMatchesAdminRead(readDatabase),
    };
    const sources = {
      matches: createMatchDiagnostics(readDatabase),
      rooms: createRoomDiagnostics(readDatabase),
      outbox: createOutboxDiagnostics(readDatabase),
    };
    // Coalesce diagnostics across browser refreshes; cache is display-only, never authorization.
    let snapshot: Promise<ReturnType<typeof adminOverviewSchema.parse>> | undefined;
    let sampledAt = 0;
    const reads: AdminReadPort = {
      async page(kind, query, games, excluded) {
        return adminPageSchema.parse(await pages[kind](query, games, excluded));
      },
      async overview() {
        if (!snapshot || clock.nowMs() - sampledAt >= 5000) {
          sampledAt = clock.nowMs();
          snapshot = (async () => {
            const metrics: { key: string; value: string | null; valid: boolean; source: string }[] =
              [];
            for (const [source, read] of Object.entries(sources)) {
              try {
                for (const [key, value] of Object.entries(await read()))
                  metrics.push({ key, value: String(value), valid: true, source });
              } catch {
                metrics.push({ key: `${source}_unavailable`, value: null, valid: false, source });
              }
            }
            return adminOverviewSchema.parse({
              schemaVersion: 1,
              asOf: new Date(sampledAt).toISOString(),
              metrics,
            });
          })();
        }
        return snapshot;
      },
      async audit() {
        return adminAuditPageSchema.parse(await module.audit());
      },
    };
    app = await createAdminHttpApplication(
      {
        service: module.service,
        management: module.management,
        csrf: crypto.csrf,
        reads,
        cookieSeconds: config.sessionSeconds,
        pendingSeconds: config.pendingSeconds,
      },
      {
        key: await readFile(config.tlsKeyFile),
        cert: await readFile(config.tlsCertFile),
        origin: config.origin,
        peers: config.privatePeers,
        ingressMode: config.ingressMode,
        proxyPeers: config.proxyPeers,
        maxInFlight: config.maxInFlight,
        admitIp: async (ip) => (await limiter.limiter.consumeIp(ip)).allowed,
        admitIdentity: async (id) => (await limiter.limiter.consumeIdentity(id)).allowed,
      },
    );
    await app.listen(config.port, config.bindAddress);
    return {
      close: async () => {
        clearInterval(reconciliation);
        await app!.close();
        limiter.close();
        await Promise.all([
          database.disconnect(),
          readDatabase.disconnect(),
          ...(operationsDatabase ? [operationsDatabase.disconnect()] : []),
        ]);
      },
    };
  } catch {
    clearInterval(reconciliation);
    await app?.close().catch(() => {});
    limiter.close();
    await Promise.allSettled([
      database.disconnect(),
      readDatabase.disconnect(),
      ...(operationsDatabase ? [operationsDatabase.disconnect()] : []),
    ]);
    throw new Error("ADMIN_STARTUP_FAILED");
  }
}
