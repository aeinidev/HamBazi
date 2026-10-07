import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDatabase, DatabaseError } from "@hambazi/database";
import { createCorrelation, withCorrelation } from "@hambazi/observability";
import { migrateCoupState } from "@hambazi/coup-engine";
import { createRoomsPort } from "../../src/rooms/index.js";
import { createAccountCreationPort, createUserIdentityPort } from "../../src/users/index.js";
import { createCatalogPort, type CatalogPort } from "../../src/games/index.js";
import {
  createPrivateRoomMatchPort,
  createMatchProcessingPort,
  createMatchMembershipPort,
  createMatchResyncPort,
} from "../../src/matches/index.js";
import { createCoupMatchGame } from "../../src/composition/coup-match.js";
import { createRealtimeGateway } from "../../src/realtime/index.js";
import { realtimeDependencies } from "../fixtures/realtime.js";
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
// An isolated eligibility port registers the real pinned adapter; production Games stay disabled.
const games: CatalogPort = {
  list: async () => ({ ok: true, games: [] }),
  find: async () => ({
    ok: true,
    game: {
      id: "coup",
      slug: "coup",
      title: "Coup",
      minPlayers: 2,
      maxPlayers: 6,
      status: "ACTIVE",
      playable: true,
      privateRoomsEnabled: true,
      matchmakingEnabled: false,
      chatEnabled: false,
      voiceEnabled: false,
      readiness: "NOT_IMPLEMENTED",
      descriptor: null,
    },
  }),
};
let telegramId = 23000000;
async function fixture() {
  const users: string[] = [];
  for (let seat = 0; seat < 2; seat++) {
    const result = await createAccountCreationPort(a).createForVerifiedTelegramIdentity(
      String(++telegramId),
      "Private start test",
    );
    if (!result.ok) throw new Error("Account fixture failed");
    users.push(result.account.userId);
  }
  const clock = { nowMs: () => 2000000 };
  const game = createCoupMatchGame(rules);
  function roomPort(db = a) {
    return createRoomsPort(
      db,
      { clock, ttlSeconds: 900 },
      {
        users: createUserIdentityPort(db),
        games,
        invites: {
          target: { botUsername: "HamBaziBot", appName: "play" },
          consume: async () => ({ allowed: true }),
        },
      },
    );
  }
  const rooms = roomPort(),
    secondRooms = roomPort(b);
  const created = await rooms.create(users[0], {
    schemaVersion: 1,
    commandId: randomUUID(),
    gameId: "coup",
    capacity: 2,
  });
  if (!created.ok) throw new Error("Room fixture failed");
  const roomId = created.roomId;
  const invite = await rooms.shareInvite(users[0], roomId);
  if (!invite.ok) throw new Error("Invite fixture failed");
  const joined = await secondRooms.join(users[1], {
    schemaVersion: 1,
    commandId: randomUUID(),
    roomId,
    expectedVersion: 0,
    inviteCode: invite.invite.startParam.slice(5),
  });
  if (!joined.ok) throw new Error("Join fixture failed");
  const processing = createMatchProcessingPort(
    a,
    { clock, games: [game] },
    createUserIdentityPort(a),
  );
  function build(
    db = a,
    selectedRooms = rooms,
    selectedProcessing = processing,
    selectedGames = games,
    descriptor = async () => ({
      engineVersion: game.descriptor.engineVersion,
      stateSchemaVersion: game.descriptor.stateSchemaVersion,
      rulesetVersion: game.descriptor.rulesetVersion,
    }),
  ) {
    return createPrivateRoomMatchPort(
      db,
      { clock },
      {
        rooms: selectedRooms,
        processing: selectedProcessing,
        users: createUserIdentityPort(db),
        games: selectedGames,
        descriptor,
      },
    );
  }
  const start = { schemaVersion: 1, commandId: randomUUID(), roomId, expectedVersion: 1 };
  async function stored() {
    return a.forModule("matches").execute(async (db) => {
      const match = await db.match.findUnique({ where: { roomId } });
      return {
        match,
        players: match
          ? await db.matchPlayer.findMany({
              where: { matchId: match.id },
              orderBy: { seat: "asc" },
            })
          : [],
        events: match
          ? await db.gameEvent.findMany({ where: { matchId: match.id }, orderBy: { seq: "asc" } })
          : [],
        commands: match
          ? await db.processedCommand.findMany({
              where: { matchId: match.id },
              orderBy: { actionId: "asc" },
            })
          : [],
        outbox: match
          ? await db.outboxEvent.findMany({
              where: { aggregateId: match.id },
              orderBy: { id: "asc" },
            })
          : [],
        result: match ? await db.matchResult.findUnique({ where: { matchId: match.id } }) : null,
      };
    });
  }
  function request(matchId: string, expectedVersion: number) {
    return { schemaVersion: 1, actionId: randomUUID(), matchId, expectedVersion };
  }
  async function active(port = build()) {
    expect((await port.start(users[0], start)).ok).toBe(true);
    const matchId = (await stored()).match!.id;
    expect((await port.ready(users[0], request(matchId, 1))).ok).toBe(true);
    expect((await port.ready(users[1], request(matchId, 2))).ok).toBe(true);
    expect((await stored()).match!.status).toBe("ACTIVE");
    return matchId;
  }
  return {
    users,
    clock,
    game,
    roomId,
    rooms,
    secondRooms,
    processing,
    build,
    start,
    stored,
    request,
    active,
  };
}

