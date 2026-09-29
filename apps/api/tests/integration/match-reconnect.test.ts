import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDatabase } from "@hambazi/database";
import { migrateCoupState, getCoupModuleSpectatorView } from "@hambazi/coup-engine";
import {
  createMatchProcessingPort,
  createMatchReconnectPort,
  createMatchResyncPort,
  type ReconnectOutcome,
  type ReconnectResult,
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
let seq = 16000000;
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
    }));
  }
  return { ids, matchId, first, second, config, users, request, active, stored };
}

function state(result: ReconnectOutcome): ReconnectResult {
  if (!result.ok) throw new Error(`Reconnect fixture: ${result.error.code}`);
  return result.value;
}
async function connected() {
  const f = await fixture();
  await f.active();
  let now = 2100;
  const policy = { schemaVersion: 1 as const, leaseMs: 1000, graceMs: 2000, maxConnections: 4 };
  const options = { clock: { nowMs: () => now }, policy };
  const first = createMatchReconnectPort(a, options);
  const second = createMatchReconnectPort(b, options);
  const ref = { schemaVersion: 1 as const, matchId: f.matchId, playerId: f.ids[0]! };
  const input = (connectionId = randomUUID()) => ({
    ...ref,
    connectionId,
    sessionExpiresAt: 20000,
  });
  const one = input();
  const opened = state(await first.connect(one));
  return {
    ...f,
    ref,
    one,
    input,
    opened,
    firstReconnect: first,
    secondReconnect: second,
    options,
    at: (time: number) => {
      now = time;
    },
  };
}
it("keeps a seat live across nodes until the last socket closes; duplicate close preserves grace", async () => {
  const f = await connected();
  const two = f.input();
  state(await f.secondReconnect.connect(two));
  f.at(2200);
  expect(
    state(await f.firstReconnect.disconnect({ ...f.ref, connectionId: f.one.connectionId })),
  ).toMatchObject({ status: "CONNECTED", timeout: null, changed: false });
  f.at(2300);
  const closed = state(
    await f.secondReconnect.disconnect({ ...f.ref, connectionId: two.connectionId }),
  );
  expect(closed).toMatchObject({
    status: "DISCONNECTED",
    timeout: { deadlineAt: 4300 },
    changed: true,
  });
  f.at(3000);
  expect(
    state(await f.firstReconnect.disconnect({ ...f.ref, connectionId: two.connectionId })),
  ).toMatchObject({
    changed: false,
    stateVersion: closed.stateVersion,
    timeout: { deadlineAt: 4300 },
  });
});
it("renews without gameplay conflicts and never renews on duplicate connect", async () => {
  const f = await connected();
  f.at(2400);
  expect(state(await f.secondReconnect.connect(f.one))).toMatchObject({
    changed: false,
    stateVersion: f.opened.stateVersion,
  });
  const get = () =>
    a.forModule("matches").execute((db) =>
      db.matchConnectionLease.findUniqueOrThrow({
        where: { matchId_connectionId: { matchId: f.matchId, connectionId: f.one.connectionId } },
      }),
    );
  expect((await get()).leaseUntil.getTime()).toBe(3100);
  expect(state(await f.firstReconnect.renew(f.one))).toMatchObject({
    changed: false,
    stateVersion: f.opened.stateVersion,
  });
  expect((await get()).leaseUntil.getTime()).toBe(3400);
});
it("uses original lease expiry after a crashed node, including late reconciliation and reconstruction", async () => {
  const f = await connected();
  f.at(9000);
  const rebuilt = createMatchReconnectPort(b, f.options);
  const result = state(await rebuilt.reconcile(f.ref));
  expect(result).toMatchObject({ status: "DISCONNECTED", timeout: { deadlineAt: 5100 } });
  expect(state(await rebuilt.timeout(result.timeout))).toMatchObject({
    changed: true,
    role: "SPECTATOR",
  });
});
it("bounds leases by session expiry and rejects expired, closed, missing and foreign renewals", async () => {
  const f = await connected();
  const short = { ...f.input(), sessionExpiresAt: 2500 };
  state(await f.firstReconnect.connect(short));
  const lease = await a.forModule("matches").execute((db) =>
    db.matchConnectionLease.findUniqueOrThrow({
      where: { matchId_connectionId: { matchId: f.matchId, connectionId: short.connectionId } },
    }),
  );
  expect(lease.leaseUntil.getTime()).toBe(2500);
  expect(await f.firstReconnect.renew(f.input())).toMatchObject({
    error: { code: "GAME_STATE_CONFLICT" },
  });
  expect(await f.firstReconnect.renew({ ...f.one, playerId: f.ids[1] })).toMatchObject({
    error: { code: "FORBIDDEN" },
  });
  expect(await f.firstReconnect.connect({ ...f.one, sessionExpiresAt: 19000 })).toMatchObject({
    error: { code: "FORBIDDEN" },
  });
  f.at(2500);
  expect(await f.firstReconnect.renew(short)).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  f.at(3100);
  expect(await f.firstReconnect.renew(f.one)).toMatchObject({
    error: { code: "GAME_STATE_CONFLICT" },
  });
  expect(await f.firstReconnect.connect(f.one)).toMatchObject({
    error: { code: "GAME_STATE_CONFLICT" },
  });
});
it("stale and early jobs are no-ops; reconnect advances epoch and cancels grace durably", async () => {
  const f = await connected();
  f.at(2200);
  const disconnected = state(
    await f.firstReconnect.disconnect({ ...f.ref, connectionId: f.one.connectionId }),
  );
  const job = disconnected.timeout!;
  expect(state(await f.secondReconnect.timeout(job)).changed).toBe(false);
  f.at(4200);
  const newer = state(await f.secondReconnect.connect(f.input()));
  expect(newer.connectionEpoch).toBeGreaterThan(job.expectedConnectionEpoch);
  expect(newer.timeout).toBeNull();
  const before = await f.stored();
  expect(state(await f.firstReconnect.timeout(job)).changed).toBe(false);
  expect(await f.stored()).toEqual(before);
});
it("a gameplay version change invalidates the old job without extending the disconnect deadline", async () => {
  const f = await connected();
  f.at(2200);
  const disconnected = state(
    await f.firstReconnect.disconnect({ ...f.ref, connectionId: f.one.connectionId }),
  );
  const game = await f.first.command(f.ids[0], {
    ...f.request(disconnected.stateVersion),
    command: { type: "DECLARE_INCOME" },
  });
  value(game);
  f.at(4200);
  expect(state(await f.secondReconnect.timeout(disconnected.timeout)).changed).toBe(false);
  const fresh = state(await f.firstReconnect.reconcile(f.ref));
  expect(fresh.timeout!.deadlineAt).toBe(disconnected.timeout!.deadlineAt);
  expect(fresh.timeout!.expectedStateVersion).toBe(value(game).stateVersion);
  expect(state(await f.secondReconnect.timeout(fresh.timeout))).toMatchObject({
    changed: true,
    role: "SPECTATOR",
  });
});
it("concurrent duplicate connects and takeovers apply once and keep all writes atomic", async () => {
  const f = await connected();
  const two = f.input();
  const opened = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? f.firstReconnect : f.secondReconnect).connect(two),
    ),
  );
  expect(opened.map(state).filter((x) => x.changed)).toHaveLength(1);
  f.at(3100);
  const expired = state(await f.firstReconnect.reconcile(f.ref));
  f.at(5100);
  const before = await f.stored();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? f.firstReconnect : f.secondReconnect).timeout(expired.timeout),
    ),
  );
  expect(results.map(state).filter((x) => x.changed)).toHaveLength(1);
  const after = await f.stored();
  expect(after.match.stateVersion).toBe(before.match.stateVersion + 1);
  expect(after.events.length).toBe(before.events.length + 1);
  expect(after.commands.length).toBe(before.commands.length + 1);
  expect(after.outbox.length).toBe(before.outbox.length + 1);
  expect(after.match.stateJsonb).toEqual(before.match.stateJsonb);
});
it("reconnect-vs-timeout has one winner across independent PostgreSQL clients", async () => {
  for (let i = 0; i < 12; i++) {
    const f = await connected();
    f.at(2200);
    const gone = state(
      await f.firstReconnect.disconnect({ ...f.ref, connectionId: f.one.connectionId }),
    );
    f.at(4200);
    const [back, timeout] = await Promise.all([
      f.secondReconnect.connect(f.input()),
      f.firstReconnect.timeout(gone.timeout),
    ]);
    const r = state(back);
    const t = state(timeout);
    expect(Number(r.changed) + Number(t.changed)).toBe(1);
    if (t.changed) expect(r.role).toBe("SPECTATOR");
    else expect(r).toMatchObject({ role: "PLAYER", status: "CONNECTED", timeout: null });
  }
});
it("irreversibly rejects human commands/renewals and projects only spectator data after takeover", async () => {
  const f = await connected();
  f.at(3100);
  const gone = state(await f.firstReconnect.reconcile(f.ref));
  f.at(5100);
  const bot = state(await f.secondReconnect.timeout(gone.timeout));
  const before = await f.stored();
  expect(state(await f.firstReconnect.connect(f.input()))).toMatchObject({
    changed: false,
    role: "SPECTATOR",
  });
  expect(state(await f.firstReconnect.renew(f.one))).toMatchObject({
    changed: false,
    role: "SPECTATOR",
  });
  expect(
    await f.first.command(f.ids[0], {
      ...f.request(bot.stateVersion),
      command: { type: "DECLARE_INCOME" },
    }),
  ).toMatchObject({ error: { code: "FORBIDDEN" } });
  const resync = createMatchResyncPort(a, [createCoupMatchGame(rules)]);
  const snapshot = await resync.snapshot(f.ids[0], { schemaVersion: 1, matchId: f.matchId });
  expect(snapshot).toMatchObject({ ok: true, value: { role: "SPECTATOR" } });
  if (!snapshot.ok) throw new Error("Snapshot failed");
  expect(snapshot.value.view).toEqual(
    getCoupModuleSpectatorView(migrateCoupState(before.match.stateJsonb, 4)),
  );
  expect(snapshot.value.view).not.toHaveProperty("legalCommands");
  const catchup = await resync.catchup(f.ids[0], {
    schemaVersion: 1,
    matchId: f.matchId,
    afterSeq: 0,
  });
  expect(catchup).toMatchObject({
    ok: true,
    value: { mode: "EVENTS", snapshot: { role: "SPECTATOR" } },
  });
  expect(JSON.stringify(catchup)).not.toContain("connectionId");
  expect(await f.stored()).toEqual(before);
  const internal = migrateCoupState(before.match.stateJsonb, 4);
  expect(internal.deadlineAt).toBe(2000 + rules.actionTimeoutMs);
});
it("caps simultaneous sockets using the pinned policy, and rejects unknown members", async () => {
  const f = await connected();
  for (let i = 0; i < 3; i++) state(await f.firstReconnect.connect(f.input()));
  expect(await f.secondReconnect.connect(f.input())).toMatchObject({
    error: { code: "GAME_STATE_CONFLICT" },
  });
  const modified = createMatchReconnectPort(b, {
    ...f.options,
    policy: { ...f.options.policy, maxConnections: 32 },
  });
  expect(await modified.connect(f.input())).toMatchObject({
    error: { code: "GAME_STATE_CONFLICT" },
  });
  expect(await modified.connect({ ...f.input(), playerId: randomUUID() })).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
});
it("never-connected active seats use activation time and terminal matches never take over", async () => {
  const f = await connected();
  f.at(10000);
  const other = { ...f.ref, playerId: f.ids[1] };
  const gone = state(await f.firstReconnect.reconcile(other));
  expect(gone.timeout!.deadlineAt).toBe(4000);
  value(await f.first.lifecycle({ ...f.request(gone.stateVersion), operation: "TERMINATE" }));
  const before = await f.stored();
  expect(state(await f.secondReconnect.timeout(gone.timeout))).toMatchObject({
    changed: false,
    timeout: null,
  });
  expect(await f.stored()).toEqual(before);
});

