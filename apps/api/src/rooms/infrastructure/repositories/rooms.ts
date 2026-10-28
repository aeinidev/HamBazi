import { hash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { DatabaseError, type createDatabase } from "@hambazi/database";
import type {
  Ack,
  CreateRoomInput,
  RoomCommand,
  RoomsRepository,
} from "../../application/rooms.js";
import {
  RoomFault,
  expire,
  transition,
  confirmStarted,
  closeStarted,
  type Room,
} from "../../domain/room.js";
const stored = z.strictObject({
  id: z.uuid(),
  gameId: z.string().min(1),
  hostUserId: z.uuid(),
  capacity: z.number().int().min(1),
  version: z.number().int().min(0).max(2147483647),
  status: z.enum(["WAITING", "FULL", "STARTING", "STARTED", "CLOSED", "EXPIRED"]),
  expiresAt: z.number().int().nonnegative(),
  startedMatchId: z.uuid().nullable(),
  members: z.array(
    z.strictObject({
      userId: z.uuid(),
      seat: z.number().int().nonnegative(),
      joinedAt: z.number().int().nonnegative(),
      joinedVersion: z.number().int().nonnegative(),
    }),
  ),
});
function fingerprint(kind: string, input: CreateRoomInput | RoomCommand) {
  return hash(
    "sha256",
    JSON.stringify(
      "capacity" in input
        ? [1, kind, input.gameId, input.capacity]
        : [1, kind, input.roomId, input.expectedVersion],
    ),
    "hex",
  );
}
export function createRoomsRepository(
  database: ReturnType<typeof createDatabase>,
  options: {
    clock: { nowMs(): number };
    ttlSeconds: number;
    newId?: () => string;
  },
): RoomsRepository {
  if (
    !Number.isSafeInteger(options.ttlSeconds) ||
    options.ttlSeconds < 1 ||
    options.ttlSeconds > 2147483
  )
    throw new Error("Invalid room lifetime");
  const scope = database.forModule("rooms");
  type Client = Parameters<Parameters<typeof scope.transaction>[0]>[0];
  const newId = options.newId ?? randomUUID;
  function now() {
    const value = options.clock.nowMs();
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 8640000000000000 - options.ttlSeconds * 1000
    )
      throw new Error("Invalid room clock");
    return value;
  }
  async function transaction<T>(
    operation: (db: Client) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const work = async (db: Client) => {
          if (!readOnly) await db.lockRooms();
          try {
            return await operation(db);
          } catch (error) {
            if (error instanceof RoomFault) return error;
            throw error;
          }
        };
        const result = readOnly
          ? await scope.snapshot(work)
          : await scope.transaction(work, "Serializable");
        if (result instanceof RoomFault) throw result;
        return result;
      } catch (error) {
        if (
          !(error instanceof DatabaseError) ||
          !["DATABASE_TRANSACTION_CONFLICT", "DATABASE_UNIQUE_CONFLICT"].includes(error.code) ||
          attempt >= 4
        )
          throw error;
        // The failed transaction has already rolled back. Spread retries so
        // independent serializable admissions do not repeatedly collide.
        // Four waits total 150–300 ms; retain the existing five-attempt bound.
        const backoffMs = 10 * 2 ** attempt;
        await new Promise<void>((resolve) =>
          setTimeout(resolve, backoffMs + randomInt(backoffMs + 1)),
        );
      }
    }
  }
  async function receipt(
    db: Client,
    actor: string,
    kind: string,
    input: CreateRoomInput | RoomCommand,
  ): Promise<Ack | null> {
    // Verify the capability even before returning an old acknowledgement. A valid
    // retry may outlive expiry, but cannot create membership a second time.
    if (kind === "join") {
      if (!("roomId" in input) || !input.inviteCode) throw new RoomFault("NOT_FOUND");
      const target = await db.room.findUnique({
        where: { id: input.roomId },
        select: { inviteCode: true },
      });
      if (!target || target.inviteCode !== input.inviteCode) throw new RoomFault("NOT_FOUND");
    }
    const row = await db.roomCommandReceipt.findUnique({
      where: { actorUserId_commandId: { actorUserId: actor, commandId: input.commandId } },
      select: { requestDigest: true, roomId: true, appliedVersion: true },
    });
    if (!row) return null;
    if (row.requestDigest !== fingerprint(kind, input)) throw new RoomFault("ROOM_CONFLICT");
    return {
      ok: true,
      schemaVersion: 1,
      commandId: input.commandId,
      roomId: row.roomId,
      appliedVersion: row.appliedVersion,
    };
  }
  async function record(
    db: Client,
    actor: string,
    kind: string,
    input: CreateRoomInput | RoomCommand,
    room: Room,
  ): Promise<Ack> {
    await db.roomCommandReceipt.create({
      data: {
        actorUserId: actor,
        commandId: input.commandId,
        roomId: room.id,
        requestDigest: fingerprint(kind, input),
        appliedVersion: room.version,
      },
    });
    return {
      ok: true,
      schemaVersion: 1,
      commandId: input.commandId,
      roomId: room.id,
      appliedVersion: room.version,
    };
  }
  async function load(db: Client, id: string): Promise<Room | null> {
    const row = await db.room.findUnique({
      where: { id },
      select: {
        id: true,
        gameId: true,
        hostUserId: true,
        capacity: true,
        status: true,
        expiresAt: true,
        stateVersion: true,
        schemaVersion: true,
        startedMatchId: true,
      },
    });
    if (!row) return null;
    if (row.schemaVersion !== 1) throw new Error("Unsupported room schema");
    const rows = await db.roomMember.findMany({
      where: { roomId: id },
      select: { userId: true, seat: true, joinedAt: true, joinedVersion: true },
      orderBy: { seat: "asc" },
    });
    const room = stored.parse({
      id: row.id,
      gameId: row.gameId,
      hostUserId: row.hostUserId,
      capacity: row.capacity,
      status: row.status,
      expiresAt: row.expiresAt.getTime(),
      version: row.stateVersion,
      startedMatchId: row.startedMatchId,
      members: rows.map((m) => ({ ...m, joinedAt: m.joinedAt.getTime() })),
    });
    if (
      room.members.length > room.capacity ||
      room.members.some((m) => m.seat >= room.capacity || m.joinedVersion > room.version) ||
      (["WAITING", "FULL", "STARTING", "STARTED"].includes(room.status) &&
        !room.members.some((m) => m.userId === room.hostUserId)) ||
      (["FULL", "STARTING", "STARTED"].includes(room.status) &&
        room.members.length !== room.capacity) ||
      (room.status === "WAITING" && room.members.length >= room.capacity) ||
      (room.status === "STARTED" && room.startedMatchId === null) ||
      (["WAITING", "FULL", "STARTING", "EXPIRED"].includes(room.status) &&
        room.startedMatchId !== null)
    )
      throw new Error("Invalid persisted room");
    return room;
  }
  async function save(db: Client, before: Room, after: Room) {
    if (before === after) return;
    const changed = await db.room.updateMany({
      where: { id: before.id, stateVersion: before.version },
      data: {
        hostUserId: after.hostUserId,
        status: after.status,
        stateVersion: after.version,
        startedMatchId: after.startedMatchId,
      },
    });
    // Throw a database conflict to roll the whole transaction back and retry.
    if (changed.count !== 1) throw { code: "P2034" };
    if (before.members !== after.members) {
      await db.roomMember.deleteMany({ where: { roomId: before.id } });
      for (const member of after.members)
        await db.roomMember.create({
          data: {
            roomId: after.id,
            userId: member.userId,
            seat: member.seat,
            joinedAt: new Date(member.joinedAt),
            joinedVersion: member.joinedVersion,
          },
        });
    }
  }
  async function current(db: Client, id: string) {
    const room = await load(db, id);
    if (!room) return null;
    const value = expire(room, now());
    await save(db, room, value);
    return value;
  }
  return {
    listStartWork: (afterRoomId, limit) =>
      scope.execute(async (db) => {
        const rows =
          afterRoomId === undefined
            ? await db.room.findMany({
                where: { status: { in: ["STARTING", "STARTED"] } },
                select: { id: true },
                orderBy: { id: "asc" },
                take: limit,
              })
            : await db.room.findMany({
                where: { status: { in: ["STARTING", "STARTED"] }, id: { gt: afterRoomId } },
                select: { id: true },
                orderBy: { id: "asc" },
                take: limit,
              });
        return rows.map((row) => row.id);
      }),
    receipt: (actor, kind, input) => transaction((db) => receipt(db, actor, kind, input)),
    create: (actor, input) =>
      transaction(async (db) => {
        const cached = await receipt(db, actor, "create", input);
        if (cached) return cached;
        const at = now();
        const room: Room = {
          id: newId(),
          gameId: input.gameId,
          hostUserId: actor,
          capacity: input.capacity,
          version: 0,
          status: "WAITING",
          expiresAt: at + options.ttlSeconds * 1000,
          startedMatchId: null,
          members: [{ userId: actor, seat: 0, joinedAt: at, joinedVersion: 0 }],
        };
        await db.room.create({
          data: {
            id: room.id,
            gameId: room.gameId,
            hostUserId: actor,
            capacity: room.capacity,
            status: room.status,
            expiresAt: new Date(room.expiresAt),
            inviteCode: randomBytes(32).toString("base64url"),
            schemaVersion: 1,
            stateVersion: 0,
            createdAt: new Date(at),
          },
        });
        await db.roomMember.create({
          data: {
            roomId: room.id,
            userId: actor,
            seat: 0,
            joinedAt: new Date(at),
            joinedVersion: 0,
          },
        });
        return record(db, actor, "create", input, room);
      }),
    read: (id) => transaction((db) => current(db, id)),
    // STARTING/STARTED/CLOSED cannot expire; recovery only needs a consistent roster, not a write lane.
    startSnapshot: (id) => transaction((db) => load(db, id), true),
    latestForMember: (userId, gameId) =>
      transaction(async (db) => {
        const memberships = await db.roomMember.findMany({
          where: { userId },
          select: { roomId: true },
        });
        if (!memberships.length) return null;
        const row = await db.room.findFirst({
          where: {
            gameId,
            id: { in: memberships.map((member) => member.roomId) },
            OR: [
              { status: { in: ["WAITING", "FULL"] }, expiresAt: { gt: new Date(now()) } },
              { status: { in: ["STARTING", "STARTED"] } },
            ],
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        return row ? current(db, row.id) : null;
      }),
    invitation: (input) =>
      transaction(async (db) => {
        const row =
          "roomId" in input
            ? await db.room.findUnique({
                where: { id: input.roomId },
                select: { id: true, inviteCode: true },
              })
            : await db.room.findUnique({
                where: { inviteCode: input.inviteCode },
                select: { id: true, inviteCode: true },
              });
        if (!row) return null;
        const room = await current(db, row.id);
        if (!room || !["WAITING", "FULL"].includes(room.status)) return null;
        return { room, inviteCode: row.inviteCode };
      }),
    command: (actor, kind, input) =>
      transaction(async (db) => {
        const cached = await receipt(db, actor, kind, input);
        if (cached) return cached;
        const room = await current(db, input.roomId);
        if (!room) throw new RoomFault("NOT_FOUND");
        const changed = transition(room, actor, kind, input.expectedVersion, now());
        await save(db, room, changed);
        return record(db, actor, kind, input, changed);
      }),
    confirmStarted: (id, version, matchId) =>
      transaction(async (db) => {
        const room = await load(db, id);
        if (!room) throw new RoomFault("NOT_FOUND");
        await save(db, room, confirmStarted(room, version, matchId));
      }),
    closeStarted: (id, matchId) =>
      transaction(async (db) => {
        const room = await load(db, id);
        if (!room) throw new RoomFault("NOT_FOUND");
        await save(db, room, closeStarted(room, matchId));
      }),
    expire: (id) =>
      transaction(async (db) => {
        await current(db, id);
      }),
  };
}