it("recovers eight active private Matches concurrently without duplicate Room reads or durable effects", async () => {
  const tables = [];
  for (let index = 0; index < 8; index++) {
    const f = await fixture();
    const matchId = await f.active();
    const before = await f.stored();
    const startSnapshot = vi.fn(f.rooms.startSnapshot);
    const port = f.build(a, { ...f.rooms, startSnapshot });
    tables.push({ f, matchId, before, startSnapshot, port });
  }
  await Promise.all(
    tables.map(async ({ f, matchId, startSnapshot, port }) => {
      for (let wave = 0; wave < 16; wave++)
        expect(await port.resume(f.roomId)).toEqual({ ok: true, matchId });
      expect(startSnapshot).toHaveBeenCalledTimes(16);
    }),
  );
  for (const { f, before } of tables) expect(await f.stored()).toEqual(before);
});

it("races private starts across two processes with one durable Match/roster and original acknowledgements", async () => {
  const f = await fixture(),
    first = f.build(),
    second = f.build(b, f.secondRooms);
  const context = createCorrelation();
  const results = await withCorrelation(context, () =>
    Promise.all(
      Array.from({ length: 6 }, (_, i) => (i % 2 ? first : second).start(f.users[0], f.start)),
    ),
  );
  // Bounded transaction contention may require a retry; it must preserve the
  // original intent, never replace the Match or return a new acknowledgement.
  const settled = [];
  for (const result of results)
    settled.push(result.ok ? result : await second.start(f.users[0], f.start));
  expect(settled.every((result) => result.ok)).toBe(true);
  for (const result of settled) expect(result).toEqual(settled[0]);
  const saved = await f.stored();
  expect(saved.match).toMatchObject({
    roomId: f.roomId,
    roomStartVersion: 2,
    matchType: "PRIVATE_ROOM",
    status: "WAITING_FOR_PLAYERS",
    stateVersion: 1,
    engineVersion: "coup-v1",
    stateSchemaVersion: 4,
    rulesetVersion: rules.rulesetVersion,
  });
  expect(saved.players.map((p) => [p.userId, p.seat])).toEqual(
    f.users.map((id, seat) => [id, seat]),
  );
  expect(saved.commands).toHaveLength(1);
  expect(saved.outbox).toHaveLength(2);
  expect(
    saved.outbox.every(
      (event) => event.requestId === context.requestId && event.traceparent === context.traceparent,
    ),
  ).toBe(true);
  expect(JSON.stringify(saved.outbox)).not.toMatch(/invite|players|deck|cards|initData|token/);
  expect(await f.rooms.read(f.users[1], f.roomId)).toMatchObject({
    room: {
      status: "STARTED",
      version: 3,
      startedMatchId: saved.match!.id,
    },
  });
  const same = await f.build(b, f.secondRooms).start(f.users[0], f.start);
  expect(same).toEqual(settled[0]);
  expect(await f.stored()).toEqual(saved);
});

