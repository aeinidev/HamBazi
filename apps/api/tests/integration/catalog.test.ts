import { createHash, randomUUID } from "node:crypto";
import { createClient } from "redis";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createDatabase } from "@hambazi/database";
import { createCatalogPort, createCatalogRate } from "../../src/games/index.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed" ||
  !process.env.TEST_DATABASE_URL ||
  !process.env.API_DATABASE_URL ||
  !process.env.WORKER_DATABASE_URL
)
  throw new Error("Use isolated test:auth-http:local harness");
const config = {
  poolMax: 4,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 5000,
};
const admin = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL! },
});
const api = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
});
const worker = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
});
beforeAll(async () => {
  await Promise.all([admin.connect(), api.connect(), worker.connect()]);
});
afterAll(async () => {
  await Promise.all([admin.disconnect(), api.disconnect(), worker.disconnect()]);
});
const catalog = createCatalogPort(api);
it("reads the migrated baseline using API and Worker read-only credentials", async () => {
  expect(await catalog.list()).toMatchObject({
    ok: true,
    games: [{ id: "coup", status: "DISABLED", playable: false, descriptor: null }],
  });
  expect(await createCatalogPort(worker).find("coup")).toMatchObject({ ok: true });
  expect(await catalog.find("unknown")).toMatchObject({ error: { code: "NOT_FOUND" } });
});
it("observes maintenance changes without stale caching and cannot activate via stored flags", async () => {
  try {
    for (const status of ["MAINTENANCE", "ACTIVE"]) {
      await admin.forModule("games").execute((db) =>
        db.game.update({
          where: { id: "coup" },
          data: {
            status,
            matchmakingEnabled: true,
            privateRoomsEnabled: true,
            chatEnabled: true,
          },
        }),
      );
      expect(await catalog.find("coup")).toMatchObject({
        ok: true,
        game: {
          status,
          playable: false,
          matchmakingEnabled: false,
          privateRoomsEnabled: false,
          chatEnabled: false,
        },
      });
    }
  } finally {
    await admin.forModule("games").execute((db) =>
      db.game.update({
        where: { id: "coup" },
        data: {
          status: "DISABLED",
          matchmakingEnabled: false,
          privateRoomsEnabled: false,
          chatEnabled: false,
        },
      }),
    );
  }
});
it("fails closed for unsupported JSON configuration without returning its contents", async () => {
  try {
    await admin.forModule("games").execute((db) =>
      db.game.update({
        where: { id: "coup" },
        data: { configJsonb: { private: "do not expose" } },
      }),
    );
    expect(await catalog.list()).toEqual({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(await catalog.find("coup")).toEqual({ ok: false, error: { code: "INTERNAL_ERROR" } });
  } finally {
    await admin
      .forModule("games")
      .execute((db) => db.game.update({ where: { id: "coup" }, data: { configJsonb: {} } }));
  }
});
it("keeps API and Worker writes denied by PostgreSQL", async () => {
  for (const db of [api, worker]) {
    await expect(
      db
        .forModule("games")
        .execute((client) =>
          client.game.update({ where: { id: "coup" }, data: { status: "ACTIVE" } }),
        ),
    ).rejects.toThrow("Database operation failed");
    await expect(
      db.forModule("games").execute((client) => client.game.delete({ where: { id: "coup" } })),
    ).rejects.toThrow("Database operation failed");
  }
});
it("returns a sanitized failure after database shutdown", async () => {
  const closed = createDatabase({
    ...config,
    databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
  });
  const port = createCatalogPort(closed);
  await closed.disconnect();
  expect(await port.list()).toEqual({ ok: false, error: { code: "INTERNAL_ERROR" } });
});
it.skipIf(!process.env.TEST_AUTH_REDIS_URL)(
  "atomically shares quota across instances with per-user isolation",
  async () => {
    const options = {
      url: { reveal: () => process.env.TEST_AUTH_REDIS_URL! },
      namespace: randomUUID(),
      readLimit: 5,
    };
    const one = createCatalogRate(options);
    const two = createCatalogRate(options);
    const observer = createClient({
      url: process.env.TEST_AUTH_REDIS_URL!,
      socket: { reconnectStrategy: false },
    });
    observer.on("error", () => {});
    try {
      await Promise.all([one.connect(), two.connect(), observer.connect()]);
      const id = randomUUID();
      const decisions = await Promise.all(
        Array.from({ length: 20 }, (_, i) => (i % 2 ? one : two).consume(id)),
      );
      expect(decisions.filter((d) => d.allowed)).toHaveLength(5);
      expect(decisions.filter((d) => !d.allowed && d.reason === "limited")).toHaveLength(15);
      expect(await one.consume(randomUUID())).toEqual({ allowed: true });
      const digest = (value: string) => createHash("sha256").update(value).digest("hex");
      const key = `hambazi:catalog-rate:v1:${digest(options.namespace)}:${digest(id)}`;
      expect(await observer.get(key)).toBe("5");
      const ttl = await observer.pTTL(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60000);
      // Shorten only this disposable test's counter to verify fixed-window expiry.
      await observer.pExpire(key, 30);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(await two.consume(id)).toEqual({ allowed: true });
      expect(await observer.get(key)).toBe("1");
      await observer.set(key, "1");
      expect(await two.consume(id)).toEqual({ allowed: false, reason: "unavailable" });
      one.close();
      expect(await one.consume(id)).toEqual({ allowed: false, reason: "unavailable" });
    } finally {
      one.close();
      two.close();
      if (observer.isOpen) observer.destroy();
    }
  },
);
