import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import type { Prisma } from "./generated/prisma/client.js";
import { Pool } from "pg";

const ownership = {
  auth: ["session", "botUpdateReceipt", "botOnboardingFlow"],
  users: ["user", "userSettings", "profileMutationReceipt"],
  games: ["game"],
  rooms: ["room", "roomMember", "roomCommandReceipt"],
  matches: [
    "matchAdmission",
    "matchReservation",
    "match",
    "matchPlayer",
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
type ScopedClient<O extends DatabaseOwner> = (O extends "chat"
  ? Omit<OwnedClient<O>, "outboxEvent"> & {
      outboxEvent: Pick<Prisma.TransactionClient["outboxEvent"], "create">;
    }
  : OwnedClient<O>) &
  (O extends "matches" ? { lockMatch(id: string): Promise<void> } : object) &
  (O extends "leaderboard" ? { lockStatistics(): Promise<void> } : object) &
  (O extends "outbox"
    ? { lockDueOutbox(at: Date, limit: number): Promise<readonly string[]> }
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
  const code =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const safeCodes: Record<string, string> = {
    P2002: "DATABASE_UNIQUE_CONFLICT",
    P2003: "DATABASE_REFERENCE_CONFLICT",
    P2025: "DATABASE_RECORD_NOT_FOUND",
    P2034: "DATABASE_TRANSACTION_CONFLICT",
  };
  return new DatabaseError(
    typeof code === "string" && Object.hasOwn(safeCodes, code) ? safeCodes[code] : undefined,
  );
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
          async lockDueOutbox(at: Date, limit: number): Promise<readonly string[]> {
            if (
              !inTransaction ||
              !Number.isFinite(at.getTime()) ||
              !Number.isInteger(limit) ||
              limit < 1 ||
              limit > 100
            )
              throw new DatabaseError("DATABASE_LOCK_INVALID");
            const rows = await client.$queryRaw<{ id: string }[]>`
          SELECT id FROM outbox_events WHERE status = 'PENDING' AND next_attempt_at <= ${at}
          AND (claimed_until IS NULL OR claimed_until <= ${at})
          ORDER BY next_attempt_at, created_at, id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
            return rows.map((row) => row.id);
          },
        }
      : {}),
    ...(owner === "matches"
      ? {
          async lockMatch(id: string): Promise<void> {
            if (
              !inTransaction ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
            )
              throw new DatabaseError("DATABASE_LOCK_INVALID");
            // Fixed table and parameterized identity; never expose arbitrary SQL.
            await client.$queryRaw`SELECT id FROM matches WHERE id = ${id}::uuid FOR UPDATE`;
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
