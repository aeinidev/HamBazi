import { inspect } from "node:util";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDatabase, DatabaseError } from "../../src/index.js";

const options = {
  databaseUrl: { reveal: () => "postgresql://synthetic:synthetic@127.0.0.1:1/unavailable" },
  poolMax: 1,
  connectionTimeoutMs: 100,
  idleTimeoutMs: 100,
  transactionMaxWaitMs: 100,
  transactionTimeoutMs: 100,
};

describe("database infrastructure boundary", () => {
  it("restricts the fixed Room transaction lock to its owner and an active transaction", async () => {
    const database = createDatabase(options);
    try {
      await database.forModule("rooms").execute(async (db) => {
        expect("$executeRaw" in db).toBe(false);
        await expect(db.lockRooms()).rejects.toMatchObject({ code: "DATABASE_LOCK_INVALID" });
      });
      for (const owner of ["users", "auth", "matches", "outbox"] as const)
        await database.forModule(owner).execute(async (db) => {
          expect("lockRooms" in db).toBe(false);
        });
    } finally {
      await database.disconnect();
    }
  });
  it("sanitizes an unavailable read-only probe without exposing connection data", async () => {
    const database = createDatabase(options);
    try {
      await expect(database.probe()).rejects.toBeInstanceOf(DatabaseError);
    } finally {
      await database.disconnect();
    }
  });
  it("expands onboarding storage without modifying or dropping existing data", async () => {
    const sql = await readFile(
      new URL("../../prisma/migrations/202609210001_bot_onboarding/migration.sql", import.meta.url),
      "utf8",
    );
    expect(sql.startsWith("BEGIN;")).toBe(true);
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain("bot_update_receipts_bot_id_update_id_key");
    expect(sql).toContain("bot_onboarding_flows_bot_id_telegram_user_id_key");
    expect(sql).not.toMatch(
      /DROP TABLE|DROP COLUMN|TRUNCATE TABLE|ALTER TABLE users|ALTER TABLE sessions/,
    );
  });
  it("exposes only session and onboarding metadata to the Auth owner", async () => {
    const database = createDatabase(options);
    await database.forModule("auth").execute(async (db) => {
      expect(Object.keys(db)).toEqual(["session", "botUpdateReceipt", "botOnboardingFlow"]);
      expect("user" in db).toBe(false);
    });
    await database.disconnect();
  });
  it("adds sessions without altering the foundation migration", async () => {
    const sql = await readFile(
      new URL("../../prisma/migrations/202609140001_auth_sessions/migration.sql", import.meta.url),
      "utf8",
    );
    expect(sql.startsWith("BEGIN;")).toBe(true);
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain("sessions_guard_metadata");
    expect(sql).toContain("sessions_user_id_command_id_key");
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE TABLE/);
  });
  it.each(["toString", "__proto__", "SYNTHETIC_UNKNOWN_CODE"])(
    "does not expose unrecognized error code %s",
    async (code) => {
      const database = createDatabase(options);
      try {
        await expect(
          database.forModule("users").execute(async () => {
            throw { code };
          }),
        ).rejects.toMatchObject({ code: "DATABASE_OPERATION_FAILED" });
      } finally {
        await database.disconnect();
      }
    },
  );
  it.each([
    "poolMax",
    "connectionTimeoutMs",
    "idleTimeoutMs",
    "transactionMaxWaitMs",
    "transactionTimeoutMs",
  ])("requires explicit positive %s", (key) => {
    expect(() => createDatabase({ ...options, [key]: 0 })).toThrow(DatabaseError);
  });
  it("constructs without connecting and closes idempotently", async () => {
    const database = createDatabase(options);
    expect(Object.isFrozen(database)).toBe(true);
    await database.disconnect();
    await database.disconnect();
    await expect(database.connect()).rejects.toMatchObject({ code: "DATABASE_CLOSED" });
    await expect(database.probe()).rejects.toMatchObject({ code: "DATABASE_CLOSED" });
  });
  it("returns only owned top-level delegates, no raw SQL/client", async () => {
    const database = createDatabase(options);
    await database.forModule("users").execute(async (db) => {
      expect(Object.keys(db).sort()).toEqual(["profileMutationReceipt", "user", "userSettings"]);
      expect("match" in db).toBe(false);
      expect("$queryRaw" in db).toBe(false);
    });
    await database.disconnect();
  });
  it("removes arbitrary error values, causes, and Prisma metadata", async () => {
    const database = createDatabase(options);
    const secret = "SYNTHETIC_DATABASE_SECRET";
    try {
      await database.forModule("users").execute(async () => {
        throw { code: "P2002", meta: secret, message: secret };
      });
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseError);
      expect((error as DatabaseError).code).toBe("DATABASE_UNIQUE_CONFLICT");
      expect(
        [String(error), inspect(error), JSON.stringify(error)].every(
          (value) => !value.includes(secret),
        ),
      ).toBe(true);
      expect("cause" in (error as Error)).toBe(false);
    } finally {
      await database.disconnect();
    }
  });
  it("does not publicly re-export Prisma or generated models", async () => {
    const source = await readFile(new URL("../../src/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/Prisma|generated|export \*/);
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    );
    expect(Object.keys(manifest.exports)).toEqual(["."]);
  });
  it("classifies commit-time adapter write conflicts without exposing their cause", async () => {
    const database = createDatabase(options);
    // Prisma 7's transaction commit can expose the adapter error directly;
    // statement execution converts this same kind into P2034.
    const error = Object.assign(new Error("PRIVATE_COMMIT_CANARY"), {
      name: "DriverAdapterError",
      cause: { kind: "TransactionWriteConflict", detail: "PRIVATE_SQL_CANARY" },
    });
    try {
      await expect(
        database.forModule("rooms").execute(async () => {
          throw error;
        }),
      ).rejects.toMatchObject({ code: "DATABASE_TRANSACTION_CONFLICT" });
      try {
        await database.forModule("rooms").execute(async () => {
          throw error;
        });
      } catch (failure) {
        expect(
          [String(failure), inspect(failure), JSON.stringify(failure)].every(
            (value) => !value.includes("PRIVATE_"),
          ),
        ).toBe(true);
        expect("cause" in (failure as Error)).toBe(false);
      }
    } finally {
      await database.disconnect();
    }
  });
  it("does not infer a retryable commit from messages or unrelated adapter failures", async () => {
    const database = createDatabase(options);
    try {
      for (const error of [
        {
          name: "DriverAdapterError",
          cause: { kind: "postgres", code: "08006" },
          message: "TransactionWriteConflict",
        },
        { name: "UnknownError", cause: { kind: "TransactionWriteConflict" } },
        { name: "DriverAdapterError", cause: null },
        { name: "DriverAdapterError", cause: { kind: "PRIVATE_UNKNOWN_CANARY" } },
        {
          name: "DriverAdapterError",
          code: "PRIVATE_UNKNOWN_CANARY",
          cause: { kind: "TransactionWriteConflict" },
        },
        Object.defineProperty({}, "code", {
          get() {
            throw new Error("PRIVATE_GETTER_CANARY");
          },
        }),
      ]) {
        await expect(
          database.forModule("rooms").execute(async () => {
            throw error;
          }),
        ).rejects.toMatchObject({ code: "DATABASE_OPERATION_FAILED" });
      }
    } finally {
      await database.disconnect();
    }
  });
  it("keeps append-only and version checks in the checked-in migration", async () => {
    const sql = await readFile(
      new URL("../../prisma/migrations/202609130001_foundation/migration.sql", import.meta.url),
      "utf8",
    );
    expect(sql.startsWith("BEGIN;")).toBe(true);
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain("game_events_no_truncate");
    expect(sql).toContain("matches_guard_versions");
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE TABLE/);
  });
});

