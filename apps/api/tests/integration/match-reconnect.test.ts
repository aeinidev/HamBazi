import { fork } from "node:child_process";
import { once } from "node:events";
import { io } from "socket.io-client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDatabase } from "@hambazi/database";
import { coupModule, migrateCoupState, getCoupModuleSpectatorView } from "@hambazi/coup-engine";
import {
  createMatchAutomationPort,
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
import { createPresencePort } from "../../src/presence/index.js";
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

it("renews concurrent Presence heartbeats without views while retaining atomic lease and state guards", async () => {
  let allowProjection = true;
  const game = createCoupMatchGame(rules);
  const resync = createMatchResyncPort(a, [
    {
      ...game,
      project: (...args) => {
        if (!allowProjection) throw new Error("Discarded heartbeat projection");
        return game.project(...args);
      },
    },
  ]);
  const tables = [];
  for (let i = 0; i < 8; i++) {
    const f = await connected();
    const presence = createPresencePort({ reconnect: f.firstReconnect, resync });
    const sessions = Array.from({ length: 3 }, () =>
      presence.open({ userId: f.ids[0]!, sessionExpiresAt: 20000 }),
    );
    await Promise.all(sessions.map((session) => session.subscribe(f.matchId)));
    const before = await f.stored();
    tables.push({
      f,
      sessions,
      version: before.match.stateVersion,
      seq: before.match.lastEventSeq,
    });
  }
  allowProjection = false;
  await expect(
    a.forModule("matches").transaction((db) => db.lockMatchPresence(randomUUID())),
  ).resolves.toBeNull();
  const metadata = await Promise.all(
    tables.map(({ f }) =>
      b.forModule("matches").transaction((db) => db.lockMatchPresence(f.matchId)),
    ),
  );
  for (const [index, row] of metadata.entries()) {
    const { f, version, seq } = tables[index]!;
    const stored = await f.stored();
    expect(row).toEqual({
      id: f.matchId,
      status: "ACTIVE",
      stateVersion: version,
      lastEventSeq: seq,
      reconnectPolicyJsonb: stored.match.reconnectPolicyJsonb,
      startedAt: stored.match.startedAt,
    });
  }
  for (let wave = 0; wave < 4; wave++) {
    tables.forEach(({ f }) => f.at(2200 + wave * 200));
    await Promise.all(
      tables.flatMap(({ sessions }) => sessions.map((session) => session.heartbeat())),
    );
  }
  for (const { f, sessions, version, seq } of tables) {
    const after = await f.stored();
    expect(after.match.stateVersion).toBe(version);
    expect(after.match.lastEventSeq).toBe(seq);
    const leases = await a
      .forModule("matches")
      .execute((db) =>
        db.matchConnectionLease.findMany({ where: { matchId: f.matchId, userId: f.ids[0]! } }),
      );
    expect(leases.filter((lease) => lease.leaseUntil.getTime() === 3800)).toHaveLength(3);
    // A missing/expired lease still fails closed through the same durable renewal.
    f.at(4000);
    await expect(sessions[0]!.heartbeat()).rejects.toThrow("Presence lease unavailable");
    await Promise.all(sessions.map((session) => session.close()));
  }
});
it("registers 32 pre-activation Presence subscriptions with one guard projection and atomic leases", async () => {
  const game = createCoupMatchGame(rules);
  let projected = 0;
  const resync = createMatchResyncPort(a, [
    {
      ...game,
      project: (...args) => {
        projected++;
        return game.project(...args);
      },
    },
  ]);
  const tables = [];
  for (let i = 0; i < 8; i++) {
    const f = await fixture();
    const reconnect = createMatchReconnectPort(a, {
      clock: { nowMs: () => 2100 },
      policy: { schemaVersion: 1, leaseMs: 1000, graceMs: 2000, maxConnections: 4 },
    });
    const presence = createPresencePort({ reconnect, resync });
    const sessions = Array.from({ length: 4 }, () =>
      presence.open({ userId: f.ids[0]!, sessionExpiresAt: 20000 }),
    );
    await Promise.all(sessions.map((session) => session.subscribe(f.matchId)));
    expect(
      await a
        .forModule("matches")
        .execute((db) => db.matchConnectionLease.count({ where: { matchId: f.matchId } })),
    ).toBe(0);
    await f.active();
    tables.push({ f, sessions, before: await f.stored() });
  }
  try {
    projected = 0;
    await Promise.all(
      tables.flatMap(({ sessions }) => sessions.map((session) => session.heartbeat())),
    );
    expect(projected).toBe(32);
    for (const { f, before } of tables) {
      const after = await f.stored();
      expect(after.match.stateVersion).toBe(before.match.stateVersion + 4);
      expect(after.match.lastEventSeq).toBe(before.match.lastEventSeq + 4);
      expect(
        JSON.stringify(after.match.stateJsonb) === JSON.stringify(before.match.stateJsonb),
      ).toBe(true);
      const leases = await a
        .forModule("matches")
        .execute((db) => db.matchConnectionLease.findMany({ where: { matchId: f.matchId } }));
      expect(leases).toHaveLength(4);
      expect(
        leases.every((lease) => lease.closedAt === null && lease.leaseUntil.getTime() === 3100),
      ).toBe(true);
      expect(new Set(leases.map((lease) => lease.connectionId)).size).toBe(4);
    }
    projected = 0;
    await Promise.all(
      tables.flatMap(({ sessions }) => sessions.map((session) => session.heartbeat())),
    );
    expect(projected).toBe(0);
  } finally {
    await Promise.all(tables.flatMap(({ sessions }) => sessions.map((session) => session.close())));
  }
});

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

it.each(["BOT", "TIMER"] as const)(
  "persists a full automated %s game with replay and one finish outbox",
  async (kind) => {
    const f = await connected();
    const automation = createMatchAutomationPort(a, {
      clock: f.options.clock,
      games: f.config.games,
    });
    if (kind === "BOT") {
      f.at(10000);
      for (const playerId of f.ids) {
        const result = state(await f.firstReconnect.reconcile({ ...f.ref, playerId }));
        state(await f.firstReconnect.timeout(result.timeout));
      }
    }
    let steps = 0;
    while (steps++ < 500) {
      const planned = await automation.plan(f.matchId);
      if (!planned) break;
      const intent = planned.intent!;
      f.at(Math.max(10000, intent.deadlineAt));
      await automation.execute(intent);
      const before = await f.stored();
      await automation.execute(intent);
      expect(await f.stored()).toEqual(before);
    }
    const saved = await f.stored();
    expect(saved.match.status).toBe("FINISHED");
    expect(saved.outbox.filter((e) => e.type === "MATCH_FINISHED_V1")).toHaveLength(1);
    const initial = saved.events.find((e) => e.type === "MATCH_INITIALIZED_V1")!;
    const payload = initial.payloadJsonb as { snapshot: unknown };
    let replay = migrateCoupState(payload.snapshot, 4);
    for (const event of saved.events.filter((e) => e.type === "GAME_ENGINE_EVENT")) {
      const payload = event.payloadJsonb as { event: unknown };
      replay = coupModule.engine.applyEvent(replay, coupModule.schemas.event.parse(payload.event));
    }
    expect(replay).toEqual(saved.match.stateJsonb);
    expect(await automation.plan(f.matchId)).toBeNull();
  },
  15000,
);

it("fences automation against human commands and duplicate jobs across independent writers", async () => {
  const f = await connected();
  f.at(3000);
  const first = createMatchAutomationPort(a, { clock: f.options.clock, games: f.config.games });
  const second = createMatchAutomationPort(b, { clock: f.options.clock, games: f.config.games });
  const intent = (await first.plan(f.matchId))!.intent!;
  const before = await f.stored();
  const outcomes = await Promise.all([
    first.execute(intent),
    second.execute(intent),
    f.first.command(f.ids[0], {
      ...f.request(intent.expectedStateVersion),
      command: { type: "DECLARE_INCOME" },
    }),
  ]);
  expect(outcomes).toHaveLength(3);
  expect((await f.stored()).match.stateVersion).toBe(before.match.stateVersion + 1);
});
it("rejects stale bot epochs and keeps recovery output free of private state", async () => {
  const f = await connected();
  f.at(10000);
  for (const playerId of f.ids) {
    const gone = state(await f.firstReconnect.reconcile({ ...f.ref, playerId }));
    state(await f.firstReconnect.timeout(gone.timeout));
  }
  const port = createMatchAutomationPort(b, { clock: f.options.clock, games: f.config.games });
  await port.execute((await port.plan(f.matchId))!.intent);
  const plan = (await port.plan(f.matchId))!;
  expect(plan.intent!.kind).toBe("BOT");
  expect(JSON.stringify(plan)).not.toMatch(/myCards|deck|influence|command|token/);
  const before = await f.stored();
  await port.execute({ ...plan.intent, expectedConnectionEpoch: 999 });
  expect(await f.stored()).toEqual(before);
  let after: string | null = null;
  const seen = new Set<string>();
  do {
    const page = await port.recover({ schemaVersion: 1, after, limit: 2 });
    expect(page.matchIds.length).toBeLessThanOrEqual(2);
    for (const id of page.matchIds) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    after = page.next;
  } while (after !== null);
  expect(seen.has(f.matchId)).toBe(true);
});

it("keeps another node live after SIGKILL and recovers the last crashed node's original lease deadline", async () => {
  const f = await fixture();
  await f.active();
  const policy = { schemaVersion: 1 as const, leaseMs: 1500, graceMs: 1000, maxConnections: 4 };
  const children: ReturnType<typeof fork>[] = [];
  const clients: ReturnType<typeof io>[] = [];
  async function node() {
    const child = fork(new URL("../fixtures/presence-node.mjs", import.meta.url), [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    children.push(child);
    const ready = once(child, "message");
    child.send({
      userId: f.ids[0],
      sessionId: randomUUID(),
      token: "fixture-token",
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      policy,
      rules,
    });
    const [message] = (await ready) as [{ port: number }];
    if (!message.port) throw new Error("Presence child failed");
    const client = io(`http://127.0.0.1:${message.port}/v1`, {
      path: "/v1/socket.io",
      transports: ["websocket"],
      reconnection: false,
      auth: { schemaVersion: 1, accessToken: "fixture-token" },
    });
    clients.push(client);
    client.on("match:snapshot", (snapshot: { lastEventSeq: number }, ack: (seq: number) => void) =>
      ack(snapshot.lastEventSeq),
    );
    await new Promise<void>((resolve, reject) => {
      client.once("connect", () => resolve());
      client.once("connect_error", reject);
    });
    const result: unknown = await client
      .timeout(2000)
      .emitWithAck("match:subscribe", { schemaVersion: 1, matchId: f.matchId });
    expect(result).toMatchObject({ ok: true });
    return child;
  }
  try {
    const first = await node();
    const second = await node();
    const ended = once(first, "exit");
    first.kill("SIGKILL");
    await ended;
    await new Promise((resolve) => setTimeout(resolve, 1700));
    const realtime = createMatchReconnectPort(a, { clock: { nowMs: () => Date.now() }, policy });
    const ref = { schemaVersion: 1, matchId: f.matchId, playerId: f.ids[0] };
    expect(state(await realtime.reconcile(ref)).status).toBe("CONNECTED");
    const endedSecond = once(second, "exit");
    second.kill("SIGKILL");
    await endedSecond;
    const leases = await a
      .forModule("matches")
      .execute((db) => db.matchConnectionLease.findMany({ where: { matchId: f.matchId } }));
    expect(leases).toHaveLength(2);
    expect(leases.every((x) => x.closedAt === null)).toBe(true);
    const expiry = Math.max(...leases.map((x) => x.leaseUntil.getTime()));
    const recovered = createMatchReconnectPort(b, {
      clock: { nowMs: () => expiry + policy.graceMs + 1 },
      policy,
    });
    const gone = state(await recovered.reconcile(ref));
    expect(gone.timeout!.deadlineAt).toBe(expiry + policy.graceMs);
    state(await recovered.timeout(gone.timeout));
    const snapshot = await createMatchResyncPort(
      a,
      f.config.games as ReturnType<typeof createCoupMatchGame>[],
    ).snapshot(f.ids[0], { schemaVersion: 1, matchId: f.matchId });
    expect(snapshot).toMatchObject({ ok: true, value: { role: "SPECTATOR" } });
  } finally {
    for (const client of clients) client.disconnect();
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        const ended = once(child, "exit");
        child.kill("SIGKILL");
        await ended;
      }
  }
}, 15000);

it("preserves incompatible-adapter faults and rejects invalid recovery or job authority", async () => {
  const f = await connected();
  const port = createMatchAutomationPort(a, { clock: f.options.clock, games: [] });
  await expect(port.plan(f.matchId)).rejects.toMatchObject({ code: "INCOMPATIBLE_GAME_VERSION" });
  await expect(port.recover({ schemaVersion: 1, after: null, limit: 101 })).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  await expect(
    port.execute({ schemaVersion: 1, matchId: f.matchId, kind: "BOT", playerId: null }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
});
