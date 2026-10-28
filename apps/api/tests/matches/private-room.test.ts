import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createErrorEnvelope } from "@hambazi/contracts";
import {
  privateRoomMatchService,
  type PrivateRoomMatchRepository,
  type PrivateRoomMatch,
} from "../../src/matches/application/private-room.js";
import type { RoomsPort, RoomStartSnapshot } from "../../src/rooms/index.js";
import type { MatchProcessingPort } from "../../src/matches/index.js";

function fixture() {
  const roomId = randomUUID(),
    matchId = randomUUID(),
    host = randomUUID(),
    guest = randomUUID();
  const pins = { engineVersion: "test-v1", stateSchemaVersion: 1, rulesetVersion: "test-v1" };
  const snapshot: RoomStartSnapshot = {
    schemaVersion: 1,
    roomId,
    gameId: "coup",
    capacity: 2,
    startVersion: 2,
    status: "STARTING",
    startedMatchId: null,
    players: [
      { userId: host, seat: 0 },
      { userId: guest, seat: 1 },
    ],
  };
  let match: PrivateRoomMatch | null = null;
  const repository: PrivateRoomMatchRepository = {
    read: vi.fn(async () => match),
    roomForMatch: vi.fn(async (id) => (id === matchId ? roomId : null)),
    create: vi.fn(async (source, descriptor) => {
      match ??= {
        schemaVersion: 1,
        matchId,
        roomId,
        gameId: "coup",
        startVersion: source.startVersion,
        status: "CREATED",
        stateVersion: 0,
        descriptor,
        players: source.players,
      };
      return match;
    }),
  };
  const startAck = {
    ok: true as const,
    schemaVersion: 1 as const,
    commandId: randomUUID(),
    roomId,
    appliedVersion: 2,
  };
  const rooms = {
    start: vi.fn(async () => startAck),
    read: vi.fn(async () => createErrorEnvelope("NOT_FOUND")),
    startSnapshot: vi.fn(async () => ({ ok: true as const, snapshot: structuredClone(snapshot) })),
    confirmStarted: vi.fn(async () => {
      snapshot.status = "STARTED";
      snapshot.startedMatchId = matchId;
      return { ok: true as const };
    }),
    closeStarted: vi.fn(async () => {
      snapshot.status = "CLOSED";
      return { ok: true as const };
    }),
    listStartWork: vi.fn(async () => ({ ok: true as const, roomIds: [roomId], nextRoomId: null })),
  };
  const ack = (actionId: string) => ({
    ok: true as const,
    value: {
      schemaVersion: 1 as const,
      matchId,
      actionId,
      stateVersion: match!.stateVersion,
      lastEventSeq: match!.stateVersion,
      status: match!.status,
    },
  });
  const processing = {
    lifecycle: vi.fn(async (input: unknown) => {
      const { actionId, operation } = input as { actionId: string; operation: string };
      match!.status =
        operation === "TERMINATE"
          ? "TERMINATED"
          : operation === "WAIT"
            ? "WAITING_FOR_PLAYERS"
            : operation === "START"
              ? "STARTING"
              : "ACTIVE";
      match!.stateVersion++;
      return ack(actionId);
    }),
    ready: vi.fn(async () => ack(randomUUID())),
    command: vi.fn(async () => ack(randomUUID())),
  };
  const users = {
    findActiveById: vi.fn(async (userId: string) => ({ userId })),
    findActiveByTelegramId: vi.fn(async () => undefined),
  };
  const games = {
    find: vi.fn(async () => ({
      ok: true as const,
      game: {
        id: "coup",
        minPlayers: 2,
        maxPlayers: 6,
        status: "ACTIVE",
        playable: true,
        privateRoomsEnabled: true,
      },
    })),
  };
  const descriptor = vi.fn(async () => pins);
  const options = {
    repository,
    rooms: rooms as unknown as RoomsPort,
    processing: processing as unknown as MatchProcessingPort,
    users,
    games: games as never,
    descriptor,
  };
  return {
    roomId,
    matchId,
    host,
    guest,
    snapshot,
    rooms,
    processing,
    repository,
    descriptor,
    users,
    games,
    pins,
    options,
    service: privateRoomMatchService(options),
    match: () => match!,
  };
}
it("freezes through Rooms, commits creation, waits and confirms only the durable Match", async () => {
  const f = fixture();
  expect(await f.service.start(f.host, {})).toEqual(await f.rooms.start());
  expect(f.match().status).toBe("WAITING_FOR_PLAYERS");
  expect(f.rooms.confirmStarted).toHaveBeenCalledWith(f.roomId, 2, f.matchId);
  const operations = [
    vi.mocked(f.repository.create),
    f.processing.lifecycle,
    f.rooms.confirmStarted,
  ];
  expect(operations.map((operation) => operation.mock.invocationCallOrder[0])).toEqual(
    [...operations.map((operation) => operation.mock.invocationCallOrder[0])].sort(
      (a, b) => a! - b!,
    ),
  );
});
it("preserves owner denial and never creates a Match for a rejected room start", async () => {
  const f = fixture();
  f.rooms.start.mockResolvedValue(createErrorEnvelope("FORBIDDEN") as never);
  expect(await f.service.start(f.guest, {})).toMatchObject({ error: { code: "FORBIDDEN" } });
  expect(f.repository.create).not.toHaveBeenCalled();
});
it("reuses the initial binding and refreshes it after a lifecycle transition", async () => {
  const f = fixture();
  expect(await f.service.resume(f.roomId)).toMatchObject({ ok: true, matchId: f.matchId });
  expect(f.repository.read).toHaveBeenCalledTimes(2);
  expect(f.processing.lifecycle).toHaveBeenCalledTimes(1);
  expect(f.match().status).toBe("WAITING_FOR_PLAYERS");
});
it("uses stored pins during recovery even after catalog/configuration becomes unavailable", async () => {
  const f = fixture();
  await f.service.resume(f.roomId);
  f.match().status = "READY";
  f.match().stateVersion = 3;
  f.games.find.mockRejectedValue(new Error("sensitive diagnostics"));
  f.descriptor.mockRejectedValue(new Error("new descriptor"));
  expect(await privateRoomMatchService(f.options).resume(f.roomId)).toEqual({
    ok: true,
    matchId: f.matchId,
  });
  expect(f.match().status).toBe("ACTIVE");
  expect(f.descriptor).toHaveBeenCalledTimes(1);
  expect(f.match().descriptor).toEqual(f.pins);
});

