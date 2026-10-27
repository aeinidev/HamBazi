import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Match } from "./generated/prisma/client.js";
import type { Prisma } from "./generated/prisma/client.js";
import { Pool } from "pg";

const ownership = {
  admin: [
    "adminRealm",
    "adminOperator",
    "adminSession",
    "adminAuthReceipt",
    "adminGrant",
    "adminAuditEvent",
    "adminRole",
    "adminOperatorRole",
    "adminOperation",
  ],
  auth: ["session", "botUpdateReceipt", "botOnboardingFlow", "botSupportSubmission"],
  users: ["user", "userSettings", "profileMutationReceipt", "userAdminEffect"],
  games: ["game", "gameAdminEffect"],
  rooms: ["room", "roomMember", "roomCommandReceipt", "roomAdminEffect"],
  matches: [
    "matchAdminEffect",
    "matchAdmission",
    "matchReservation",
    "match",
    "matchPlayer",
    "matchBotSeat",
    "matchConnectionLease",
    "gameEvent",
    "processedCommand",
    "gameResult",
    "matchResult",
    "outboxEvent",
  ],
  chat: ["chatMessage", "chatStream", "outboxEvent"],
  leaderboard: [
    "userGameStats",
    "consumerReceipt",
    "statsHead",
    "statsGeneration",
    "statsApplication",
    "statsValue",
  ],
  outbox: ["outboxEvent"],
} as const;
export type DatabaseOwner = keyof typeof ownership;
type OwnedClient<O extends DatabaseOwner> = Pick<
  Prisma.TransactionClient,
  (typeof ownership)[O][number]
>;
type MatchPresenceRow = Pick<
  Match,
  "id" | "status" | "stateVersion" | "lastEventSeq" | "reconnectPolicyJsonb" | "startedAt"
>;
const matchIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ScopedClient<O extends DatabaseOwner> = (O extends "chat"
  ? Omit<OwnedClient<O>, "outboxEvent"> & {
      outboxEvent: Pick<Prisma.TransactionClient["outboxEvent"], "create">;
    }
  : OwnedClient<O>) &
  (O extends "matches"
    ? {
        lockPersonalAdmission(): Promise<void>;
        lockMatchAdmissions(ids: readonly string[]): Promise<void>;
        lockMatch(id: string): Promise<void>;
        lockMatchPresence(id: string): Promise<MatchPresenceRow | null>;
      }
    : object) &
  (O extends "users" | "games" | "rooms" | "matches"
    ? { lockAdminEffect(id: string): Promise<void> }
    : object) &
  (O extends "admin" ? { lockAdminRealm(realmId: string): Promise<void> } : object) &
  (O extends "rooms" ? { lockRooms(): Promise<void> } : object) &
  (O extends "leaderboard" ? { lockStatistics(): Promise<void> } : object) &
  (O extends "outbox"
    ? {
        lockDueOutbox(
          at: Date,
          limit: number,
          eventTypes: readonly string[],
        ): Promise<readonly string[]>;
      }
    : object);

export class DatabaseError extends Error {
  readonly code: string;
  constructor(code = "DATABASE_OPERATION_FAILED") {
    super("Database operation failed");
    this.name = "DatabaseError";
    this.code = code;
  }
}

function failure(error: unknown): DatabaseError {
  // No Prisma meta, query text, connection URL, or original cause escapes.
  const safeCodes: Record<string, string> = {
    P2002: "DATABASE_UNIQUE_CONFLICT",
    P2003: "DATABASE_REFERENCE_CONFLICT",
    P2025: "DATABASE_RECORD_NOT_FOUND",
    P2034: "DATABASE_TRANSACTION_CONFLICT",
  };
  try {
    if (typeof error === "object" && error !== null) {
      const code = "code" in error ? error.code : undefined;
      if (typeof code === "string" && Object.hasOwn(safeCodes, code))
        return new DatabaseError(safeCodes[code]);
      // Fixed raw row locks can surface PostgreSQL's known aborted-transaction
      // SQLSTATE through P2010. Only those two states are safe to retry.
      if (
        code === "P2010" &&
        "meta" in error &&
        error.meta &&
        typeof error.meta === "object" &&
        "code" in error.meta &&
        (error.meta.code === "40001" || error.meta.code === "40P01")
      )
        return new DatabaseError("DATABASE_TRANSACTION_CONFLICT");
      if (
        code === "P2010" &&
        "meta" in error &&
        error.meta &&
        typeof error.meta === "object" &&
        "driverAdapterError" in error.meta &&
        error.meta.driverAdapterError &&
        typeof error.meta.driverAdapterError === "object" &&
        "cause" in error.meta.driverAdapterError &&
        error.meta.driverAdapterError.cause &&
        typeof error.meta.driverAdapterError.cause === "object" &&
        "kind" in error.meta.driverAdapterError.cause &&
        error.meta.driverAdapterError.cause.kind === "TransactionWriteConflict"
      )
        return new DatabaseError("DATABASE_TRANSACTION_CONFLICT");
      // Prisma 7 maps statement conflicts to P2034, but COMMIT can reject with
      // its adapter error directly. This kind denotes an aborted transaction;
      // connection failures or an ambiguous commit must remain generic failures.
      if (
        code === undefined &&
        "name" in error &&
        error.name === "DriverAdapterError" &&
        "cause" in error &&
        typeof error.cause === "object" &&
        error.cause !== null &&
        "kind" in error.cause &&
        error.cause.kind === "TransactionWriteConflict"
      )
        return new DatabaseError("DATABASE_TRANSACTION_CONFLICT");
    }
  } catch {
    // Untrusted getters/proxies cannot expose an original error or its payload.
  }
  return new DatabaseError();
}

