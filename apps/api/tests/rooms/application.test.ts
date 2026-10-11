import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { roomsService, type RoomsRepository } from "../../src/rooms/application/rooms.js";
import { RoomFault, type Room } from "../../src/rooms/domain/room.js";
import type { CatalogPort } from "../../src/games/index.js";
function setup() {
  const actor = randomUUID();
  const roomId = randomUUID();
  const commandId = randomUUID();
  const ack = {
    ok: true as const,
    schemaVersion: 1 as const,
    commandId,
    roomId,
    appliedVersion: 0,
  };
  const room: Room = {
    id: roomId,
    gameId: "coup",
    hostUserId: actor,
    capacity: 2,
    version: 0,
    status: "WAITING",
    expiresAt: 1000,
    startedMatchId: null,
    members: [{ userId: actor, seat: 0, joinedAt: 0, joinedVersion: 0 }],
  };
  const repository: RoomsRepository = {
    listStartWork: vi.fn(async () => []),
    invitation: vi.fn(async () => ({ room, inviteCode: "A".repeat(43) })),
    receipt: vi.fn(async () => null),
    create: vi.fn(async () => ack),
    read: vi.fn(async () => room),
    command: vi.fn(async () => ack),
    confirmStarted: vi.fn(async () => {}),
    closeStarted: vi.fn(async () => {}),
    expire: vi.fn(async () => {}),
  };
  const users = {
    findActiveById: vi.fn(async (userId: string) => ({ userId })),
    findActiveByTelegramId: vi.fn(async () => undefined),
  };
  const games = {
    list: vi.fn(),
    find: vi.fn(async () => ({
      ok: true as const,
      game: {
        id: "coup",
        slug: "coup",
        title: "Coup",
        minPlayers: 2,
        maxPlayers: 6,
        status: "ACTIVE" as "ACTIVE" | "MAINTENANCE" | "DISABLED",
        playable: true,
        privateRoomsEnabled: true,
        matchmakingEnabled: false,
        chatEnabled: false,
        voiceEnabled: false,
        readiness: "NOT_IMPLEMENTED" as const,
        descriptor: null,
      },
    })),
  };
  const invites = {
    target: { botUsername: "HamBaziBot", appName: "play" },
    consume: vi.fn(
      async (): Promise<
        { allowed: true } | { allowed: false; reason: "unavailable" | "limited" }
      > => ({ allowed: true }),
    ),
  };
  return {
    invites,
    actor,
    room,
    ack,
    repository,
    users,
    games,
    service: roomsService({ repository, users, games, invites }),
    input: { schemaVersion: 1, commandId, gameId: "coup", capacity: 2 },
    command: { schemaVersion: 1, commandId, roomId, expectedVersion: 0 },
  };
}
it.each(["userId", "hostUserId", "inviteCode", "expiresAt", "status"])(
  "rejects client-authority field %s",
  async (field) => {
    const f = setup();
    expect(await f.service.create(f.actor, { ...f.input, [field]: "injected" })).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(f.repository.create).not.toHaveBeenCalled();
  },
);
it("normalizes UUIDs, uses verified actor and keeps create retries stable during maintenance", async () => {
  const f = setup();
  expect(await f.service.create(f.actor.toUpperCase(), f.input)).toEqual(f.ack);
  expect(f.repository.create).toHaveBeenCalledWith(f.actor, f.input);
  vi.mocked(f.repository.receipt).mockResolvedValue(f.ack);
  f.games.find.mockRejectedValue(new Error("secret"));
  expect(await f.service.create(f.actor, f.input)).toEqual(f.ack);
});
it("projects only frozen start provenance through the trusted port, never an invitation capability", async () => {
  const f = setup();
  expect(await f.service.startSnapshot(f.room.id)).toMatchObject({ error: { code: "NOT_FOUND" } });
  f.room.status = "STARTING";
  f.room.capacity = 2;
  f.room.version = 2;
  f.room.members.push({ userId: randomUUID(), seat: 1, joinedAt: 1, joinedVersion: 1 });
  const result = await f.service.startSnapshot(f.room.id);
  expect(result).toMatchObject({
    ok: true,
    snapshot: { startVersion: 2, status: "STARTING", startedMatchId: null },
  });
  expect(JSON.stringify(result)).not.toMatch(/invite|hostUserId|expiresAt|joinedAt/);
  f.room.status = "STARTED";
  f.room.version = 3;
  f.room.startedMatchId = randomUUID();
  expect(await f.service.startSnapshot(f.room.id)).toMatchObject({
    ok: true,
    snapshot: { startVersion: 2 },
  });
  f.room.status = "CLOSED";
  f.room.version = 4;
  expect(await f.service.startSnapshot(f.room.id)).toMatchObject({
    ok: true,
    snapshot: { startVersion: 2 },
  });
  f.room.members[1]!.seat = 0;
  expect(await f.service.startSnapshot(f.room.id)).toMatchObject({
    error: { code: "INTERNAL_ERROR" },
  });
});
it("validates trusted recovery pages and supplies a stable bounded continuation", async () => {
  const f = setup();
  const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
  vi.mocked(f.repository.listStartWork).mockResolvedValue(ids);
  expect(await f.service.listStartWork({ schemaVersion: 1, limit: 2 })).toEqual({
    ok: true,
    roomIds: ids.slice(0, 2),
    nextRoomId: ids[1],
  });
  expect(f.repository.listStartWork).toHaveBeenCalledWith(undefined, 3);
  for (const input of [
    { schemaVersion: 1, limit: 0 },
    { schemaVersion: 1, limit: 51 },
    { schemaVersion: 1, limit: 1, afterRoomId: "malformed" },
    { schemaVersion: 1, limit: 1, actor: f.actor },
  ])
    expect(await f.service.listStartWork(input)).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
});
it("denies current inactive users, nonmember reads and invalid identifiers", async () => {
  const f = setup();
  expect(await f.service.read(randomUUID(), f.room.id)).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  expect(await f.service.read(f.actor, "not-uuid")).toMatchObject({
    error: { code: "INVALID_INPUT" },
  });
  expect(await f.service.create("not-uuid", f.input)).toMatchObject({
    error: { code: "UNAUTHENTICATED" },
  });
  f.users.findActiveById.mockResolvedValue(undefined!);
  expect(await f.service.create(f.actor, f.input)).toMatchObject({
    error: { code: "UNAUTHENTICATED" },
  });
});
it.each(["DISABLED", "MAINTENANCE"] as const)(
  "rejects %s admission while still permitting leave",
  async (status) => {
    const f = setup();
    const result = await f.games.find();
    f.games.find.mockResolvedValue({ ...result, game: { ...result.game, status } });
    expect(await f.service.create(f.actor, f.input)).toMatchObject({
      error: { code: "GAME_UNAVAILABLE" },
    });
    expect(
      await f.service.join(f.actor, { ...f.command, inviteCode: "A".repeat(43) }),
    ).toMatchObject({
      error: { code: "GAME_UNAVAILABLE" },
    });
    expect(await f.service.leave(f.actor, f.command)).toEqual(f.ack);
  },
);
it("requires both implementation readiness flags and catalog capacities", async () => {
  const f = setup();
  expect(await f.service.create(f.actor, { ...f.input, capacity: 7 })).toMatchObject({
    error: { code: "INVALID_INPUT" },
  });
  const result = await f.games.find();
  f.games.find.mockResolvedValue({ ...result, game: { ...result.game, playable: false } });
  expect(await f.service.create(f.actor, f.input)).toMatchObject({
    error: { code: "GAME_UNAVAILABLE" },
  });
  f.games.find.mockResolvedValue({
    ...result,
    game: { ...result.game, privateRoomsEnabled: false },
  });
  expect(await f.service.create(f.actor, f.input)).toMatchObject({
    error: { code: "GAME_UNAVAILABLE" },
  });
});
it.each(["hokm", "kahroba", "chess", "domino", "ludo"])(
  "rejects direct room creation for the %s presentation card",
  async (gameId) => {
    const f = setup();
    const games = {
      ...f.games,
      find: vi.fn<CatalogPort["find"]>(async () => ({
        ok: false,
        error: { code: "NOT_FOUND" },
      })),
    };
    const service = roomsService({
      repository: f.repository,
      users: f.users,
      games,
      invites: f.invites,
    });
    expect(await service.create(f.actor, { ...f.input, gameId })).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    expect(games.find).toHaveBeenCalledWith(gameId);
    expect(f.repository.create).not.toHaveBeenCalled();
  },
);
it("checks host and every member eligibility before start", async () => {
  const f = setup();
  expect(await f.service.start(randomUUID(), f.command)).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  const member = randomUUID();
  f.room.members.push({ userId: member, seat: 1, joinedAt: 0, joinedVersion: 0 });
  expect(await f.service.start(member, f.command)).toMatchObject({ error: { code: "FORBIDDEN" } });
  f.users.findActiveById.mockImplementation(async (id) =>
    id === member ? undefined! : { userId: id },
  );
  expect(await f.service.start(f.actor, f.command)).toMatchObject({ error: { code: "FORBIDDEN" } });
  expect(f.repository.command).not.toHaveBeenCalled();
});
it("sanitizes dependency errors and preserves stable domain errors", async () => {
  const f = setup();
  vi.mocked(f.repository.create).mockRejectedValue(new Error("secret database"));
  const result = await f.service.create(f.actor, f.input);
  expect(result).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  expect(JSON.stringify(result)).not.toContain("secret");
  vi.mocked(f.repository.receipt).mockRejectedValue(new RoomFault("ROOM_CONFLICT"));
  expect(await f.service.create(f.actor, f.input)).toMatchObject({
    error: { code: "ROOM_CONFLICT" },
  });
});

