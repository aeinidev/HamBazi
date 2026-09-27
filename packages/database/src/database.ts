import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import type { Prisma } from "./generated/prisma/client.js";

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
    "gameEvent",
    "processedCommand",
    "gameResult",
    "outboxEvent",
  ],
  chat: ["chatMessage"],
  leaderboard: ["userGameStats", "consumerReceipt"],
  outbox: ["outboxEvent"],
} as const;
export type DatabaseOwner = keyof typeof ownership;
type ScopedClient<O extends DatabaseOwner> = Pick<
  Prisma.TransactionClient,
  (typeof ownership)[O][number]
>;

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
): ScopedClient<O> {
  if (!Object.hasOwn(ownership, owner)) throw new DatabaseError("DATABASE_OWNER_INVALID");
  return Object.freeze(
    Object.fromEntries(ownership[owner].map((key) => [key, client[key]])),
  ) as ScopedClient<O>;
}

export type DatabaseOptions = Readonly<{
  databaseUrl: { reveal(): string };
  poolMax: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  transactionMaxWaitMs: number;
  transactionTimeoutMs: number;
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
  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: options.databaseUrl.reveal(),
      max: options.poolMax,
      connectionTimeoutMillis: options.connectionTimeoutMs,
      idleTimeoutMillis: options.idleTimeoutMs,
    }),
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
    try {
      return await operation();
    } catch (error) {
      throw failure(error);
    }
  }
  return Object.freeze({
    connect: () => safe(() => client.$connect()),
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
        transaction: <T>(
          operation: (db: ScopedClient<O>) => Promise<T>,
          isolationLevel?: "Serializable",
        ) =>
          safe(() =>
            client.$transaction(
              (tx) => operation(scope(tx, owner)),
              isolationLevel ? { isolationLevel } : {},
            ),
          ),
      });
    },
  });
}
