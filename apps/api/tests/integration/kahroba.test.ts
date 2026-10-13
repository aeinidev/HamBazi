import { execFile, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { once } from "node:events";
import { io, type Socket } from "socket.io-client";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { createDatabase, DatabaseError } from "@hambazi/database";
import {
  kahrobaPlayerViewSchema,
  kahrobaBotPolicy,
  migrateKahrobaState,
  kahrobaEngine,
  zeroTokens,
  type KahrobaState,
} from "@hambazi/kahroba-engine";
import { createCatalogPort } from "../../src/games/index.js";
import {
  createMatchResyncPort,
  createMatchMembershipPort,
  createMatchReconnectPort,
  createMatchAutomationPort,
  createMatchAdmissionPort,
  createMatchProcessingPort,
  createMatchResultPort,
} from "../../src/matches/index.js";
import { createUserIdentityPort } from "../../src/users/index.js";
import { createPresencePort } from "../../src/presence/index.js";
import { createRealtimeGateway } from "../../src/realtime/index.js";
import { realtimeDependencies } from "../fixtures/realtime.js";
import {
  kahrobaFixture,
  isolatedKahrobaCatalog,
  installSharedFinalRound,
} from "../fixtures/kahroba.js";
import { kahrobaMatchDescriptor } from "../../src/composition/kahroba-match.js";
import {
  createRedisMatchmakingQueue,
  createMatchmaking,
  createAdmissionCredentials,
} from "../../src/matchmaking/index.js";

if (
  process.env.TEST_KAHROBA_RUN !== "isolated-k2" ||
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  !process.env.API_DATABASE_URL ||
  !process.env.TEST_DATABASE_URL ||
  !process.env.TEST_AUTH_REDIS_URL
)
  throw new Error("Use test:kahroba:local disposable harness");
const options = {
  poolMax: 10,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 10000,
};
const a = createDatabase({
    ...options,
    databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
  }),
  b = createDatabase({ ...options, databaseUrl: { reveal: () => process.env.API_DATABASE_URL! } }),
  admin = createDatabase({
    ...options,
    databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL! },
  });
