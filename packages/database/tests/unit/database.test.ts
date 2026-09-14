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
  it("exposes only session metadata to the Auth owner", async () => {
    const database = createDatabase(options);
    await database.forModule("auth").execute(async (db) => {
      expect(Object.keys(db)).toEqual(["session"]);
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
  });
  it("returns only owned top-level delegates, no raw SQL/client", async () => {
    const database = createDatabase(options);
    await database.forModule("users").execute(async (db) => {
      expect(Object.keys(db).sort()).toEqual(["user", "userSettings"]);
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
