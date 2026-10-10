import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDatabase, DatabaseError } from "@hambazi/database";
import { createPersonalAnarchistCoupGame } from "@hambazi/api";
import {
  createPersonalMatchPort,
  createMatchAutomationPort,
  createMatchReconnectPort,
} from "@hambazi/api/matches";
import { startMatchAutomation } from "../../src/match-automation.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  !process.env.TEST_WORKER_REDIS_URL ||
  !process.env.TEST_DATABASE_URL ||
  !process.env.API_DATABASE_URL ||
  !process.env.WORKER_DATABASE_URL
)
  throw Error("Use isolated test:personal-http:local harness");
const config = {
  poolMax: 3,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 5000,
};
const api = createDatabase({
    ...config,
    databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
  }),
  worker = createDatabase({
    ...config,
    databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
  }),
  admin = createDatabase({
    ...config,
    databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL! },
  });
beforeAll(() => Promise.all([api.connect(), worker.connect(), admin.connect()]));
afterAll(() => Promise.all([api.disconnect(), worker.disconnect(), admin.disconnect()]));
it("uses real role-separated BullMQ automation for an admitted server seat and drains safely", async () => {
  const owner = randomUUID(),
    clock = { nowMs: () => Date.now() },
    game = createPersonalAnarchistCoupGame();
  await admin.forModule("users").execute((db) =>
    db.user.create({
      data: {
        id: owner,
        telegramUserId: BigInt(720000001),
        publicHandle: "worker_personal_fixture",
        displayName: "Worker fixture",
        status: "ACTIVE",
      },
    }),
  );
  const personal = createPersonalMatchPort(api, {
    clock,
    game,
    owner: { allowsUserId: async (id) => id === owner },
  });
  const started = await personal.start(owner, { schemaVersion: 1, commandId: randomUUID() });
  expect(started.ok).toBe(true);
  if (!started.ok) throw Error();
  const initial = started.value as { matchId: string; stateVersion: number };
  expect(
    (
      await personal.command(owner, {
        schemaVersion: 1,
        matchId: initial.matchId,
        actionId: randomUUID(),
        expectedVersion: initial.stateVersion,
        command: { type: "DECLARE_INCOME" },
      })
    ).ok,
  ).toBe(true);
  const queue = await startMatchAutomation({
    redisUrl: { reveal: () => process.env.TEST_WORKER_REDIS_URL! },
    namespace: "personal_test_" + randomUUID().replaceAll("-", ""),
    intervalMs: 100,
    batchSize: 10,
    attempts: 3,
    backoffMs: 50,
    drainTimeoutMs: 5000,
    event: () => {},
    automation: createMatchAutomationPort(worker, { clock, games: [game], personal: true }),
    reconnect: createMatchReconnectPort(worker, {
      clock,
      policy: { schemaVersion: 1, leaseMs: 30000, graceMs: 30000, maxConnections: 1 },
    }),
  });
  try {
    let row = await worker.forModule("matches").execute((db) =>
      db.match.findUniqueOrThrow({
        where: { id: initial.matchId },
        select: { stateVersion: true },
      }),
    );
    const until = Date.now() + 5000;
    while (row.stateVersion < 3 && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 50));
      row = await worker.forModule("matches").execute((db) =>
        db.match.findUniqueOrThrow({
          where: { id: initial.matchId },
          select: { stateVersion: true },
        }),
      );
    }
    expect(row.stateVersion).toBeGreaterThanOrEqual(3);
    expect(await queue.probe()).toBe(true);
    const bot = await worker
      .forModule("matches")
      .execute((db) => db.matchBotSeat.findFirstOrThrow({ where: { matchId: initial.matchId } }));
    await expect(
      worker.forModule("matches").execute((db) =>
        db.matchBotSeat.create({
          data: { matchId: initial.matchId, actorId: randomUUID(), seat: 2 },
        }),
      ),
    ).rejects.toBeInstanceOf(DatabaseError);
    expect(
      await admin
        .forModule("users")
        .execute((db) => db.user.findUnique({ where: { id: bot.actorId } })),
    ).toBe(null);
  } finally {
    await queue.close();
    await queue.settled();
  }
  const current = await personal.read(owner, { schemaVersion: 1, matchId: initial.matchId });
  if (!current.ok) throw Error();
  const snapshot = current.value as { stateVersion: number };
  expect(
    (
      await personal.close(owner, {
        schemaVersion: 1,
        actionId: randomUUID(),
        matchId: initial.matchId,
        expectedVersion: snapshot.stateVersion,
      })
    ).ok,
  ).toBe(true);
}, 15000);