it("rolls back lease, seat, event, checkpoint and policy writes when outbox insertion fails", async () => {
  const f = await connected();
  const scope = a.forModule("matches");
  const broken = {
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
                  return () => {
                    throw new Error("synthetic outbox failure");
                  };
                return Reflect.get(target, key);
              },
            }),
          }),
        ),
    }),
  } as typeof a;
  const port = createMatchReconnectPort(broken, f.options);
  const input = f.input();
  const before = await f.stored();
  expect(await port.connect(input)).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  expect(await f.stored()).toEqual(before);
  expect(
    await a.forModule("matches").execute((db) =>
      db.matchConnectionLease.findUnique({
        where: { matchId_connectionId: { matchId: f.matchId, connectionId: input.connectionId } },
      }),
    ),
  ).toBeNull();
  state(await f.firstReconnect.connect(input));
  f.at(3100);
  const gone = state(await f.firstReconnect.reconcile(f.ref));
  f.at(5100);
  const disconnected = await f.stored();
  expect(await port.timeout(gone.timeout)).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  expect(await f.stored()).toEqual(disconnected);
  expect(state(await f.secondReconnect.timeout(gone.timeout)).changed).toBe(true);
});
it("closed lease identities cannot be resurrected or changed, even by delayed database writes", async () => {
  const f = await connected();
  state(await f.firstReconnect.disconnect({ ...f.ref, connectionId: f.one.connectionId }));
  expect(await f.secondReconnect.connect(f.one)).toMatchObject({
    error: { code: "GAME_STATE_CONFLICT" },
  });
  await expect(
    a.forModule("matches").execute((db) =>
      db.matchConnectionLease.update({
        where: { matchId_connectionId: { matchId: f.matchId, connectionId: f.one.connectionId } },
        data: { closedAt: null },
      }),
    ),
  ).rejects.toThrow();
  await expect(
    a.forModule("matches").execute((db) =>
      db.match.update({
        where: { id: f.matchId },
        data: { reconnectPolicyJsonb: { ...f.options.policy, graceMs: 999 } },
      }),
    ),
  ).rejects.toThrow();
});
it("fails closed when durable storage is unavailable without leaking diagnostics", async () => {
  const closed = createDatabase({
    ...options,
    databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
  });
  await closed.disconnect();
  const port = createMatchReconnectPort(closed, {
    clock: { nowMs: () => 2000 },
    policy: {
      schemaVersion: 1,
      leaseMs: 1000,
      graceMs: 2000,
      maxConnections: 4,
    },
  });
  expect(
    await port.reconcile({ schemaVersion: 1, matchId: randomUUID(), playerId: randomUUID() }),
  ).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
});