it("avoids duplicate owner reads in a 128-operation active recovery wave", async () => {
  const f = fixture();
  await f.service.resume(f.roomId);
  f.match().status = "READY";
  await f.service.resume(f.roomId);
  expect(f.match().status).toBe("ACTIVE");
  f.rooms.startSnapshot.mockClear();
  vi.mocked(f.repository.read).mockClear();
  f.processing.lifecycle.mockClear();
  expect(await Promise.all(Array.from({ length: 128 }, () => f.service.resume(f.roomId)))).toEqual(
    Array(128).fill({ ok: true, matchId: f.matchId }),
  );
  expect(f.rooms.startSnapshot).toHaveBeenCalledTimes(128);
  expect(f.repository.read).toHaveBeenCalledTimes(128);
  expect(f.processing.lifecycle).not.toHaveBeenCalled();
  expect(f.rooms.closeStarted).not.toHaveBeenCalled();
});

it("still validates active recovery provenance and closes a subsequently finished Match", async () => {
  const f = fixture();
  await f.service.resume(f.roomId);
  f.match().status = "READY";
  await f.service.resume(f.roomId);
  f.snapshot.startedMatchId = randomUUID();
  expect(await f.service.resume(f.roomId)).toMatchObject({ error: { code: "ROOM_CONFLICT" } });
  f.snapshot.startedMatchId = f.matchId;
  f.snapshot.status = "CLOSED";
  expect(await f.service.resume(f.roomId)).toMatchObject({ error: { code: "ROOM_CONFLICT" } });
  f.snapshot.status = "STARTED";
  expect(await f.service.resume(f.roomId)).toEqual({ ok: true, matchId: f.matchId });
  f.match().status = "FINISHED";
  expect(await f.service.resume(f.roomId)).toEqual({ ok: true, matchId: f.matchId });
  expect(f.rooms.closeStarted).toHaveBeenCalledWith(f.roomId, f.matchId);
  expect(f.snapshot.status).toBe("CLOSED");
});
it("resumes creation and confirmation failures without releasing or replacing the frozen roster", async () => {
  const f = fixture();
  f.rooms.confirmStarted.mockRejectedValueOnce(new Error("hidden diagnostic"));
  expect(await f.service.resume(f.roomId)).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  expect(f.match().status).toBe("WAITING_FOR_PLAYERS");
  expect(await privateRoomMatchService(f.options).resume(f.roomId)).toEqual({
    ok: true,
    matchId: f.matchId,
  });
  expect(f.repository.create).toHaveBeenCalledTimes(1);
  expect(f.processing.lifecycle).toHaveBeenCalledTimes(1);
});
it("reuses the same intent identity after a failed uncommitted lifecycle step", async () => {
  const f = fixture();
  f.processing.lifecycle.mockResolvedValueOnce(createErrorEnvelope("INTERNAL_ERROR") as never);
  expect(await f.service.resume(f.roomId)).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  await privateRoomMatchService(f.options).resume(f.roomId);
  const calls = f.processing.lifecycle.mock.calls;
  expect(calls[0]).toEqual(calls[1]);
});
it("rejects conflicting durable Match provenance and malformed trusted projections", async () => {
  const f = fixture();
  await f.service.resume(f.roomId);
  f.match().startVersion++;
  expect(await f.service.resume(f.roomId)).toMatchObject({ error: { code: "ROOM_CONFLICT" } });
  f.snapshot.players.reverse();
  expect(await f.service.resume(f.roomId)).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
});
it("rejects a closed room bound to a nonterminal Match before advancing its lifecycle", async () => {
  const f = fixture();
  await f.service.resume(f.roomId);
  f.snapshot.status = "CLOSED";
  f.match().status = "CREATED";
  const calls = f.processing.lifecycle.mock.calls.length;
  expect(await f.service.resume(f.roomId)).toMatchObject({ error: { code: "ROOM_CONFLICT" } });
  expect(f.processing.lifecycle).toHaveBeenCalledTimes(calls);
});
it("bounds retries when another writer keeps conflicting and never returns raw errors", async () => {
  const f = fixture();
  f.processing.lifecycle.mockResolvedValue(createErrorEnvelope("GAME_STATE_CONFLICT") as never);
  expect(await f.service.resume(f.roomId)).toMatchObject({
    error: { code: "GAME_STATE_CONFLICT" },
  });
  expect(f.processing.lifecycle).toHaveBeenCalledTimes(8);
});
it.each(["FINISHED", "TERMINATED"] as const)(
  "closes a %s Match's room idempotently",
  async (status) => {
    const f = fixture();
    await f.service.resume(f.roomId);
    f.match().status = status;
    await f.service.resume(f.roomId);
    expect(f.snapshot.status).toBe("CLOSED");
    expect(await f.service.resume(f.roomId)).toEqual({ ok: true, matchId: f.matchId });
  },
);
it("continues other rooms after a recovery error, and rejects invalid/unbounded pages", async () => {
  const f = fixture();
  f.descriptor.mockRejectedValue(new Error("private diagnostic"));
  expect(await f.service.recover({ schemaVersion: 1, limit: 2 })).toEqual({
    ok: true,
    nextRoomId: null,
    results: [{ roomId: f.roomId, ok: false, errorCode: "INTERNAL_ERROR" }],
  });
  for (const input of [
    { limit: 2 },
    { schemaVersion: 1, limit: 51 },
    { schemaVersion: 1, limit: 2, userId: f.host },
  ])
    expect(await f.service.recover(input)).toMatchObject({ error: { code: "INVALID_INPUT" } });
  expect(await f.service.resume("not-a-room")).toMatchObject({ error: { code: "INVALID_INPUT" } });
});
it("passes matchmaking commands through without private-room lifecycle effects", async () => {
  const f = fixture();
  await f.service.resume(f.roomId);
  vi.mocked(f.repository.roomForMatch).mockResolvedValue(null);
  const input = {
    schemaVersion: 1,
    actionId: randomUUID(),
    matchId: randomUUID(),
    expectedVersion: 1,
  };
  expect((await f.service.ready(f.host, input)).ok).toBe(true);
  expect(f.rooms.confirmStarted).toHaveBeenCalledTimes(1);
});