it.each(["match", "matchPlayer", "outboxEvent"] as const)(
  "rolls back a failure at private creation %s and recovers a frozen room",
  async (delegate) => {
    const f = await fixture();
    const scope = a.forModule("matches");
    let injected = false;
    const broken = {
      ...a,
      forModule: (owner: Parameters<typeof a.forModule>[0]) =>
        owner !== "matches"
          ? a.forModule(owner)
          : {
              ...scope,
              transaction: (
                operation: Parameters<typeof scope.transaction>[0],
                isolation?: "Serializable",
              ) =>
                scope.transaction(
                  (db) =>
                    operation({
                      ...db,
                      [delegate]: new Proxy(db[delegate], {
                        get(target, key) {
                          if (key === "create")
                            return () => {
                              injected = true;
                              throw new Error("synthetic private failure");
                            };
                          return Reflect.get(target, key);
                        },
                      }),
                    }),
                  isolation,
                ),
            },
    } as typeof a;
    expect(await f.build(broken).start(f.users[0], f.start)).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
    expect(injected).toBe(true);
    expect((await f.stored()).match).toBeNull();
    expect(await f.rooms.read(f.users[0], f.roomId)).toMatchObject({
      room: { status: "STARTING", version: 2 },
    });
    const recovery = await f.build(b, f.secondRooms).resume(f.roomId);
    expect(recovery.ok).toBe(true);
    expect(await f.build().start(f.users[0], f.start)).toMatchObject({
      ok: true,
      appliedVersion: 2,
    });
    expect((await f.stored()).players).toHaveLength(2);
  },
);

it("reconciles an unknown creation commit without repinning or duplicating the Match", async () => {
  const f = await fixture(),
    scope = a.forModule("matches");
  let lost = false;
  const ambiguous = {
    ...a,
    forModule: (owner: Parameters<typeof a.forModule>[0]) =>
      owner !== "matches"
        ? a.forModule(owner)
        : {
            ...scope,
            transaction: async (
              operation: Parameters<typeof scope.transaction>[0],
              isolation?: "Serializable",
            ) => {
              let inserted = false;
              const result = await scope.transaction(
                (db) =>
                  operation({
                    ...db,
                    match: new Proxy(db.match, {
                      get(target, key) {
                        if (key === "create")
                          return (input: Parameters<typeof target.create>[0]) => {
                            inserted = true;
                            return target.create(input);
                          };
                        return Reflect.get(target, key);
                      },
                    }),
                  }),
                isolation,
              );
              if (inserted && !lost) {
                lost = true;
                throw new DatabaseError();
              }
              return result;
            },
          },
  } as typeof a;
  expect(await f.build(ambiguous).start(f.users[0], f.start)).toMatchObject({
    error: { code: "INTERNAL_ERROR" },
  });
  const created = (await f.stored()).match!;
  expect(lost).toBe(true);
  expect(created.status).toBe("CREATED");
  const descriptor = vi.fn(async () => {
    throw new Error("new configuration must not repin");
  });
  expect(
    await f
      .build(b, f.secondRooms, f.processing, createCatalogPort(b), descriptor)
      .resume(f.roomId),
  ).toEqual({ ok: true, matchId: created.id });
  const recovered = (await f.stored()).match!;
  expect(recovered.id).toBe(created.id);
  expect(recovered.rulesetVersion).toBe(created.rulesetVersion);
  expect(descriptor).not.toHaveBeenCalled();
});