it("exposes room receipts only to the Rooms owner and keeps the migration additive", async () => {
  const database = createDatabase(options);
  await database.forModule("rooms").execute(async (db) => {
    expect(Object.keys(db)).toEqual(["room", "roomMember", "roomCommandReceipt", "lockRooms"]);
    expect("user" in db).toBe(false);
    expect("match" in db).toBe(false);
  });
  await database.forModule("users").execute(async (db) => {
    expect("roomCommandReceipt" in db).toBe(false);
  });
  await database.disconnect();
  const sql = await readFile(
    new URL("../../prisma/migrations/202609220003_private_rooms/migration.sql", import.meta.url),
    "utf8",
  );
  expect(sql.startsWith("BEGIN;")).toBe(true);
  expect(sql.trim().endsWith("COMMIT;")).toBe(true);
  expect(sql).toContain("PRIMARY KEY (actor_user_id, command_id)");
  expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE TABLE/);
});

it("keeps admission and reservation metadata exclusive to Matches", async () => {
  const database = createDatabase(options);
  await database.forModule("matches").execute(async (db) => {
    expect("matchAdmission" in db).toBe(true);
    expect("matchReservation" in db).toBe(true);
    expect("user" in db).toBe(false);
  });
  for (const owner of ["auth", "users", "games", "rooms", "chat", "leaderboard", "outbox"] as const)
    await database.forModule(owner).execute(async (db) => {
      expect("matchAdmission" in db).toBe(false);
      expect("matchReservation" in db).toBe(false);
    });
  await database.disconnect();
});