it("allows Worker reconciliation/takeover but denies lease creation, renewal and deletion", async () => {
  const f = await connected();
  const worker = createDatabase({
    ...options,
    databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
  });
  try {
    await worker.connect();
    const scope = worker.forModule("matches");
    expect(
      await scope.execute((db) => db.matchConnectionLease.count({ where: { matchId: f.matchId } })),
    ).toBe(1);
    await expect(
      scope.execute((db) =>
        db.matchConnectionLease.create({
          data: {
            matchId: f.matchId,
            userId: f.ref.playerId,
            connectionId: randomUUID(),
            sessionExpiresAt: new Date(20000),
            leaseUntil: new Date(3100),
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      scope.execute((db) =>
        db.matchConnectionLease.update({
          where: { matchId_connectionId: { matchId: f.matchId, connectionId: f.one.connectionId } },
          data: { leaseUntil: new Date(3500) },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      scope.execute((db) => db.matchConnectionLease.deleteMany({ where: { matchId: f.matchId } })),
    ).rejects.toThrow();
    await expect(
      a
        .forModule("matches")
        .execute((db) => db.matchConnectionLease.deleteMany({ where: { matchId: f.matchId } })),
    ).rejects.toThrow();
    const port = createMatchReconnectPort(worker, f.options);
    f.at(3100);
    const gone = state(await port.reconcile(f.ref));
    f.at(5100);
    const correlation = {
      requestId: randomUUID(),
      traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
    };
    state(await port.timeout(gone.timeout, correlation));
    const saved = await f.stored();
    expect(saved.outbox.find((x) => x.requestId === correlation.requestId)).toMatchObject(
      correlation,
    );
  } finally {
    await worker.disconnect();
  }
});