it("recovers failures after WAIT, confirmation, READY and START while preserving every committed receipt", async () => {
  const f = await fixture();
  const confirm = vi.fn(f.rooms.confirmStarted);
  confirm.mockResolvedValueOnce({
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Operation failed", retryable: false },
  });
  const port = f.build(a, { ...f.rooms, confirmStarted: confirm });
  expect(await port.start(f.users[0], f.start)).toMatchObject({
    error: { code: "INTERNAL_ERROR" },
  });
  expect((await f.stored()).match!.status).toBe("WAITING_FOR_PLAYERS");
  const normal = f.build(b, f.secondRooms);
  expect((await normal.resume(f.roomId)).ok).toBe(true);
  const matchId = (await f.stored()).match!.id;
  expect((await normal.ready(f.users[0], f.request(matchId, 1))).ok).toBe(true);
  const finalReady = f.request(matchId, 2);
  const lifecycle = vi.fn(f.processing.lifecycle);
  lifecycle.mockResolvedValueOnce({
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Operation failed", retryable: false },
  });
  expect(
    await f.build(a, f.rooms, { ...f.processing, lifecycle }).ready(f.users[1], finalReady),
  ).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  expect((await f.stored()).match!.status).toBe("READY");
  const startOnly = vi.fn(f.processing.lifecycle);
  startOnly.mockImplementation(async (input, context) =>
    (input as { operation: string }).operation === "ACTIVATE"
      ? {
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "Operation failed", retryable: false },
        }
      : f.processing.lifecycle(input, context),
  );
  expect(
    await f.build(a, f.rooms, { ...f.processing, lifecycle: startOnly }).resume(f.roomId),
  ).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  expect((await f.stored()).match!.status).toBe("STARTING");
  const retry = await normal.ready(f.users[1], finalReady);
  expect(retry).toMatchObject({ ok: true, value: { status: "READY", stateVersion: 3 } });
  const saved = await f.stored();
  expect(saved.match!.status).toBe("ACTIVE");
  expect(saved.match!.stateVersion).toBe(5);
  expect(saved.commands).toHaveLength(5);
  expect(saved.events.filter((event) => event.type === "MATCH_INITIALIZED_V1")).toHaveLength(1);
  expect((await normal.recover({ schemaVersion: 1, limit: 50 })).ok).toBe(true);
  expect(await f.stored()).toEqual(saved);
});

it("guards unauthorized/stale starts and unavailable descriptors before freezing a new roster", async () => {
  const f = await fixture(),
    port = f.build();
  expect(await port.start(f.users[1], f.start)).toMatchObject({ error: { code: "FORBIDDEN" } });
  expect(await port.start(randomUUID(), f.start)).toMatchObject({
    error: { code: "UNAUTHENTICATED" },
  });
  expect(await port.start(f.users[0], { ...f.start, expectedVersion: 0 })).toMatchObject({
    error: { code: "ROOM_CONFLICT" },
  });
  for (const field of ["players", "descriptor", "matchId", "userId"])
    expect(await port.start(f.users[0], { ...f.start, [field]: "forged" })).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  const absent = vi.fn(async () => null);
  expect(
    await f.build(a, f.rooms, f.processing, games, absent as never).start(f.users[0], f.start),
  ).toMatchObject({ error: { code: "INCOMPATIBLE_GAME_VERSION" } });
  expect((await f.stored()).match).toBeNull();
  expect(await f.rooms.read(f.users[0], f.roomId)).toMatchObject({
    room: { status: "FULL", version: 1 },
  });
  expect(
    await f.build(a, f.rooms, f.processing, createCatalogPort(a)).start(f.users[0], f.start),
  ).toMatchObject({ error: { code: "GAME_UNAVAILABLE" } });
});