it("shares only with the current host and resolves without roster or membership writes", async () => {
  const f = setup();
  expect(await f.service.shareInvite(f.actor, f.room.id)).toMatchObject({
    ok: true,
    invite: { startParam: "room_" + "A".repeat(43) },
  });
  expect(await f.service.shareInvite(randomUUID(), f.room.id)).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  const result = await f.service.resolveInvite(randomUUID(), {
    schemaVersion: 1,
    startParam: "room_" + "A".repeat(43),
  });
  expect(result).toEqual({
    ok: true,
    schemaVersion: 1,
    room: {
      id: f.room.id,
      gameId: "coup",
      capacity: 2,
      status: "WAITING",
      version: 0,
      expiresAt: 1000,
    },
  });
  expect(f.repository.command).not.toHaveBeenCalled();
});
it.each(["limited", "unavailable"] as const)(
  "invite %s fails closed before lookup or mutation",
  async (reason) => {
    const f = setup();
    f.invites.consume.mockResolvedValue({ allowed: false, reason });
    for (const result of [
      await f.service.resolveInvite(f.actor, {}),
      await f.service.shareInvite(f.actor, f.room.id),
      await f.service.join(f.actor, f.command),
    ])
      expect(result).toMatchObject({
        error: { code: reason === "limited" ? "RATE_LIMITED" : "INTERNAL_ERROR" },
      });
    expect(f.repository.invitation).not.toHaveBeenCalled();
    expect(f.repository.receipt).not.toHaveBeenCalled();
  },
);
it("requires current identity, canonical invitation, strict DTO and configured limiter", async () => {
  const f = setup();
  expect(await f.service.join(f.actor, f.command)).toMatchObject({
    error: { code: "INVALID_INPUT" },
  });
  for (const input of [
    { schemaVersion: 1, startParam: "room_bad" },
    { schemaVersion: 1, startParam: "room_" + "A".repeat(43), userId: f.actor },
  ])
    expect(await f.service.resolveInvite(f.actor, input)).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  const disabled = roomsService({ repository: f.repository, users: f.users, games: f.games });
  expect(await disabled.join(f.actor, f.command)).toMatchObject({
    error: { code: "INTERNAL_ERROR" },
  });
  f.users.findActiveById.mockResolvedValue(undefined!);
  expect(await f.service.resolveInvite(f.actor, {})).toMatchObject({
    error: { code: "UNAUTHENTICATED" },
  });
});
