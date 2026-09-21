import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@hambazi/database";
import { createErrorEnvelope } from "@hambazi/contracts";
import { createAccountCreationPort, createUserIdentityPort } from "../../src/users/index.js";
import {
  accountCreationService,
  type AccountRepository,
} from "../../src/users/application/accounts.js";
import { createAccountRepository } from "../../src/users/infrastructure/repositories/accounts.js";

/** Registered in the existing isolated suite after its foundation-fixture guard. */
export function accountIntegrationCases(admin: ReturnType<typeof createDatabase>) {
  describe("Users account creation against PostgreSQL", () => {
    const config = {
      poolMax: 8,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      transactionMaxWaitMs: 5000,
      transactionTimeoutMs: 5000,
    };
    const a = createDatabase({
      ...config,
      databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
    });
    const b = createDatabase({
      ...config,
      databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
    });
    beforeAll(async () => {
      await Promise.all([a.connect(), b.connect()]);
    });
    afterAll(async () => {
      await Promise.all([a.disconnect(), b.disconnect()]);
    });
    const count = (telegramUserId: bigint) =>
      admin.forModule("users").execute((db) => db.user.count({ where: { telegramUserId } }));
    const fixed = (database: typeof a, suffix: () => number) =>
      accountCreationService({
        repository: createAccountRepository(database),
        newUserId: randomUUID,
        newHandleSuffix: suffix,
      });
    it("creates through the production port with least-privilege credentials and no settings/username", async () => {
      const result = await createAccountCreationPort(a).createForVerifiedTelegramIdentity(
        "6001",
        "  José   Silva ",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Synthetic account failed");
      expect(result.account.displayName).toBe("José Silva");
      expect(result.account.publicHandle).toMatch(/^jose_silva_[1-9][0-9]{4}$/);
      expect(result.account.userId).toMatch(/^[0-9a-f-]{36}$/);
      expect(await createUserIdentityPort(b).findActiveByTelegramId("6001")).toEqual({
        userId: result.account.userId,
      });
      const row = await admin
        .forModule("users")
        .execute((db) => db.user.findUniqueOrThrow({ where: { telegramUserId: 6001n } }));
      expect(row.telegramUsername).toBeNull();
      expect(
        await admin
          .forModule("users")
          .execute((db) => db.userSettings.count({ where: { userId: row.id } })),
      ).toBe(0);
      expect(
        await createAccountCreationPort(b).createForVerifiedTelegramIdentity("6001", "Different"),
      ).toEqual(result);
      expect(await count(6001n)).toBe(1);
    });
    it("returns exactly one winner across eight synchronized creates on two database clients", async () => {
      let arrived = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      function gated(database: typeof a): AccountRepository {
        const repository = createAccountRepository(database);
        return {
          ...repository,
          async findByTelegramId(id) {
            const row = await repository.findByTelegramId(id);
            if (++arrived === 8) release();
            await gate;
            return row;
          },
        };
      }
      const ports = [a, b].map((database) =>
        accountCreationService({
          repository: gated(database),
          newUserId: randomUUID,
          newHandleSuffix: () => 65022,
        }),
      );
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          ports[i % 2]!.createForVerifiedTelegramIdentity("6002", i % 2 ? "First" : "Second"),
        ),
      );
      expect(results[0]!.ok).toBe(true);
      for (const result of results) expect(result).toEqual(results[0]);
      expect(await count(6002n)).toBe(1);
    });
    it("retries a shared-handle race for different identities without returning the other user", async () => {
      const ports = [a, b].map((database, i) => {
        let attempt = 0;
        return fixed(database, () => (++attempt === 1 ? 70000 : 70001 + i));
      });
      const results = await Promise.all(
        ports.map((port, i) =>
          port.createForVerifiedTelegramIdentity(String(6010 + i), "Collision"),
        ),
      );
      expect(results.every((result) => result.ok)).toBe(true);
      expect(new Set(results.map((result) => result.ok && result.account.userId)).size).toBe(2);
      expect(new Set(results.map((result) => result.ok && result.account.publicHandle)).size).toBe(
        2,
      );
      expect(await count(6010n)).toBe(1);
      expect(await count(6011n)).toBe(1);
    });
    it("fails after exactly five database handle collisions without a partial account", async () => {
      const suffix = vi.fn(() => 75000);
      const port = fixed(a, suffix);
      expect((await port.createForVerifiedTelegramIdentity("6020", "Fullbase")).ok).toBe(true);
      suffix.mockClear();
      expect(await port.createForVerifiedTelegramIdentity("6021", "Fullbase")).toEqual(
        createErrorEnvelope("INTERNAL_ERROR"),
      );
      expect(suffix).toHaveBeenCalledTimes(5);
      expect(await count(6021n)).toBe(0);
    });
    it("retries UUID collisions separately from handles and never returns a different identity", async () => {
      const first = await fixed(a, () => 76000).createForVerifiedTelegramIdentity("6030", "Uuid");
      if (!first.ok) throw new Error("Synthetic account failed");
      const ids = vi.fn((): string => randomUUID()).mockReturnValueOnce(first.account.userId);
      const port = accountCreationService({
        repository: createAccountRepository(b),
        newUserId: ids,
        newHandleSuffix: () => 76001,
      });
      const second = await port.createForVerifiedTelegramIdentity("6031", "Uuid");
      expect(second.ok && second.account.userId).not.toBe(first.account.userId);
      expect(second.ok).toBe(true);
      expect(ids).toHaveBeenCalledTimes(2);
    });
    it("preserves handle after a simulated future display-name edit and never reactivates an ineligible user", async () => {
      const port = fixed(a, () => 77000);
      const first = await port.createForVerifiedTelegramIdentity("6040", "Original");
      if (!first.ok) throw new Error("Synthetic account failed");
      await admin
        .forModule("users")
        .execute((db) =>
          db.user.update({ where: { telegramUserId: 6040n }, data: { displayName: "Edited" } }),
        );
      expect(await port.createForVerifiedTelegramIdentity("6040", "Ignored")).toEqual({
        ok: true,
        account: { ...first.account, displayName: "Edited" },
      });
      await admin
        .forModule("users")
        .execute((db) =>
          db.user.update({ where: { telegramUserId: 6040n }, data: { status: "BLOCKED" } }),
        );
      expect(await port.createForVerifiedTelegramIdentity("6040", "Ignored")).toEqual(
        createErrorEnvelope("UNAUTHENTICATED"),
      );
      expect(await createUserIdentityPort(b).findActiveByTelegramId("6040")).toBeUndefined();
      expect(await count(6040n)).toBe(1);
    });
    it("enforces both unique constraints for direct API-role database writes", async () => {
      for (const [telegramUserId, publicHandle] of [
        [6020n, "different_75001"],
        [6050n, "fullbase_75000"],
      ] as const) {
        await expect(
          a.forModule("users").execute((db) =>
            db.user.create({
              data: {
                id: randomUUID(),
                telegramUserId,
                publicHandle,
                displayName: "Synthetic",
                status: "ACTIVE",
              },
            }),
          ),
        ).rejects.toMatchObject({ code: "DATABASE_UNIQUE_CONFLICT" });
      }
      expect(await count(6050n)).toBe(0);
    });
    it("rolls back a failed transaction and allows a clean retry", async () => {
      const id = randomUUID();
      await expect(
        a.forModule("users").transaction(async (db) => {
          await db.user.create({
            data: {
              id,
              telegramUserId: 6060n,
              publicHandle: "rollback_78000",
              displayName: "Rollback",
              status: "ACTIVE",
            },
          });
          throw new Error("Synthetic failure after insert");
        }),
      ).rejects.toMatchObject({ code: "DATABASE_OPERATION_FAILED" });
      expect(await count(6060n)).toBe(0);
      expect(
        (await fixed(b, () => 78000).createForVerifiedTelegramIdentity("6060", "Rollback")).ok,
      ).toBe(true);
    });
    it("fails closed for an unavailable database without creating an account", async () => {
      const closed = createDatabase({
        ...config,
        databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
      });
      await closed.disconnect();
      expect(
        await createAccountCreationPort(closed).createForVerifiedTelegramIdentity(
          "6070",
          "Offline",
        ),
      ).toEqual(createErrorEnvelope("INTERNAL_ERROR"));
      expect(await count(6070n)).toBe(0);
    });
  });
}