it("expands Match processing without rewriting history or exposing a general SQL interface", async () => {
  const sql = await readFile(
    new URL("../../prisma/migrations/202609290001_match_processing/migration.sql", import.meta.url),
    "utf8",
  );
  expect(sql.startsWith("BEGIN;")).toBe(true);
  expect(sql.trim().endsWith("COMMIT;")).toBe(true);
  expect(sql).toContain("ADD COLUMN ready_at");
  expect(sql).toContain("ADD COLUMN request_digest");
  expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE processed_commands/);
  const database = createDatabase(options);
  await database.forModule("matches").execute(async (db) => {
    expect("lockMatch" in db).toBe(true);
    expect("lockMatchPresence" in db).toBe(true);
    expect("$queryRaw" in db).toBe(false);
    await expect(db.lockMatch("00000000-0000-4000-8000-000000000001")).rejects.toMatchObject({
      code: "DATABASE_LOCK_INVALID",
    });
    await expect(
      db.lockMatchPresence("00000000-0000-4000-8000-000000000001"),
    ).rejects.toMatchObject({ code: "DATABASE_LOCK_INVALID" });
  });
  for (const owner of ["users", "rooms", "outbox"] as const)
    await database.forModule(owner).execute(async (db) => {
      expect("lockMatch" in db).toBe(false);
      expect("lockMatchPresence" in db).toBe(false);
    });
  await database.disconnect();
});

it("restricts outbox locks and consumer effects to their owning transaction boundary", async () => {
  const database = createDatabase(options);
  try {
    await database.forModule("outbox").execute(async (db) => {
      expect("$queryRaw" in db).toBe(false);
      await expect(db.lockDueOutbox(new Date(0), 1)).rejects.toMatchObject({
        code: "DATABASE_LOCK_INVALID",
      });
    });
    let applied = false;
    await expect(
      database
        .forModule("matches")
        .consumeOnce("test-v1", "00000000-0000-4000-8000-000000000001", async () => {
          applied = true;
        }),
    ).rejects.toMatchObject({ code: "DATABASE_OPERATION_FAILED" });
    await expect(
      database
        .forModule("leaderboard")
        .consumeOnce("invalid consumer", "00000000-0000-4000-8000-000000000001", async () => {
          applied = true;
        }),
    ).rejects.toMatchObject({ code: "DATABASE_OPERATION_FAILED" });
    expect(applied).toBe(false);
  } finally {
    await database.disconnect();
  }
});

it("keeps reconnect leases Matches-owned with additive metadata and immutable tombstones", async () => {
  const sql = await readFile(
    new URL("../../prisma/migrations/202609290003_match_reconnect/migration.sql", import.meta.url),
    "utf8",
  );
  expect(sql.startsWith("BEGIN;")).toBe(true);
  expect(sql.trim().endsWith("COMMIT;")).toBe(true);
  expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
  const database = createDatabase(options);
  try {
    await database.forModule("matches").execute(async (db) => {
      expect("matchConnectionLease" in db).toBe(true);
    });
    for (const owner of ["users", "rooms", "auth", "outbox"] as const)
      await database.forModule(owner).execute(async (db) => {
        expect("matchConnectionLease" in db).toBe(false);
      });
  } finally {
    await database.disconnect();
  }
});

it("gives Chat an independent stream and insert-only outbox without Match state", async () => {
  const database = createDatabase(options);
  await database.forModule("chat").execute(async (db) => {
    expect(Object.keys(db)).toEqual(["chatMessage", "chatStream", "outboxEvent"]);
    expect(Object.keys(db.outboxEvent)).toEqual(["create"]);
    expect("match" in db).toBe(false);
    expect("gameEvent" in db).toBe(false);
  });
  await database.forModule("matches").execute(async (db) => {
    expect("chatMessage" in db).toBe(false);
    expect("chatStream" in db).toBe(false);
  });
  await database.disconnect();
  const sql = await readFile(
    new URL("../../prisma/migrations/202610010001_chat/migration.sql", import.meta.url),
    "utf8",
  );
  expect(sql).not.toMatch(/DELETE FROM|DROP COLUMN|DROP TABLE|UPDATE chat_messages/);
  expect(sql).toContain("command_id IS NULL AND seq IS NULL");
});

it("keeps results Matches-owned and generation aggregates Leaderboard-owned with additive migration", async () => {
  const database = createDatabase(options);
  try {
    await database.forModule("matches").execute(async (db) => {
      expect("matchResult" in db).toBe(true);
      expect("statsValue" in db).toBe(false);
    });
    await database.forModule("leaderboard").execute(async (db) => {
      expect("statsValue" in db).toBe(true);
      expect("statsHead" in db).toBe(true);
      expect("matchResult" in db).toBe(false);
      expect("gameResult" in db).toBe(false);
      await expect(db.lockStatistics()).rejects.toMatchObject({ code: "DATABASE_LOCK_INVALID" });
    });
  } finally {
    await database.disconnect();
  }
  const sql = await readFile(
    new URL("../../prisma/migrations/202610020001_statistics/migration.sql", import.meta.url),
    "utf8",
  );
  expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|ALTER TABLE user_game_stats/);
  expect(sql).toContain("match_results_immutable");
  expect(sql).toContain("game_results_no_truncate");
});