function scope<O extends DatabaseOwner>(
  client: Prisma.TransactionClient,
  owner: O,
  inTransaction = false,
): ScopedClient<O> {
  if (!Object.hasOwn(ownership, owner)) throw new DatabaseError("DATABASE_OWNER_INVALID");
  return Object.freeze({
    ...Object.fromEntries(
      ownership[owner].map((key) => [
        key,
        owner === "chat" && key === "outboxEvent"
          ? Object.freeze({ create: client.outboxEvent.create.bind(client.outboxEvent) })
          : client[key],
      ]),
    ),
    ...(["users", "games", "rooms", "matches"].includes(owner)
      ? {
          async lockAdminEffect(id: string): Promise<void> {
            if (!inTransaction || !matchIdPattern.test(id))
              throw new DatabaseError("DATABASE_LOCK_INVALID");
            const lane = `admin-effect:${owner}:${id}`;
            await client.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(182085, hashtext(${lane}))) AS guard`;
          },
        }
      : {}),
    ...(owner === "admin"
      ? {
          async lockAdminRealm(realmId: string): Promise<void> {
            if (!inTransaction || !/^[a-z][a-z0-9-]{0,63}$/.test(realmId))
              throw new DatabaseError("DATABASE_LOCK_INVALID");
            await client.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(182081, hashtext(${realmId}))) AS guard`;
          },
        }
      : {}),
    ...(owner === "leaderboard"
      ? {
          async lockStatistics(): Promise<void> {
            if (!inTransaction) throw new DatabaseError("DATABASE_LOCK_INVALID");
            await client.$queryRaw`SELECT id FROM stats_heads WHERE id = 'statistics-v1' FOR UPDATE`;
          },
        }
      : {}),
    ...(owner === "outbox"
      ? {
          async lockDueOutbox(
            at: Date,
            limit: number,
            eventTypes: readonly string[],
          ): Promise<readonly string[]> {
            if (
              !inTransaction ||
              !Number.isFinite(at.getTime()) ||
              !Number.isInteger(limit) ||
              limit < 1 ||
              limit > 100 ||
              !Array.isArray(eventTypes) ||
              eventTypes.length < 1 ||
              eventTypes.length > 32 ||
              eventTypes.some((type) => !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(type)) ||
              new Set(eventTypes).size !== eventTypes.length
            )
              throw new DatabaseError("DATABASE_LOCK_INVALID");
            const rows = await client.$queryRaw<{ id: string }[]>`
          SELECT id FROM outbox_events WHERE status = 'PENDING' AND next_attempt_at <= ${at}
          AND type IN (SELECT jsonb_array_elements_text(${JSON.stringify(eventTypes)}::jsonb))
          AND (claimed_until IS NULL OR claimed_until <= ${at})
          ORDER BY next_attempt_at, created_at, id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
            return rows.map((row) => row.id);
          },
        }
      : {}),
    ...(owner === "matches"
      ? {
          async lockPersonalAdmission(): Promise<void> {
            if (!inTransaction) throw new DatabaseError("DATABASE_LOCK_INVALID");
            await client.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(181803)`;
          },
          async lockMatchAdmissions(ids: readonly string[]): Promise<void> {
            if (
              !inTransaction ||
              ids.length < 1 ||
              ids.length > 64 ||
              ids.some((id) => !matchIdPattern.test(id)) ||
              new Set(ids).size !== ids.length
            )
              throw new DatabaseError("DATABASE_LOCK_INVALID");
            // Match-owned rows only. A fixed lock order serializes reservation
            // against cancellation without exposing arbitrary SQL or a global lane.
            await client.$queryRaw`SELECT id FROM match_admissions
              WHERE id = ANY(${[...ids].sort()}::uuid[]) ORDER BY id FOR UPDATE`;
          },
          async lockMatch(id: string): Promise<void> {
            if (!inTransaction || !matchIdPattern.test(id))
              throw new DatabaseError("DATABASE_LOCK_INVALID");
            // Fixed table and parameterized identity; never expose arbitrary SQL.
            await client.$queryRaw`SELECT id FROM matches WHERE id = ${id}::uuid FOR UPDATE`;
          },
          async lockMatchPresence(id: string): Promise<MatchPresenceRow | null> {
            if (!inTransaction || !matchIdPattern.test(id))
              throw new DatabaseError("DATABASE_LOCK_INVALID");
            // Read only presence metadata in the same statement that takes the
            // writer lock. No private game state or arbitrary selection escapes.
            const rows = await client.$queryRaw<MatchPresenceRow[]>`
              SELECT id, status::text AS status, state_version AS "stateVersion",
                last_event_seq AS "lastEventSeq", reconnect_policy_jsonb AS "reconnectPolicyJsonb",
                started_at AS "startedAt"
              FROM matches WHERE id = ${id}::uuid FOR UPDATE`;
            return rows[0] ?? null;
          },
        }
      : {}),
    ...(owner === "rooms"
      ? {
          async lockRooms(): Promise<void> {
            if (!inTransaction) throw new DatabaseError("DATABASE_LOCK_INVALID");
            // Take the Room lane before the first snapshot-bearing statement.
            // Coarse SSI predicate dependencies can otherwise couple distinct Rooms.
            await client.$executeRaw`LOCK TABLE rooms IN SHARE ROW EXCLUSIVE MODE`;
          },
        }
      : {}),
  }) as ScopedClient<O>;
}