it("serializes start against departure and never commits a Match from a partial roster", async () => {
  const f = await fixture();
  const results = await Promise.all([
    f.build().start(f.users[0], f.start),
    f.secondRooms.leave(f.users[1], { ...f.start, commandId: randomUUID() }),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  const saved = await f.stored();
  const read = await f.rooms.read(f.users[0], f.roomId);
  if (!read.ok) throw new Error("Room fixture failed");
  if (read.room.status === "WAITING") {
    expect(saved.match).toBeNull();
    expect(read.room.members).toHaveLength(1);
  } else {
    expect(read.room.status).toBe("STARTED");
    expect(saved.players).toHaveLength(2);
  }
});

it("deduplicates concurrent final readiness and activation across reconstructed coordinators", async () => {
  const f = await fixture(),
    first = f.build(),
    second = f.build(b, f.secondRooms);
  expect((await first.start(f.users[0], f.start)).ok).toBe(true);
  const matchId = (await f.stored()).match!.id;
  expect((await first.ready(f.users[0], f.request(matchId, 1))).ok).toBe(true);
  const input = f.request(matchId, 2);
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) => (i % 2 ? first : second).ready(f.users[1], input)),
  );
  for (const result of results) expect(result).toEqual(results[0]);
  expect(results[0]).toMatchObject({ ok: true, value: { status: "READY", stateVersion: 3 } });
  const saved = await f.stored();
  expect(saved.match!.status).toBe("ACTIVE");
  expect(saved.commands).toHaveLength(5);
  expect(saved.events.filter((event) => event.type === "MATCH_INITIALIZED_V1")).toHaveLength(1);
});

it("recovers frozen rooms in bounded pages and closes a trusted terminated Match without requiring a player retry", async () => {
  const fixtures = [await fixture(), await fixture(), await fixture()];
  for (const f of fixtures) expect((await f.rooms.start(f.users[0], f.start)).ok).toBe(true);
  const port = fixtures[0]!.build();
  let afterRoomId: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 100; page++) {
    const result = await port.recover({
      schemaVersion: 1,
      limit: 2,
      ...(afterRoomId ? { afterRoomId } : {}),
    });
    if (!result.ok) throw new Error("Recovery fixture failed");
    expect(result.results.length).toBeLessThanOrEqual(2);
    for (const entry of result.results) {
      expect(entry.ok).toBe(true);
      expect(seen.has(entry.roomId)).toBe(false);
      seen.add(entry.roomId);
    }
    if (result.nextRoomId === null) break;
    afterRoomId = result.nextRoomId;
  }
  for (const f of fixtures) expect(seen.has(f.roomId)).toBe(true);
  const f = fixtures[1]!,
    match = (await f.stored()).match!;
  expect(
    (
      await f.processing.lifecycle({
        ...f.request(match.id, match.stateVersion),
        operation: "TERMINATE",
      })
    ).ok,
  ).toBe(true);
  expect((await f.build(b, f.secondRooms).resume(f.roomId)).ok).toBe(true);
  expect(await f.rooms.read(f.users[0], f.roomId)).toMatchObject({
    room: { status: "CLOSED", version: 4 },
  });
});

it("finishes real private Coup, persists its result once and repairs a failed room-close callback", async () => {
  const f = await fixture(),
    matchId = await f.active();
  const close = vi.fn(f.rooms.closeStarted);
  close.mockResolvedValueOnce({
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Operation failed", retryable: false },
  });
  const port = f.build(a, { ...f.rooms, closeStarted: close });
  let last:
    { actor: string; input: ReturnType<typeof f.request> & { command: unknown } } | undefined;
  for (let turn = 0; turn < 200; turn++) {
    const saved = await f.stored();
    if (saved.match!.status === "FINISHED") break;
    const state = migrateCoupState(saved.match!.stateJsonb, 4);
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
    const input = { ...f.request(matchId, saved.match!.stateVersion), command };
    const result = await port.command(actor, input);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL_ERROR");
    last = { actor, input };
  }
  const finished = await f.stored();
  expect(finished.match!.status).toBe("FINISHED");
  expect(finished.result).not.toBeNull();
  expect(finished.outbox.filter((event) => event.type === "MATCH_FINISHED_V1")).toHaveLength(1);
  expect(await f.rooms.read(f.users[0], f.roomId)).toMatchObject({ room: { status: "STARTED" } });
  const retry = await f.build(b, f.secondRooms).command(last!.actor, last!.input);
  expect(retry).toMatchObject({ ok: true, value: { status: "FINISHED" } });
  expect(await f.rooms.read(f.users[0], f.roomId)).toMatchObject({
    room: { status: "CLOSED", version: 4 },
  });
  expect(await f.stored()).toEqual(finished);
  expect(await f.build().start(f.users[0], f.start)).toMatchObject({ ok: true, appliedVersion: 2 });
});

