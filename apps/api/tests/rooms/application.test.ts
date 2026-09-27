import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { roomsService, type RoomsRepository } from "../../src/rooms/application/rooms.js";
import { RoomFault, type Room } from "../../src/rooms/domain/room.js";
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
  return {
    actor,
    room,
    ack,
    repository,
    users,
    games,
    service: roomsService({ repository, users, games }),
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
    expect(await f.service.join(f.actor, f.command)).toMatchObject({
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