// The opt-in policy changes lobby orchestration only; engine rules and the default policy stay pinned.
it("holds a fully ready manual-start room during ready follow-up and recovery until the host begins", async () => {
  const f = fixture();
  const service = privateRoomMatchService({ ...f.options, manualStart: true });
  await service.resume(f.roomId);
  f.match().status = "READY";
  f.match().readyUserIds = [f.host, f.guest];
  f.processing.lifecycle.mockClear();
  await service.ready(f.guest, {
    schemaVersion: 1,
    actionId: randomUUID(),
    matchId: f.matchId,
    expectedVersion: f.match().stateVersion,
  });
  await service.resume(f.roomId);
  expect(f.match().status).toBe("READY");
  expect(f.processing.lifecycle).not.toHaveBeenCalled();
  f.rooms.read.mockResolvedValue({
    ok: true,
    room: { id: f.roomId, hostUserId: f.host, startedMatchId: f.matchId, status: "STARTED" },
  } as never);
  expect(
    (
      await service.begin(f.host, {
        schemaVersion: 1,
        actionId: randomUUID(),
        matchId: f.matchId,
        expectedVersion: f.match().stateVersion,
      })
    ).ok,
  ).toBe(true);
  expect(f.match().status).toBe("ACTIVE");
  expect(
    f.processing.lifecycle.mock.calls.map(([r]) => (r as { operation: string }).operation),
  ).toEqual(["START", "ACTIVATE"]);
});
it("denies non-host launches, unknown bindings and malformed commands without lifecycle writes", async () => {
  const f = fixture(),
    service = privateRoomMatchService({ ...f.options, manualStart: true });
  await service.resume(f.roomId);
  f.processing.lifecycle.mockClear();
  f.rooms.read.mockResolvedValue({
    ok: true,
    room: { id: f.roomId, hostUserId: f.host, startedMatchId: f.matchId, status: "STARTED" },
  } as never);
  const input = {
    schemaVersion: 1,
    actionId: randomUUID(),
    matchId: f.matchId,
    expectedVersion: 1,
  };
  expect(await service.begin(f.guest, input)).toMatchObject({ error: { code: "FORBIDDEN" } });
  expect(await service.begin(f.host, { ...input, userId: f.host })).toMatchObject({
    error: { code: "INVALID_INPUT" },
  });
  expect(await f.service.begin(f.host, input)).toMatchObject({ error: { code: "INVALID_INPUT" } });
  expect(await service.begin(f.host, { ...input, matchId: randomUUID() })).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  expect(f.processing.lifecycle).not.toHaveBeenCalled();
});
it("returns membership-guarded durable readiness and never hidden state or invitations", async () => {
  const f = fixture(),
    service = privateRoomMatchService({ ...f.options, manualStart: true });
  expect(await service.readiness(f.guest, f.roomId)).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  await service.resume(f.roomId);
  f.match().readyUserIds = [f.host];
  f.rooms.read.mockResolvedValue({
    ok: true,
    room: { id: f.roomId, members: [{ userId: f.host }, { userId: f.guest }] },
  } as never);
  expect(await service.readiness(f.host, f.roomId)).toEqual({
    ok: true,
    value: {
      schemaVersion: 1,
      roomId: f.roomId,
      matchId: f.matchId,
      stateVersion: 1,
      status: "WAITING_FOR_PLAYERS",
      canStart: false,
      players: [
        { userId: f.host, ready: true },
        { userId: f.guest, ready: false },
      ],
    },
  });
});
it("preserves a rejected or stale host-start intent without activation", async () => {
  const f = fixture(),
    service = privateRoomMatchService({ ...f.options, manualStart: true });
  await service.resume(f.roomId);
  f.rooms.read.mockResolvedValue({
    ok: true,
    room: { id: f.roomId, hostUserId: f.host, startedMatchId: f.matchId, status: "STARTED" },
  } as never);
  f.processing.lifecycle.mockResolvedValue(createErrorEnvelope("GAME_STATE_CONFLICT") as never);
  expect(
    await service.begin(f.host, {
      schemaVersion: 1,
      actionId: randomUUID(),
      matchId: f.matchId,
      expectedVersion: 0,
    }),
  ).toMatchObject({ error: { code: "GAME_STATE_CONFLICT" } });
  expect(f.match().status).toBe("WAITING_FOR_PLAYERS");
});
it("validates the frozen roster before any host-start lifecycle write", async () => {
  const f = fixture(),
    service = privateRoomMatchService({ ...f.options, manualStart: true });
  await service.resume(f.roomId);
  f.rooms.read.mockResolvedValue({
    ok: true,
    room: { id: f.roomId, hostUserId: f.host, startedMatchId: f.matchId, status: "STARTED" },
  } as never);
  f.match().startVersion++;
  f.processing.lifecycle.mockClear();
  expect(
    await service.begin(f.host, {
      schemaVersion: 1,
      actionId: randomUUID(),
      matchId: f.matchId,
      expectedVersion: f.match().stateVersion,
    }),
  ).toMatchObject({ error: { code: "ROOM_CONFLICT" } });
  expect(f.processing.lifecycle).not.toHaveBeenCalled();
});