it("routes authenticated Socket start/readiness through the durable workflow and recipient-safe snapshots", async () => {
  const f = await fixture(),
    privateRooms = f.build();
  const deps = realtimeDependencies().ports;
  deps.privateRooms = privateRooms;
  deps.rooms = f.rooms;
  deps.matches = f.processing;
  deps.membership = createMatchMembershipPort(a);
  deps.delivery = { ackTimeoutMs: 1000, resync: createMatchResyncPort(a, [f.game]) };
  deps.nowMs = f.clock.nowMs;
  // Session identity is fixed across per-event reauthentication, as it is in real Auth.
  const sessions = f.users.map((userId) => ({
    schemaVersion: 1 as const,
    userId,
    sessionId: randomUUID(),
    expiresAt: 9000,
  }));
  deps.sessions = {
    authenticate: async (token) => {
      const seat = token === "host-fixture" ? 0 : token === "guest-fixture" ? 1 : -1;
      if (seat < 0) throw new Error("Unknown fixture identity");
      return { ok: true, session: sessions[seat]! };
    },
  };
  const server = createServer(),
    gateway = createRealtimeGateway(server, deps),
    clients: Socket[] = [];
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    for (const token of ["host-fixture", "guest-fixture"]) {
      const client = io(`http://127.0.0.1:${address.port}/v1`, {
        path: "/v1/socket.io",
        transports: ["websocket"],
        reconnection: false,
        auth: { schemaVersion: 1, accessToken: token },
        extraHeaders: { Origin: "https://mini.example" },
      });
      clients.push(client);
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("connect_error", reject);
      });
    }
    expect(await clients[1]!.timeout(2000).emitWithAck("room:start", f.start)).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
    expect(await clients[0]!.timeout(2000).emitWithAck("room:start", f.start)).toMatchObject({
      ok: true,
      appliedVersion: 2,
    });
    const matchId = (await f.stored()).match!.id;
    const first: unknown = await clients[0]!
      .timeout(2000)
      .emitWithAck("match:ready", f.request(matchId, 1));
    expect(first).toMatchObject({ ok: true, value: { status: "WAITING_FOR_PLAYERS" } });
    const second: unknown = await clients[1]!
      .timeout(2000)
      .emitWithAck("match:ready", f.request(matchId, 2));
    expect(second).toMatchObject({ ok: true, value: { status: "READY" } });
    const snapshot: { ok: boolean; value: { status: string; view: { viewerId: string } } } =
      await clients[1]!.timeout(2000).emitWithAck("match:snapshot", { schemaVersion: 1, matchId });
    expect(snapshot).toMatchObject({
      ok: true,
      value: { status: "ACTIVE", view: { viewerId: f.users[1] } },
    });
  } finally {
    for (const client of clients) client.disconnect();
    await gateway.close();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 15000);

it("retains legacy private records without guessing start provenance or replacing their pins", async () => {
  const f = await fixture(),
    matchId = randomUUID();
  await a.forModule("matches").transaction(async (db) => {
    await db.match.create({
      data: {
        id: matchId,
        roomId: f.roomId,
        gameId: "coup",
        matchType: "PRIVATE_ROOM",
        status: "CREATED",
        engineVersion: "legacy-v1",
        stateSchemaVersion: 1,
        rulesetVersion: "legacy-v1",
      },
    });
    for (const [seat, userId] of f.users.entries())
      await db.matchPlayer.create({
        data: {
          matchId,
          userId,
          seat,
          agentType: "HUMAN",
          connectionStatus: "DISCONNECTED",
        },
      });
  });
  const before = await f.stored();
  expect(await f.build().start(f.users[0], f.start)).toMatchObject({
    error: { code: "INTERNAL_ERROR" },
  });
  expect(await f.stored()).toEqual(before);
});
