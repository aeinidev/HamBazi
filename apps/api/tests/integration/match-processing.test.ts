import { randomUUID } from "node:crypto";
import { createCorrelation, withCorrelation } from "@hambazi/observability";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDatabase, DatabaseError } from "@hambazi/database";
import { coupEngine, migrateCoupState, upcastCoupEvent } from "@hambazi/coup-engine";
import {
  createMatchProcessingPort,
  createMatchMembershipPort,
  type MatchAck,
  type MatchOutcome,
  type MatchGame,
} from "../../src/matches/index.js";
import { createCoupMatchGame } from "../../src/composition/coup-match.js";
import { rules } from "../fixtures/match-rules.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed" ||
  !process.env.API_DATABASE_URL ||
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
const a = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
});
const b = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
});
const admin = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL! },
});
beforeAll(() => Promise.all([a.connect(), b.connect(), admin.connect()]));
afterAll(() => Promise.all([a.disconnect(), b.disconnect(), admin.disconnect()]));
let seq = 12000000;
function value(result: MatchOutcome): MatchAck {
  if (!result.ok) throw new Error(`Match fixture failed: ${result.error.code}`);
  return result.value;
}
async function fixture(game: MatchGame = createCoupMatchGame(rules)) {
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids)
    await admin.forModule("users").execute((db) =>
      db.user.create({
        data: {
          id,
          telegramUserId: BigInt(++seq),
          publicHandle: `match_fixture_${seq}`,
          displayName: "Match fixture",
          status: "ACTIVE",
        },
      }),
    );
  const matchId = randomUUID();
  await a.forModule("matches").transaction(async (db) => {
    await db.match.create({
      data: {
        id: matchId,
        gameId: "coup",
        matchType: "MATCHMAKING",
        status: "CREATED",
        engineVersion: game.descriptor.engineVersion,
        stateSchemaVersion: game.descriptor.stateSchemaVersion,
        rulesetVersion: game.descriptor.rulesetVersion,
      },
    });
    for (const [seat, userId] of ids.entries())
      await db.matchPlayer.create({
        data: { matchId, userId, seat, agentType: "HUMAN", connectionStatus: "CONNECTED" },
      });
  });
  const clock = { nowMs: () => 2000 };
  const users = {
    findActiveById: async (userId: string) => ({ userId }),
    findActiveByTelegramId: async () => undefined,
  };
  const config = { clock, games: [game] };
  const first = createMatchProcessingPort(a, config, users);
  const second = createMatchProcessingPort(b, config, users);
  const request = (expectedVersion: number) => ({
    schemaVersion: 1 as const,
    actionId: randomUUID(),
    matchId,
    expectedVersion,
  });
  async function active() {
    value(await first.lifecycle({ ...request(0), operation: "WAIT" }));
    value(await first.ready(ids[0], request(1)));
    value(await first.ready(ids[1], request(2)));
    value(await first.lifecycle({ ...request(3), operation: "START" }));
    return value(await first.lifecycle({ ...request(4), operation: "ACTIVATE" }));
  }
  async function stored() {
    return a.forModule("matches").execute(async (db) => ({
      match: await db.match.findUniqueOrThrow({ where: { id: matchId } }),
      players: await db.matchPlayer.findMany({ where: { matchId }, orderBy: { seat: "asc" } }),
      events: await db.gameEvent.findMany({ where: { matchId }, orderBy: { seq: "asc" } }),
      commands: await db.processedCommand.findMany({
        where: { matchId },
        orderBy: { createdAt: "asc" },
      }),
      outbox: await db.outboxEvent.findMany({ where: { aggregateId: matchId } }),
      result: await db.matchResult.findUnique({ where: { matchId } }),
      resultSeats: await db.gameResult.findMany({ where: { matchId }, orderBy: { userId: "asc" } }),
    }));
  }
  return { ids, matchId, first, second, config, users, request, active, stored };
}
it("persists inherited transaction correlation and retains the original context on idempotent retry", async () => {
  const f = await fixture();
  const context = createCorrelation();
  const command = { ...f.request(0), operation: "WAIT" };
  const initial = await withCorrelation(context, () => f.first.lifecycle(command));
  const retry = await withCorrelation(createCorrelation(), () => f.second.lifecycle(command));
  expect(retry).toEqual(initial);
  const saved = await f.stored();
  expect(saved.outbox).toHaveLength(1);
  expect(saved.outbox[0]).toMatchObject(context);
  expect(saved.match.stateVersion).toBe(1);
});
it("authorizes only durable match members and downgrades a replaced human to spectator", async () => {
  const f = await fixture();
  const membership = createMatchMembershipPort(b);
  const ref = { schemaVersion: 1, matchId: f.matchId };
  expect(await membership.authorize(f.ids[0], ref)).toMatchObject({
    ok: true,
    value: { role: "PLAYER" },
  });
  expect(await membership.authorize(randomUUID(), ref)).toMatchObject({
    ok: false,
    error: { code: "NOT_FOUND" },
  });
  await a.forModule("matches").execute((db) =>
    db.matchPlayer.update({
      where: { matchId_userId: { matchId: f.matchId, userId: f.ids[0]! } },
      data: { agentType: "BOT", connectionStatus: "REPLACED_BY_BOT", replacedAt: new Date() },
    }),
  );
  expect(await membership.authorize(f.ids[0], ref)).toMatchObject({
    ok: true,
    value: { role: "SPECTATOR" },
  });
});
it("persists the guarded lifecycle, ready seats, initialization and safe atomic wake-up", async () => {
  const f = await fixture();
  expect(await f.first.lifecycle({ ...f.request(0), operation: "ACTIVATE" })).toMatchObject({
    error: { code: "GAME_STATE_CONFLICT" },
  });
  const ack = await f.active();
  const saved = await f.stored();
  expect(ack).toMatchObject({ status: "ACTIVE", stateVersion: 5, lastEventSeq: 7 });
  expect(saved.players.every((p) => p.readyAt !== null)).toBe(true);
  expect(saved.match.engineVersion).toBe("coup-v1");
  expect(saved.commands).toHaveLength(5);
  expect(saved.outbox).toHaveLength(5);
  expect(saved.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(JSON.stringify([ack, saved.outbox])).not.toMatch(
    /deck|influence|rules|cards|token|command/,
  );
});
it("deduplicates eight competing commands across two clients, preserving cached acknowledgements", async () => {
  const f = await fixture();
  await f.active();
  const input = { ...f.request(5), command: { type: "DECLARE_INCOME" } };
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => (i % 2 ? f.first : f.second).command(f.ids[0], input)),
  );
  for (const result of results) expect(result).toEqual(results[0]);
  expect(results[0]).toMatchObject({ ok: true, value: { stateVersion: 6 } });
  const saved = await f.stored();
  expect(saved.commands).toHaveLength(6);
  expect(saved.outbox).toHaveLength(6);
  expect(migrateCoupState(saved.match.stateJsonb, 4).players[0]!.coins).toBe(3);
  value(await f.first.command(f.ids[1], { ...f.request(6), command: { type: "DECLARE_INCOME" } }));
  const reconstructed = createMatchProcessingPort(b, f.config, f.users);
  expect(await reconstructed.command(f.ids[0], input)).toEqual(results[0]);
  expect(await f.first.command(f.ids[1], input)).toMatchObject({
    error: { code: "GAME_STATE_CONFLICT" },
  });
  expect(
    await f.first.command(f.ids[0], { ...input, command: { type: "DECLARE_TAX" } }),
  ).toMatchObject({ error: { code: "GAME_STATE_CONFLICT" } });
  expect(await f.first.command(f.ids[0], { ...input, expectedVersion: 7 })).toMatchObject({
    error: { code: "GAME_STATE_CONFLICT" },
  });
});
it("repeats unknown commit and duplicate retry races without a second engine effect", async () => {
  for (let round = 0; round < 6; round++) {
    const f = await fixture();
    await f.active();
    const input = { ...f.request(5), command: { type: "DECLARE_INCOME" } };
    const scope = a.forModule("matches");
    let lost = false;
    const interrupted = {
      ...a,
      forModule: (owner: Parameters<typeof a.forModule>[0]) =>
        owner !== "matches"
          ? a.forModule(owner)
          : {
              ...scope,
              transaction: async (
                operation: Parameters<typeof scope.transaction>[0],
                isolation?: Parameters<typeof scope.transaction>[1],
              ) => {
                const result = await scope.transaction(operation, isolation);
                if (!lost) {
                  lost = true;
                  throw new DatabaseError("DATABASE_OPERATION_FAILED");
                }
                return result;
              },
            },
    } as typeof a;
    const port = createMatchProcessingPort(interrupted, f.config, f.users);
    expect(await port.command(f.ids[0], input)).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
    expect(lost).toBe(true);
    const reconstructed = createMatchProcessingPort(b, f.config, f.users);
    const retries = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        (i % 2 ? reconstructed : f.first).command(f.ids[0], input),
      ),
    );
    for (const result of retries) expect(result).toEqual(retries[0]);
    expect(retries[0]).toMatchObject({ ok: true, value: { stateVersion: 6 } });
    const saved = await f.stored();
    expect(saved.commands.filter((row) => row.actionId === input.actionId)).toHaveLength(1);
    expect(saved.commands).toHaveLength(6);
    expect(saved.outbox).toHaveLength(6);
    expect(saved.match.stateVersion).toBe(6);
    expect(saved.events.map((row) => row.seq)).toEqual(
      Array.from({ length: saved.match.lastEventSeq }, (_, i) => i + 1),
    );
    expect(migrateCoupState(saved.match.stateJsonb, 4).players[0]!.coins).toBe(3);
  }
});
it("keeps durable truth unchanged during database adapter loss and resumes the original intent", async () => {
  const f = await fixture();
  await f.active();
  const input = { ...f.request(5), command: { type: "DECLARE_INCOME" } };
  const before = JSON.stringify(await f.stored());
  const closed = createDatabase({
    ...options,
    databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
  });
  await closed.disconnect();
  const unavailable = createMatchProcessingPort(closed, f.config, f.users);
  expect(await unavailable.command(f.ids[0], input)).toMatchObject({
    error: { code: "INTERNAL_ERROR" },
  });
  expect(JSON.stringify(await f.stored()) === before).toBe(true);
  const restored = createMatchProcessingPort(b, f.config, f.users);
  const ack = await restored.command(f.ids[0], input);
  expect(ack).toMatchObject({ ok: true, value: { stateVersion: 6 } });
  expect(await f.first.command(f.ids[0], input)).toEqual(ack);
  expect((await f.stored()).commands.filter((row) => row.actionId === input.actionId)).toHaveLength(
    1,
  );
});
it("serializes distinct commands for one version and rejects stale/invalid requests without writes", async () => {
  const f = await fixture();
  await f.active();
  const results = await Promise.all(
    [f.first, f.second].map((port) =>
      port.command(f.ids[0], { ...f.request(5), command: { type: "DECLARE_INCOME" } }),
    ),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok)).toMatchObject([{ error: { code: "GAME_STATE_CONFLICT" } }]);
  const before = await f.stored();
  expect(
    await f.first.command(f.ids[0], { ...f.request(5), command: { type: "DECLARE_INCOME" } }),
  ).toMatchObject({ error: { code: "GAME_STATE_CONFLICT" } });
  expect(
    await f.first.command(f.ids[0], { ...f.request(6), command: { type: "DECLARE_INCOME" } }),
  ).toMatchObject({ error: { code: "GAME_STATE_CONFLICT" } });
  expect(
    await f.first.command(f.ids[1], { ...f.request(6), command: { type: "CHEAT" } }),
  ).toMatchObject({ error: { code: "INVALID_INPUT" } });
  expect(await f.stored()).toEqual(before);
});
it("denies nonmembers and committed bot replacements, including receipt retrieval", async () => {
  const f = await fixture();
  await f.active();
  const input = { ...f.request(5), command: { type: "DECLARE_INCOME" } };
  expect(await f.first.command(randomUUID(), input)).toMatchObject({
    error: { code: "FORBIDDEN" },
  });
  value(await f.first.command(f.ids[0], input));
  await a.forModule("matches").execute((db) =>
    db.matchPlayer.update({
      where: { matchId_userId: { matchId: f.matchId, userId: f.ids[0]! } },
      data: { agentType: "BOT", replacedAt: new Date(2000) },
    }),
  );
  expect(await f.first.command(f.ids[0], input)).toMatchObject({ error: { code: "FORBIDDEN" } });
});
it("races readiness and activation with stable identity; cannot initialize twice", async () => {
  const f = await fixture();
  const wait = { ...f.request(0), operation: "WAIT" };
  const waits = await Promise.all([f.first.lifecycle(wait), f.second.lifecycle(wait)]);
  expect(waits[0]).toEqual(waits[1]);
  const ready = await Promise.all(
    f.ids.map((id, i) => (i ? f.second : f.first).ready(id, f.request(1))),
  );
  expect(ready.filter((r) => r.ok)).toHaveLength(1);
  const loser = ready.findIndex((r) => !r.ok);
  value(await f.first.ready(f.ids[loser], f.request(2)));
  value(await f.first.lifecycle({ ...f.request(3), operation: "START" }));
  const activate = { ...f.request(4), operation: "ACTIVATE" };
  const active = await Promise.all([f.first.lifecycle(activate), f.second.lifecycle(activate)]);
  expect(active[0]).toEqual(active[1]);
  const saved = await f.stored();
  expect(saved.events.filter((e) => e.type === "MATCH_INITIALIZED_V1")).toHaveLength(1);
  expect(await f.first.lifecycle({ ...f.request(5), operation: "ACTIVATE" })).toMatchObject({
    error: { code: "GAME_STATE_CONFLICT" },
  });
  expect(await f.stored()).toEqual(saved);
});
for (const delegate of ["gameEvent", "match", "processedCommand", "outboxEvent"] as const) {
  it(`rolls back state, events, receipt and outbox on injected ${delegate} write failure`, async () => {
    const f = await fixture();
    await f.active();
    const before = await f.stored();
    const scoped = a.forModule("matches");
    const failing = {
      ...a,
      forModule: () => ({
        ...scoped,
        transaction: (operation: Parameters<typeof scoped.transaction>[0]) =>
          scoped.transaction((db) =>
            operation(
              new Proxy(db, {
                get(target, key) {
                  if (key !== delegate) return Reflect.get(target, key);
                  return new Proxy(target[delegate], {
                    get(inner, method) {
                      if (method === (delegate === "match" ? "update" : "create"))
                        return () => {
                          throw new Error("SYNTHETIC_PRIVATE_FAILURE");
                        };
                      return Reflect.get(inner, method);
                    },
                  });
                },
              }),
            ),
          ),
      }),
    } as typeof a;
    const port = createMatchProcessingPort(failing, f.config, f.users);
    const input = { ...f.request(5), command: { type: "DECLARE_INCOME" } };
    expect(await port.command(f.ids[0], input)).toMatchObject({
      error: { code: "INTERNAL_ERROR", message: "Operation failed" },
    });
    expect(await f.stored()).toEqual(before);
    expect(await f.first.command(f.ids[0], input)).toMatchObject({
      ok: true,
      value: { stateVersion: 6 },
    });
  });
}
it("pins versions, fails unknown engines and corrupt snapshots closed", async () => {
  const f = await fixture();
  await f.active();
  const missing = createMatchProcessingPort(b, { ...f.config, games: [] }, f.users);
  expect(
    await missing.command(f.ids[0], { ...f.request(5), command: { type: "DECLARE_INCOME" } }),
  ).toMatchObject({ error: { code: "INCOMPATIBLE_GAME_VERSION" } });
  await expect(
    a.forModule("matches").execute((db) =>
      db.match.update({
        where: { id: f.matchId },
        data: { engineVersion: "new-unapproved-version" },
      }),
    ),
  ).rejects.toThrow();
  await admin.forModule("matches").execute((db) =>
    db.match.update({
      where: { id: f.matchId },
      data: { stateVersion: 6, stateJsonb: { invalid: "SYNTHETIC_PRIVATE" } },
    }),
  );
  const before = await f.stored();
  expect(
    await f.first.command(f.ids[0], { ...f.request(6), command: { type: "DECLARE_INCOME" } }),
  ).toMatchObject({ error: { code: "INCOMPATIBLE_GAME_VERSION" } });
  expect(await f.stored()).toEqual(before);
});
it("finishes a complete game and exactly replays persisted initialization/events and result", async () => {
  const f = await fixture();
  await f.active();
  const correlation = {
    requestId: randomUUID(),
    traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
  };
  const scope = a.forModule("matches");
  const rejectFinish = {
    ...a,
    forModule: () => ({
      ...scope,
      transaction: (operation: Parameters<typeof scope.transaction>[0]) =>
        scope.transaction((db) =>
          operation({
            ...db,
            outboxEvent: new Proxy(db.outboxEvent, {
              get(target, key) {
                if (key === "create")
                  return (input: Parameters<typeof target.create>[0]) => {
                    if (input.data.type === "MATCH_FINISHED_V1")
                      throw new Error("synthetic finish insertion failure");
                    return target.create(input);
                  };
                return Reflect.get(target, key);
              },
            }),
          }),
        ),
    }),
  } as typeof a;
  const failurePort = createMatchProcessingPort(rejectFinish, f.config, f.users);
  let rolledBackFinish = false;
  let previous:
    | { input: ReturnType<typeof f.request> & { command: unknown }; actor: string; ack: MatchAck }
    | undefined;
  for (let i = 0; i < 200; i++) {
    const saved = await f.stored();
    const state = migrateCoupState(saved.match.stateJsonb, 4);
    if (state.phase === "GAME_OVER") break;
    const actor = state.phase === "LOSS" ? state.loss!.playerId : state.turnPlayerId;
    const command =
      state.phase === "LOSS"
        ? { type: "SELECT_CARD_TO_LOSE", cardIndex: 0, windowId: state.window!.id }
        : state.players.find((p) => p.id === actor)!.coins >= state.rules.coupCost
          ? {
              type: "DECLARE_COUP",
              targetId: state.players.find((p) => p.id !== actor && p.influence.length > 0)!.id,
            }
          : { type: "DECLARE_INCOME" };
    const input = { ...f.request(saved.match.stateVersion), command };
    const attempt = await failurePort.command(actor, input, correlation);
    if (!attempt.ok) {
      expect(attempt.error.code).toBe("INTERNAL_ERROR");
      expect(await f.stored()).toEqual(saved);
      rolledBackFinish = true;
      previous = { input, actor, ack: value(await f.first.command(actor, input, correlation)) };
    } else previous = { input, actor, ack: attempt.value };
  }
  const saved = await f.stored();
  expect(saved.match.status).toBe("FINISHED");
  expect(rolledBackFinish).toBe(true);
  expect(saved.match.finishedAt).not.toBeNull();
  const baseline = saved.events.find((event) => event.type === "MATCH_INITIALIZED_V1")!;
  let replay = migrateCoupState((baseline.payloadJsonb as { snapshot: unknown }).snapshot, 4);
  for (const event of saved.events.filter((event) => event.type === "GAME_ENGINE_EVENT"))
    replay = coupEngine.applyEvent(
      replay,
      upcastCoupEvent((event.payloadJsonb as { event: unknown }).event, event.schemaVersion),
    );
  expect(replay).toEqual(saved.match.stateJsonb);
  expect(coupEngine.getResult(replay)).toEqual(
    coupEngine.getResult(migrateCoupState(saved.match.stateJsonb, 4)),
  );
  expect(saved.commands).toHaveLength(saved.match.stateVersion);
  expect(saved.outbox).toHaveLength(saved.match.stateVersion + 1);
  const finishes = saved.outbox.filter((event) => event.type === "MATCH_FINISHED_V1");
  expect(finishes).toHaveLength(1);
  expect(saved.result).toMatchObject({
    eventId: finishes[0]!.id,
    payloadJsonb: finishes[0]!.payloadJsonb,
  });
  expect(saved.resultSeats).toHaveLength(2);
  expect(saved.resultSeats.filter((r) => r.winner)).toHaveLength(1);
  expect(finishes[0]).toMatchObject(correlation);
  expect((finishes[0]!.payloadJsonb as { result: unknown }).result).toEqual(
    coupEngine.getResult(replay),
  );
  expect(saved.events.map((event) => event.seq)).toEqual(
    Array.from({ length: saved.match.lastEventSeq }, (_, i) => i + 1),
  );
  expect(value(await f.second.command(previous!.actor, previous!.input))).toEqual(previous!.ack);
  expect(
    await f.first.lifecycle({ ...f.request(saved.match.stateVersion), operation: "TERMINATE" }),
  ).toMatchObject({ error: { code: "GAME_STATE_CONFLICT" } });
});
it("serializes command versus termination and permanently rejects new terminal commands", async () => {
  const f = await fixture();
  await f.active();
  const results = await Promise.all([
    f.first.command(f.ids[0], { ...f.request(5), command: { type: "DECLARE_INCOME" } }),
    f.second.lifecycle({ ...f.request(5), operation: "TERMINATE" }),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  if ((await f.stored()).match.status === "ACTIVE")
    value(await f.first.lifecycle({ ...f.request(6), operation: "TERMINATE" }));
  const saved = await f.stored();
  expect(
    await f.first.command(f.ids[1], {
      ...f.request(saved.match.stateVersion),
      command: { type: "DECLARE_INCOME" },
    }),
  ).toMatchObject({ error: { code: "GAME_STATE_CONFLICT" } });
  expect(await f.stored()).toEqual(saved);
});
it("has no raw SQL escape hatch; row lock is Matches-only and transaction-only", async () => {
  await a.forModule("users").execute(async (db) => {
    expect("lockMatch" in db).toBe(false);
  });
  await expect(
    a.forModule("matches").execute((db) => db.lockMatch(randomUUID())),
  ).rejects.toThrow();
  await expect(
    a.forModule("matches").transaction((db) => db.lockMatch("invalid SQL identity")),
  ).rejects.toThrow();
  await a.forModule("matches").transaction(async (db) => {
    expect("$queryRaw" in db).toBe(false);
  });
});
it("returns a safe failure when the database is closed", async () => {
  const f = await fixture();
  const closed = createDatabase({
    ...options,
    databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
  });
  const port = createMatchProcessingPort(closed, f.config, f.users);
  await closed.disconnect();
  expect(await port.ready(f.ids[0], f.request(0))).toMatchObject({
    error: { code: "INTERNAL_ERROR" },
  });
});

it("returns bounded durable catch-up with safe per-player views, pinned versions and spectator downgrade", async () => {
  const f = await fixture();
  await f.active();
  const { createMatchResyncPort } = await import("../../src/matches/index.js");
  const resync = createMatchResyncPort(b, [createCoupMatchGame(rules)]);
  const request = { schemaVersion: 1, matchId: f.matchId };
  const one = await resync.catchup(f.ids[0], { ...request, afterSeq: 0 });
  expect(one).toMatchObject({
    ok: true,
    value: {
      mode: "EVENTS",
      snapshot: { stateVersion: 5, lastEventSeq: 7, role: "PLAYER", view: { viewerId: f.ids[0] } },
    },
  });
  if (!one.ok) throw new Error("Fixture unavailable");
  expect(one.value.events.map((e) => [e.seq, e.stateVersion])).toEqual([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 3],
    [5, 4],
    [6, 5],
    [7, 5],
  ]);
  expect(one.value.events.every((e) => Object.keys(e.payload).length === 0)).toBe(true);
  expect(JSON.stringify(one)).not.toMatch(/deck|influence|drawn|snapshot.*snapshot/);
  const other = await resync.snapshot(f.ids[1], request);
  expect(other).toMatchObject({ ok: true, value: { view: { viewerId: f.ids[1] } } });
  expect(await resync.snapshot(randomUUID(), request)).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  expect(await resync.catchup(f.ids[0], { ...request, afterSeq: 1000 })).toMatchObject({
    value: { mode: "SNAPSHOT", events: [] },
  });
  expect(await resync.catchup(f.ids[0], { ...request, afterSeq: 7 })).toMatchObject({
    value: { mode: "EVENTS", events: [] },
  });
  expect(await resync.catchup(f.ids[0], { ...request, afterSeq: -1 })).toMatchObject({
    error: { code: "INVALID_INPUT" },
  });
  expect(await createMatchResyncPort(b, []).snapshot(f.ids[0], request)).toMatchObject({
    error: { code: "INCOMPATIBLE_GAME_VERSION" },
  });
  await a.forModule("matches").execute((db) =>
    db.matchPlayer.update({
      where: { matchId_userId: { matchId: f.matchId, userId: f.ids[0]! } },
      data: { agentType: "BOT", replacedAt: new Date() },
    }),
  );
  const spectator = await resync.snapshot(f.ids[0], request);
  expect(spectator).toMatchObject({
    ok: true,
    value: { role: "SPECTATOR", view: { kind: "SPECTATOR" } },
  });
  expect(JSON.stringify(spectator)).not.toMatch(
    /myCards|exchangeChoices|legalCommands|deck|influence/,
  );
});