export type DatabaseOptions = Readonly<{
  databaseUrl: { reveal(): string };
  poolMax: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  transactionMaxWaitMs: number;
  transactionTimeoutMs: number;
  observe?(durationMs: number, success: boolean): void;
}>;

// Construct once per process in the composition root. Importing this module has no I/O.
export function createDatabase(options: DatabaseOptions) {
  for (const value of [
    options.poolMax,
    options.connectionTimeoutMs,
    options.idleTimeoutMs,
    options.transactionMaxWaitMs,
    options.transactionTimeoutMs,
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new DatabaseError("DATABASE_CONFIGURATION_INVALID");
  }
  const pool = new Pool({
    connectionString: options.databaseUrl.reveal(),
    max: options.poolMax,
    connectionTimeoutMillis: options.connectionTimeoutMs,
    idleTimeoutMillis: options.idleTimeoutMs,
  });
  pool.on("error", () => {});
  const client = new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: true }),
    log: [],
    errorFormat: "minimal",
    transactionOptions: {
      maxWait: options.transactionMaxWaitMs,
      timeout: options.transactionTimeoutMs,
    },
  });
  let closed = false;
  let closing: Promise<void> | undefined;
  async function safe<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) throw new DatabaseError("DATABASE_CLOSED");
    const started = performance.now();
    let success = false;
    try {
      const result = await operation();
      success = true;
      return result;
    } catch (error) {
      throw failure(error);
    } finally {
      try {
        options.observe?.(performance.now() - started, success);
      } catch {
        /* observation cannot change a write */
      }
    }
  }
  return Object.freeze({
    poolSnapshot: () =>
      Object.freeze({
        max: options.poolMax,
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      }),
    connect: () => safe(() => client.$connect()),
    // Infrastructure-only, no table access or arbitrary SQL surface.
    probe: () =>
      safe(async () => {
        await client.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT 1`;
          },
          { maxWait: options.transactionMaxWaitMs, timeout: options.transactionTimeoutMs },
        );
        return true;
      }),
    disconnect: () => {
      closed = true;
      closing ??= client.$disconnect().catch((error) => {
        throw failure(error);
      });
      return closing;
    },
    forModule<O extends DatabaseOwner>(owner: O) {
      // Runtime whitelist as well as a type-level boundary; no raw SQL escape hatch.
      const scoped = scope(client, owner);
      return Object.freeze({
        execute: <T>(operation: (db: ScopedClient<O>) => Promise<T>) =>
          safe(() => operation(scoped)),
        // Consumer-owned DB effects and receipt commit together. No network effects here.
        consumeOnce: (
          consumer: string,
          eventId: string,
          operation: (db: ScopedClient<O>) => Promise<void>,
        ) =>
          safe(async () => {
            if (
              owner !== "leaderboard" ||
              !/^[a-z][a-z0-9-]{0,63}$/.test(consumer) ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)
            )
              throw new DatabaseError("DATABASE_CONSUMER_INVALID");
            return client.$transaction(async (tx) => {
              const receipt = await tx.consumerReceipt.createMany({
                data: { consumer, eventId },
                skipDuplicates: true,
              });
              if (receipt.count === 0) return "DUPLICATE" as const;
              await operation(scope(tx, owner, true));
              return "APPLIED" as const;
            });
          }),
        transaction: <T>(
          operation: (db: ScopedClient<O>) => Promise<T>,
          isolationLevel?: "Serializable",
        ) =>
          safe(() =>
            client.$transaction(
              (tx) => operation(scope(tx, owner, true)),
              isolationLevel ? { isolationLevel } : {},
            ),
          ),
      });
    },
  });
}
