import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createDatabase } from "@hambazi/database";
import { createMatchResultPort } from "../../src/matches/index.js";
import { createStatisticsPort, createStatisticsProjection } from "../../src/leaderboard/index.js";
import { createUserIdentityPort, createPublicNamesPort } from "../../src/users/index.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed" ||
  !process.env.API_DATABASE_URL ||
  !process.env.WORKER_DATABASE_URL ||
  !process.env.TEST_DATABASE_URL
)
  throw new Error("Use isolated test:auth-http:local harness");
const options = {
  poolMax: 10,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 5000,
};
const admin = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL! },
});
const api = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
});
const a = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
});
const b = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
});
const clock = { nowMs: () => Date.parse("2026-10-02T12:00:00Z") };
const one = createStatisticsProjection(a, clock),
  two = createStatisticsProjection(b, clock),
  matches = createMatchResultPort(a);
const reads = createStatisticsPort(api, {
  clock,
  users: createUserIdentityPort(api),
  names: createPublicNamesPort(api),
});
const ids = [randomUUID(), randomUUID(), randomUUID()];
beforeAll(async () => {
  await Promise.all([admin.connect(), api.connect(), a.connect(), b.connect()]);
  for (const [i, id] of ids.entries())
    await admin.forModule("users").execute((db) =>
      db.user.create({
        data: {
          id,
          telegramUserId: BigInt(35000000 + i),
          publicHandle: `stats_fixture_${i}`,
          displayName: i === 0 ? "<b>Player</b>" : "Statistics player",
          status: "ACTIVE",
        },
      }),
    );
});
afterAll(() => Promise.all([admin.disconnect(), api.disconnect(), a.disconnect(), b.disconnect()]));
async function finished(winner = ids[0]!, at = clock.nowMs(), bot = false) {
  const matchId = randomUUID(),
    eventId = randomUUID();
  const payload = {
    schemaVersion: 1,
    matchId,
    gameId: "coup",
    stateVersion: 1,
    lastEventSeq: 1,
    finishedAt: at,
    engineVersion: "coup-v1",
    stateSchemaVersion: 4,
    rulesetVersion: "coup-provisional-complete-v1",
    result: {
      placements: [winner, ...ids.filter((id) => id !== winner)].map((playerId, i) => ({
        playerId,
        place: i + 1,
      })),
      winnerId: winner,
      reason: "LAST_PLAYER_STANDING",
      metrics: { turnsPlayed: 3 },
    },
  };
  await admin.forModule("matches").transaction(async (db) => {
    await db.match.create({
      data: {
        id: matchId,
        gameId: "coup",
        matchType: "MATCHMAKING",
        status: "FINISHED",
        stateJsonb: { synthetic: true },
        stateVersion: 1,
        lastEventSeq: 1,
        finishedAt: new Date(at),
        engineVersion: payload.engineVersion,
        stateSchemaVersion: 4,
        rulesetVersion: payload.rulesetVersion,
      },
    });
    for (const [seat, userId] of ids.entries())
      await db.matchPlayer.create({
        data: {
          matchId,
          userId,
          seat,
          agentType: bot && userId === winner ? "BOT" : "HUMAN",
          connectionStatus: bot && userId === winner ? "REPLACED_BY_BOT" : "CONNECTED",
          replacedAt: bot && userId === winner ? new Date(at - 1) : null,
        },
      });
    await db.outboxEvent.create({
      data: {
        id: eventId,
        aggregateId: matchId,
        type: "MATCH_FINISHED_V1",
        schemaVersion: 1,
        payloadJsonb: payload,
        status: "PENDING",
        createdAt: new Date(at),
      },
    });
  });
  const event = {
    schemaVersion: 1,
    eventId,
    aggregateId: matchId,
    occurredAt: at,
    type: "MATCH_FINISHED_V1",
    correlation: {},
    payload,
  };
  return { event, input: await matches.record(event) };
}
it("recovers immutable standard results with current Worker grants and rejects forged finish inputs", async () => {
  const f = await finished();
  expect(await matches.record(f.event)).toEqual(f.input);
  const rows = await api.forModule("matches").execute(async (db) => ({
    result: await db.matchResult.findUniqueOrThrow({ where: { matchId: f.event.aggregateId } }),
    seats: await db.gameResult.findMany({ where: { matchId: f.event.aggregateId } }),
  }));
  expect(rows.result.payloadJsonb).toEqual(f.event.payload);
  expect(rows.seats).toHaveLength(3);
  await expect(
    matches.record({
      ...f.event,
      payload: { ...f.event.payload, result: { ...f.event.payload.result, winnerId: ids[1] } },
    }),
  ).rejects.toThrow("Match result unavailable");
  await expect(
    admin.forModule("matches").execute((db) =>
      db.matchResult.update({
        where: { matchId: f.event.aggregateId },
        data: { payloadJsonb: {} },
      }),
    ),
  ).rejects.toThrow();
  await expect(
    admin
      .forModule("matches")
      .execute((db) => db.gameResult.deleteMany({ where: { matchId: f.event.aggregateId } })),
  ).rejects.toThrow();
});
it("deduplicates concurrent deliveries across Worker clients and credits a Bot-replaced account", async () => {
  const f = await finished(ids[0], clock.nowMs(), true);
  const outcomes = await Promise.all(
    Array.from({ length: 8 }, (_, i) => (i % 2 ? one : two).consume(f.input)),
  );
  expect(outcomes.filter((v) => v === "APPLIED")).toHaveLength(1);
  expect(outcomes.filter((v) => v === "DUPLICATE")).toHaveLength(7);
  expect(await reads.own(ids[0], {})).toMatchObject({
    value: { games: [{ completed: "1", wins: "1", losses: "0" }] },
  });
  expect(await reads.own(ids[1], {})).toMatchObject({
    value: { games: [{ completed: "1", wins: "0", losses: "1" }] },
  });
  expect(await one.consume({ ...f.input, eventId: randomUUID() })).toBe("APPLIED");
  expect(await reads.own(ids[0], {})).toMatchObject({
    value: { games: [{ completed: "1", wins: "1" }] },
  });
});
it("rolls back receipt, Match application and counts together when an aggregate write fails", async () => {
  const f = await finished(ids[1]);
  const scope = a.forModule("leaderboard");
  const broken = {
    ...a,
    forModule: () => ({
      ...scope,
      consumeOnce: (
        consumer: string,
        eventId: string,
        effect: Parameters<typeof scope.consumeOnce>[2],
      ) =>
        scope.consumeOnce(consumer, eventId, (db) =>
          effect({
            ...db,
            statsValue: new Proxy(db.statsValue, {
              get(target, key) {
                if (key === "upsert")
                  return () => {
                    throw new Error("synthetic aggregate failure");
                  };
                return Reflect.get(target, key);
              },
            }),
          }),
        ),
    }),
  } as typeof a;
  await expect(createStatisticsProjection(broken, clock).consume(f.input)).rejects.toThrow();
  expect(
    await scope.execute((db) =>
      db.consumerReceipt.count({ where: { consumer: "statistics-v1", eventId: f.input.eventId } }),
    ),
  ).toBe(0);
  expect(
    await scope.execute((db) =>
      db.statsApplication.count({ where: { matchId: f.input.payload.matchId } }),
    ),
  ).toBe(0);
  expect(await one.consume(f.input)).toBe("APPLIED");
});
it("ranks equal wins equally, orders ties by ID and paginates through zero-win participants", async () => {
  const page = await reads.board(ids[0], "coup", { limit: "1" });
  expect(page.ok).toBe(true);
  if (!page.ok) throw new Error();
  expect(page.value.entries[0]).toMatchObject({ rank: "1", wins: "1" });
  expect(page.value.nextOffset).toBe(1);
  const next = await reads.board(ids[0], "coup", { offset: "1", limit: "2" });
  if (!next.ok) throw new Error();
  expect(next.value.entries.map((r) => [r.rank, r.wins])).toEqual([
    ["1", "1"],
    ["3", "0"],
  ]);
  expect([page.value.entries[0]!.userId, next.value.entries[0]!.userId]).toEqual(
    [ids[0], ids[1]].sort(),
  );
  expect(next.value.nextOffset).toBeNull();
});
it("assigns late deliveries by finish time across the exact UTC week boundary", async () => {
  const before = await finished(ids[2], Date.parse("2026-09-27T23:59:59.999Z"));
  await one.consume(before.input);
  const after = await finished(ids[2], Date.parse("2026-09-28T00:00:00Z"));
  await one.consume(after.input);
  expect(await reads.own(ids[2], { period: "weekly" })).toMatchObject({
    value: { period: "week:2026-09-28", games: [{ completed: "3", wins: "1", losses: "2" }] },
  });
});
it("rebuilds from durable results while live delivery overlaps and does not expose partial counts", async () => {
  const old = await reads.own(ids[0], {}),
    id = await one.begin();
  await expect(two.begin()).rejects.toThrow();
  const page = await matches.page(null, 25);
  await one.applyBatch(id, page.results);
  expect(await reads.own(ids[0], {})).toEqual(old);
  const live = await finished(ids[0]);
  await two.consume(live.input);
  let cursor = page.next;
  while (cursor) {
    const more = await matches.page(cursor, 25);
    await one.applyBatch(id, more.results);
    cursor = more.next;
  }
  await one.applyBatch(id, [live.input]);
  await one.finish(id);
  expect(await reads.own(ids[0], {})).toMatchObject({
    value: { games: [{ completed: "6", wins: "3", losses: "3" }] },
  });
  expect(await one.consume(live.input)).toBe("DUPLICATE");
  await expect(two.applyBatch(id, [live.input])).rejects.toThrow();
  expect(await reads.own(ids[0], {})).toMatchObject({
    value: { games: [{ completed: "6", wins: "3" }] },
  });
});
it("keeps active counts on failed builds and fences stale builders after trusted crash recovery", async () => {
  const old = await reads.own(ids[0], {}),
    id = await one.begin();
  expect(await two.building()).toBe(id);
  await two.abort(id);
  expect(await reads.own(ids[0], {})).toEqual(old);
  const newer = await two.begin();
  await expect(one.finish(id)).rejects.toThrow();
  await expect(one.abort(id)).rejects.toThrow();
  await two.abort(newer);
});
it("keeps projection writes Worker-only and user names unavailable to the Worker database", async () => {
  await expect(
    api
      .forModule("leaderboard")
      .execute((db) => db.statsValue.updateMany({ data: { value: 999n } })),
  ).rejects.toThrow();
  await expect(a.forModule("users").execute((db) => db.user.findMany())).rejects.toThrow();
});