beforeAll(async () => {
  await Promise.all([a.connect(), b.connect(), admin.connect()]);
  await admin.forModule("games").execute((db) =>
    db.game.create({
      data: {
        id: "kahroba",
        slug: "kahroba",
        title: "کهربا",
        minPlayers: 2,
        maxPlayers: 4,
        status: "DISABLED",
        configSchemaVersion: 1,
        configJsonb: {},
        matchmakingEnabled: false,
        privateRoomsEnabled: false,
        chatEnabled: false,
      },
    }),
  );
});
afterAll(() => Promise.all([a.disconnect(), b.disconnect(), admin.disconnect()]));
it.each([2, 3, 4])(
  "persists a complete %s-player private game, closes its room and replays all engine events",
  async (n) => {
    const f = await kahrobaFixture(a, b, n),
      matchId = await f.active();
    const anchor = migrateKahrobaState((await f.stored()).match.stateJsonb, 1);
    let last:
      { actor: string; input: ReturnType<typeof f.request> & { command: unknown } } | undefined;
    for (let turn = 0; turn < 500; turn++) {
      const saved = await f.stored();
      if (saved.match.status === "FINISHED") break;
      const state = migrateKahrobaState(saved.match.stateJsonb, 1),
        actor = state.players[state.turnPlayerIndex]!.id;
      const command = kahrobaBotPolicy.chooseCommand(
        kahrobaPlayerViewSchema.parse(f.game.project(state, actor, "PLAYER")),
      );
      const input = { ...f.request(matchId, saved.match.stateVersion), command };
      expect((await f.first.privateRooms.command(actor, input)).ok).toBe(true);
      last = { actor, input };
    }
    const saved = await f.stored();
    expect(saved.match.status).toBe("FINISHED");
    expect(saved.result?.payloadJsonb).toMatchObject({ schemaVersion: 2, gameId: "kahroba" });
    expect(saved.results).toHaveLength(n);
    expect(saved.results.every((r) => r.schemaVersion === 2)).toBe(true);
    expect(saved.outbox.filter((e) => e.type === "MATCH_FINISHED_V2")).toHaveLength(1);
    let replay: KahrobaState = anchor;
    for (const event of saved.events.filter((e) => e.type === "GAME_ENGINE_EVENT")) {
      const payload = event.payloadJsonb as { event: unknown };
      replay = kahrobaEngine.applyEvent(
        replay,
        payload.event as Parameters<typeof kahrobaEngine.applyEvent>[1],
      );
    }
    expect(replay).toEqual(saved.match.stateJsonb);
    expect(await f.second.privateRooms.command(last!.actor, last!.input)).toMatchObject({
      ok: true,
      value: { status: "FINISHED" },
    });
    expect(await f.stored()).toEqual(saved);
    expect(await f.first.rooms.read(f.ids[0], f.roomId)).toMatchObject({
      room: { status: "CLOSED" },
    });
  },
  45000,
);
it("binds actors, serializes conflicting writers, deduplicates action IDs and rolls back failed writes", async () => {
  const f = await kahrobaFixture(a, b, 3),
    matchId = await f.active(),
    before = await f.stored();
  const state = migrateKahrobaState(before.match.stateJsonb, 1),
    actor = state.players[state.turnPlayerIndex]!.id;
  const command = { type: "RESERVE_CARD", source: { kind: "DECK", tier: 1 } };
  const input = { ...f.request(matchId, before.match.stateVersion), command };
  expect(
    await f.first.processing.command(
      f.ids.find((id) => id !== actor),
      input,
    ),
  ).toMatchObject({ error: { code: "GAME_STATE_CONFLICT" } });
  expect(await f.first.processing.command(randomUUID(), input)).toMatchObject({
    error: { code: "UNAUTHENTICATED" },
  });
  expect(await f.first.processing.command(actor, { ...input, userId: actor })).toMatchObject({
    error: { code: "INVALID_INPUT" },
  });
  expect(
    await f.first.processing.command(actor, {
      ...input,
      command: {
        type: "BUY_CARD",
        source: "RESERVED",
        cardId: "kahroba-card-00",
        payment: zeroTokens(),
      },
    }),
  ).toMatchObject({ error: { code: "GAME_STATE_CONFLICT" } });
  expect(await f.stored()).toEqual(before);
  const copies = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      (i % 2 ? f.first : f.second).processing.command(actor, input),
    ),
  );
  expect(copies.every((r) => r.ok)).toBe(true);
  for (const r of copies) expect(r).toEqual(copies[0]);
  const after = await f.stored();
  expect(after.commands.length).toBe(before.commands.length + 1);
  expect(after.events.length).toBe(before.events.length + 1);
  expect(after.outbox.length).toBe(before.outbox.length + 1);
  expect(
    await f.second.processing.command(actor, { ...input, command: { type: "PASS" } }),
  ).toMatchObject({ error: { code: "GAME_STATE_CONFLICT" } });
  const next = migrateKahrobaState(after.match.stateJsonb, 1),
    nextActor = next.players[next.turnPlayerIndex]!.id;
  const nextInput = {
    ...f.request(matchId, after.match.stateVersion),
    command: { type: "RESERVE_CARD", source: { kind: "DECK", tier: 2 } },
  };
  const races = await Promise.all([
    f.first.processing.command(nextActor, nextInput),
    f.second.processing.command(nextActor, { ...nextInput, actionId: randomUUID() }),
  ]);
  expect(races.filter((r) => r.ok)).toHaveLength(1);
  const checkpoint = await f.stored(),
    s = migrateKahrobaState(checkpoint.match.stateJsonb, 1),
    id = s.players[s.turnPlayerIndex]!.id;
  const attempt = {
    ...f.request(matchId, checkpoint.match.stateVersion),
    command: { type: "RESERVE_CARD", source: { kind: "DECK", tier: 3 } },
  };
  const scope = a.forModule("matches");
  let injected = false;
  const broken = {
    ...a,
    forModule: (owner: Parameters<typeof a.forModule>[0]) =>
      owner !== "matches"
        ? a.forModule(owner)
        : {
            ...scope,
            transaction: (operation: Parameters<typeof scope.transaction>[0]) =>
              scope.transaction((db) =>
                operation({
                  ...db,
                  outboxEvent: new Proxy(db.outboxEvent, {
                    get(target, key) {
                      if (key === "create")
                        return () => {
                          injected = true;
                          throw new Error("synthetic write failure");
                        };
                      return Reflect.get(target, key);
                    },
                  }),
                }),
              ),
          },
  } as typeof a;
  const processor = createMatchProcessingPort(
    broken,
    { clock: f.clock, games: [f.game] },
    createUserIdentityPort(a),
  );
  expect((await processor.command(id, attempt)).ok).toBe(false);
  expect(injected).toBe(true);
  expect(await f.stored()).toEqual(checkpoint);
  expect((await f.second.processing.command(id, attempt)).ok).toBe(true);
  // Known aborted transaction conflicts retry; an uncertain commit uses the same action receipt.
  const saved = await f.stored(),
    r = migrateKahrobaState(saved.match.stateJsonb, 1),
    who = r.players[r.turnPlayerIndex]!.id;
  const retryInput = {
    ...f.request(matchId, saved.match.stateVersion),
    command: kahrobaBotPolicy.chooseCommand(
      kahrobaPlayerViewSchema.parse(f.game.project(r, who, "PLAYER")),
    ),
  };
  let failures = 0;
  const retryDb = {
    ...a,
    forModule: (owner: Parameters<typeof a.forModule>[0]) =>
      owner !== "matches"
        ? a.forModule(owner)
        : {
            ...scope,
            transaction: async (operation: Parameters<typeof scope.transaction>[0]) => {
              if (failures++ < 2) throw new DatabaseError("DATABASE_TRANSACTION_CONFLICT");
              return scope.transaction(operation);
            },
          },
  } as typeof a;
  expect(
    (
      await createMatchProcessingPort(
        retryDb,
        { clock: f.clock, games: [f.game] },
        createUserIdentityPort(a),
      ).command(who, retryInput)
    ).ok,
  ).toBe(true);
  expect(failures).toBe(3);
});
it.each([2, 3, 4])(
  "matches %s seats through real Redis coordination and PostgreSQL admission",
  async (count) => {
    const f = await kahrobaFixture(a, b, count),
      namespace = randomUUID();
    const queue = createRedisMatchmakingQueue({
      url: { reveal: () => process.env.TEST_AUTH_REDIS_URL! },
      namespace,
      reservationMilliseconds: 1000,
      searchLimit: 100,
      readLimit: 100,
      cancelLimit: 100,
      rateWindowMilliseconds: 1000,
    });
    await queue.connect();
    try {
      const matches = createMatchAdmissionPort(
        a,
        { clock: f.clock, ticketTtlSeconds: 120, reservationTtlSeconds: 10 },
        {
          users: createUserIdentityPort(a),
          games: isolatedKahrobaCatalog,
          descriptor: async (input) => kahrobaMatchDescriptor(input),
        },
      );
      const credentials = createAdmissionCredentials({
        clock: f.clock,
        lifetimeSeconds: 30,
        issuer: "kahroba-local",
        audience: "match",
        activeKeyId: "test",
        keys: [
          { id: "test", secret: { reveal: () => Buffer.alloc(32, 74).toString("base64url") } },
        ],
      });
      const matchmaking = createMatchmaking({
        matches,
        queue: queue.queue,
        credentials,
        clock: f.clock,
        authenticate: f.sessions.authenticate,
      });
      const partition = { gameId: "kahroba", mode: "standard", capacity: count };
      const tickets = [];
      for (const token of f.tokens) {
        const r = await matchmaking.search(token, {
          ...partition,
          schemaVersion: 1,
          commandId: randomUUID(),
        });
        if (!r.ok) throw new Error("Search fixture failed");
        tickets.push(r.value);
      }
      const found = await matchmaking.run(partition);
      expect(found).toMatchObject({ ok: true, value: { matchId: expect.any(String) } });
      if (!found.ok || !found.value.matchId) throw new Error();
      expect(await matchmaking.run(partition)).toMatchObject({
        ok: true,
        value: { matchId: null },
      });
      for (let i = 0; i < count; i++) {
        const view = await matchmaking.found(f.tokens[i], {
          schemaVersion: 1,
          ticketId: tickets[i]!.ticketId,
        });
        if (!view.ok) throw new Error();
        expect(
          (
            await matchmaking.admit(f.tokens[i], {
              schemaVersion: 1,
              ticketId: tickets[i]!.ticketId,
              admissionToken: view.value.admissionToken.reveal(),
            })
          ).ok,
        ).toBe(true);
      }
      const row = await a
        .forModule("matches")
        .execute((db) => db.match.findUniqueOrThrow({ where: { id: found.value.matchId! } }));
      expect(row).toMatchObject({
        gameId: "kahroba",
        engineVersion: "kahroba-v1",
        stateSchemaVersion: 1,
        rulesetVersion: "kahroba-base-v1",
      });
    } finally {
      queue.close();
    }
  },
);
it("keeps public catalog, rooms and matchmaking admission unavailable for Kahroba", async () => {
  const catalog = createCatalogPort(a);
  expect(await catalog.find("kahroba")).toMatchObject({ error: { code: "NOT_FOUND" } });
  const listing = await catalog.list();
  expect(listing).toMatchObject({ ok: true });
  if (listing.ok) expect(listing.games.map((g) => g.id)).toEqual(["coup"]);
  const f = await kahrobaFixture(a, b),
    matches = createMatchAdmissionPort(
      a,
      { clock: f.clock, ticketTtlSeconds: 120, reservationTtlSeconds: 10 },
      {
        users: createUserIdentityPort(a),
        games: catalog,
        descriptor: async (input) => kahrobaMatchDescriptor(input),
      },
    );
  expect(
    await matches.register(f.ids[0], {
      schemaVersion: 1,
      commandId: randomUUID(),
      gameId: "kahroba",
      mode: "standard",
      capacity: 2,
    }),
  ).toMatchObject({ error: { code: "GAME_UNAVAILABLE" } });
});
it("delivers owner-private Socket snapshots, reconnects with epochs and restores after PostgreSQL/Redis restart", async () => {
  const f = await kahrobaFixture(a, b, 3),
    matchId = await f.active();
  const initial = await f.stored(),
    state = migrateKahrobaState(initial.match.stateJsonb, 1),
    owner = state.players[state.turnPlayerIndex]!.id;
  expect(
    (
      await f.first.processing.command(owner, {
        ...f.request(matchId, initial.match.stateVersion),
        command: { type: "RESERVE_CARD", source: { kind: "DECK", tier: 1 } },
      })
    ).ok,
  ).toBe(true);
  const saved = await f.stored(),
    resync = createMatchResyncPort(a, [f.game]);
  const reconnect = createMatchReconnectPort(a, {
    clock: f.clock,
    policy: { schemaVersion: 1, leaseMs: 30000, graceMs: 30000, maxConnections: 4 },
  });
  const deps = realtimeDependencies().ports;
  deps.sessions = f.sessions;
  deps.matches = f.first.processing;
  deps.privateRooms = f.first.privateRooms;
  deps.rooms = f.first.rooms;
  deps.membership = createMatchMembershipPort(a);
  deps.nowMs = f.clock.nowMs;
  deps.delivery = { ackTimeoutMs: 1000, resync };
  deps.presence = {
    port: createPresencePort({ reconnect, resync }),
    heartbeatIntervalMs: 500,
    heartbeatTimeoutMs: 500,
    leaseMs: 30000,
  };
  const server = createServer(),
    gateway = createRealtimeGateway(server, deps),
    clients: Socket[] = [];
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error();
  const port = address.port;
  async function connect(index: number) {
    const c = io(`http://127.0.0.1:${port}/v1`, {
      path: "/v1/socket.io",
      transports: ["websocket"],
      reconnection: false,
      auth: { schemaVersion: 1, accessToken: f.tokens[index] },
      extraHeaders: { Origin: "https://mini.example" },
    });
    clients.push(c);
    await new Promise<void>((resolve, reject) => {
      c.once("connect", resolve);
      c.once("connect_error", reject);
    });
    c.on("match:snapshot", (s: { lastEventSeq: number }, ack: (seq: number) => void) =>
      ack(s.lastEventSeq),
    );
    return c;
  }
  try {
    for (let i = 0; i < 3; i++) {
      const c = await connect(i);
      expect(
        (await c.timeout(2000).emitWithAck("match:subscribe", { schemaVersion: 1, matchId })).ok,
      ).toBe(true);
      const snap = await c
        .timeout(2000)
        .emitWithAck("match:snapshot", { schemaVersion: 1, matchId });
      expect(snap.value.view.myReserved).toHaveLength(f.ids[i] === owner ? 1 : 0);
      expect(JSON.stringify(snap)).not.toMatch(/"decks"|"unusedNobles"|"stateJsonb"/);
    }
    const index = f.ids.indexOf(owner);
    clients[index]!.disconnect();
    await vi.waitFor(async () => {
      const rows = await f.stored();
      expect(rows.players.find((p) => p.userId === owner)!.connectionStatus).toBe("DISCONNECTED");
    });
    const old = (await f.stored()).players.find((p) => p.userId === owner)!;
    const replacement = await connect(index);
    expect(
      (
        await replacement
          .timeout(2000)
          .emitWithAck("match:subscribe", { schemaVersion: 1, matchId })
      ).ok,
    ).toBe(true);
    const fresh = await f.stored();
    expect(fresh.players.find((p) => p.userId === owner)!.connectionEpoch).toBeGreaterThan(
      old.connectionEpoch,
    );
    expect(fresh.match.stateJsonb).toEqual(saved.match.stateJsonb);
    expect(migrateKahrobaState(fresh.match.stateJsonb, 1).deadlineAt).toBeNull();
    const catchup = await replacement
      .timeout(2000)
      .emitWithAck("match:catchup", { schemaVersion: 1, matchId, afterSeq: 0 });
    expect(catchup.value.snapshot.view.myReserved).toHaveLength(1);
    expect(
      catchup.value.events.every((e: { payload: unknown }) => JSON.stringify(e.payload) === "{}"),
    ).toBe(true);
    const actor = migrateKahrobaState(fresh.match.stateJsonb, 1).players[
      migrateKahrobaState(fresh.match.stateJsonb, 1).turnPlayerIndex
    ]!.id;
    const input = {
      ...f.request(matchId, fresh.match.stateVersion),
      command: { type: "RESERVE_CARD", source: { kind: "DECK", tier: 2 } },
    };
    const actorSocket = clients[f.ids.indexOf(actor)]!;
    expect((await actorSocket.timeout(2000).emitWithAck("game:command", input)).ok).toBe(true);
    const wakeup = (await f.stored()).outbox
      .filter((e) => e.type === "MATCH_CHANGED_V1")
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0]!;
    await gateway.publish({
      schemaVersion: 1,
      eventId: wakeup.id,
      aggregateId: matchId,
      occurredAt: wakeup.createdAt.getTime(),
      type: "MATCH_CHANGED_V1",
      correlation: {},
      payload: wakeup.payloadJsonb,
    });
  } finally {
    for (const c of clients) c.disconnect();
    await gateway.close();
    if (server.listening) await new Promise<void>((r) => server.close(() => r()));
  }
  const before = await f.stored();
  const redisName = process.env.TEST_AUTH_REDIS_CONTAINER!,
    pgName = process.env.TEST_KAHROBA_POSTGRES_CONTAINER!;
  if (!redisName.startsWith("hambazi-auth-http-") || !pgName.startsWith("hambazi-image-test-"))
    throw new Error("Not disposable services");
  const run = promisify(execFile);
  try {
    await run("docker", ["stop", "--time", "1", redisName]);
    expect((await resync.snapshot(owner, { schemaVersion: 1, matchId })).ok).toBe(true);
    expect((await f.compose(b).privateRooms.resume(f.roomId)).ok).toBe(true);
  } finally {
    await run("docker", ["start", redisName]);
  }
  await run("docker", ["restart", pgName]);
  await expect
    .poll(
      async () => {
        try {
          return await a.probe();
        } catch {
          return false;
        }
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const rebuilt = f.compose(b);
  expect((await rebuilt.privateRooms.resume(f.roomId)).ok).toBe(true);
  expect(
    (await createMatchResyncPort(b, [f.game]).snapshot(owner, { schemaVersion: 1, matchId })).ok,
  ).toBe(true);
  expect(await f.stored()).toEqual(before);
  expect(
    await createMatchAutomationPort(a, { clock: f.clock, games: [f.game] }).plan(matchId),
  ).toMatchObject({ intent: null });
}, 30000);
it("commits shared victory once and atomically rolls back a failed result write", async () => {
  const f = await kahrobaFixture(a, b),
    matchId = await f.active(),
    commands = await installSharedFinalRound(f);
  expect(
    (
      await f.first.processing.command(f.ids[0], {
        ...f.request(matchId, (await f.stored()).match.stateVersion),
        command: commands[0],
      })
    ).ok,
  ).toBe(true);
  const before = await f.stored(),
    input = { ...f.request(matchId, before.match.stateVersion), command: commands[1] };
  const scope = a.forModule("matches");
  let injected = false;
  const broken = {
    ...a,
    forModule: (owner: Parameters<typeof a.forModule>[0]) =>
      owner !== "matches"
        ? a.forModule(owner)
        : {
            ...scope,
            transaction: (operation: Parameters<typeof scope.transaction>[0]) =>
              scope.transaction((db) =>
                operation({
                  ...db,
                  gameResult: new Proxy(db.gameResult, {
                    get(target, key) {
                      if (key === "createMany")
                        return () => {
                          injected = true;
                          throw new Error("synthetic result write failure");
                        };
                      return Reflect.get(target, key);
                    },
                  }),
                }),
              ),
          },
  } as typeof a;
  expect(
    (
      await createMatchProcessingPort(
        broken,
        { clock: f.clock, games: [f.game] },
        createUserIdentityPort(a),
      ).command(f.ids[1], input)
    ).ok,
  ).toBe(false);
  expect(injected).toBe(true);
  expect(await f.stored()).toEqual(before);
  const results = await Promise.all([
    f.first.processing.command(f.ids[1], input),
    f.second.processing.command(f.ids[1], input),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({ ok: true, value: { status: "FINISHED" } });
  const saved = await f.stored();
  expect(saved.result?.payloadJsonb).toMatchObject({
    schemaVersion: 2,
    result: {
      winnerId: null,
      winnerIds: f.ids,
      outcome: "SHARED_VICTORY",
      placements: f.ids.map((playerId) => ({ playerId, place: 1 })),
    },
  });
  expect(saved.results.every((r) => r.winner && r.placement === 1 && r.schemaVersion === 2)).toBe(
    true,
  );
  const event = saved.outbox.find((e) => e.type === "MATCH_FINISHED_V2")!;
  const port = createMatchResultPort(b);
  const inputEvent = {
    schemaVersion: 2,
    eventId: event.id,
    aggregateId: matchId,
    occurredAt: event.createdAt.getTime(),
    type: event.type,
    payload: event.payloadJsonb,
    correlation: {},
  };
  await port.record(inputEvent);
  await port.record(inputEvent);
  expect(await f.stored()).toEqual(saved);
  await expect(
    port.record({ ...inputEvent, payload: { ...(event.payloadJsonb as object), gameId: "coup" } }),
  ).rejects.toThrow("Match result unavailable");
});
it("reconnects to a fresh API process using durable sessions, snapshots and action receipts", async () => {
  const f = await kahrobaFixture(a, b),
    matchId = await f.active();
  async function launch() {
    const child = fork(new URL("../fixtures/kahroba-service.mjs", import.meta.url), [], {
      env: process.env,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const ready = await new Promise<{ ready: boolean; port: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Test service readiness")), 10000);
      child.once("message", (m) => {
        clearTimeout(timer);
        resolve(m as { ready: boolean; port: number });
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Test service exit"));
      });
    });
    return { child, port: ready.port };
  }
  async function connect(port: number, seat: number) {
    const socket = io(`http://127.0.0.1:${port}/v1`, {
      path: "/v1/socket.io",
      transports: ["websocket"],
      reconnection: false,
      auth: { schemaVersion: 1, accessToken: f.tokens[seat] },
      extraHeaders: { Origin: "https://mini.example" },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    socket.on("match:snapshot", (s: { lastEventSeq: number }, ack: (seq: number) => void) =>
      ack(s.lastEventSeq),
    );
    return socket;
  }
  let node = await launch(),
    client: Socket | undefined;
  try {
    const saved = await f.stored(),
      s = migrateKahrobaState(saved.match.stateJsonb, 1),
      actor = s.players[s.turnPlayerIndex]!.id,
      seat = f.ids.indexOf(actor);
    client = await connect(node.port, seat);
    const input = {
      ...f.request(matchId, saved.match.stateVersion),
      command: { type: "RESERVE_CARD", source: { kind: "DECK", tier: 3 } },
    };
    expect((await client.timeout(3000).emitWithAck("game:command", input)).ok).toBe(true);
    const checkpoint = await f.stored();
    client.disconnect();
    client = undefined;
    node.child.send("close");
    await once(node.child, "exit");
    node = await launch();
    client = await connect(node.port, seat);
    expect(await client.timeout(3000).emitWithAck("game:command", input)).toMatchObject({
      ok: true,
      value: { stateVersion: checkpoint.match.stateVersion },
    });
    const snapshot = await client
      .timeout(3000)
      .emitWithAck("match:snapshot", { schemaVersion: 1, matchId });
    expect(snapshot.value.view.myReserved).toHaveLength(1);
    expect(snapshot.value.view.deadlineAt).toBeNull();
    expect(await f.stored()).toEqual(checkpoint);
  } finally {
    client?.disconnect();
    if (node.child.exitCode === null) {
      node.child.send("close");
      await once(node.child, "exit");
    }
  }
}, 30000);