it("allows only the host to cancel a prepared waiting room, then closes its durable binding", async () => {
  const f = fixture(),
    service = privateRoomMatchService({ ...f.options, manualStart: true });
  await service.resume(f.roomId);
  f.rooms.read.mockResolvedValue({
    ok: true,
    room: { id: f.roomId, hostUserId: f.host, startedMatchId: f.matchId, status: "STARTED" },
  } as never);
  f.processing.lifecycle.mockClear();
  const input = {
    schemaVersion: 1,
    actionId: randomUUID(),
    matchId: f.matchId,
    expectedVersion: f.match().stateVersion,
  };
  expect(await service.cancel(f.guest, input)).toMatchObject({ error: { code: "FORBIDDEN" } });
  expect(f.processing.lifecycle).not.toHaveBeenCalled();
  expect((await service.cancel(f.host, input)).ok).toBe(true);
  expect(f.match().status).toBe("TERMINATED");
  expect(f.rooms.closeStarted).toHaveBeenCalledWith(f.roomId, f.matchId);
});
it("does not allow a pregame cancellation command to terminate an active private game", async () => {
  const f = fixture(),
    service = privateRoomMatchService({ ...f.options, manualStart: true });
  await service.resume(f.roomId);
  f.match().status = "ACTIVE";
  f.rooms.read.mockResolvedValue({
    ok: true,
    room: { id: f.roomId, hostUserId: f.host, startedMatchId: f.matchId, status: "STARTED" },
  } as never);
  f.processing.lifecycle.mockClear();
  expect(
    await service.cancel(f.host, {
      schemaVersion: 1,
      actionId: randomUUID(),
      matchId: f.matchId,
      expectedVersion: f.match().stateVersion,
    }),
  ).toMatchObject({ error: { code: "GAME_STATE_CONFLICT" } });
  expect(f.processing.lifecycle).not.toHaveBeenCalled();
});
