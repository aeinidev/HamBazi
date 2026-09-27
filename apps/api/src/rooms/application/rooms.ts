import { z } from "zod";
import { createErrorEnvelope, type ErrorEnvelope } from "@hambazi/contracts";
import type { UserIdentityPort } from "../../users/index.js";
import type { CatalogPort } from "../../games/index.js";
import { RoomFault, type Room, type RoomCode } from "../domain/room.js";
const uuid = z.uuid().transform((v) => v.toLowerCase());
const version = z.number().int().min(0).max(2147483646);
export const createRoomSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: uuid,
  gameId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  capacity: z.number().int().min(2).max(2147483647),
});
export const roomCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: uuid,
  roomId: uuid,
  expectedVersion: version,
});
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type RoomCommand = z.infer<typeof roomCommandSchema>;
export type Ack = {
  ok: true;
  schemaVersion: 1;
  commandId: string;
  roomId: string;
  appliedVersion: number;
};
export type Outcome<T> = T | ErrorEnvelope<RoomCode>;
export interface RoomsRepository {
  receipt(
    actor: string,
    kind: "create" | "join" | "leave" | "start",
    input: CreateRoomInput | RoomCommand,
  ): Promise<Ack | null>;
  create(actor: string, input: CreateRoomInput): Promise<Ack>;
  read(roomId: string): Promise<Room | null>;
  command(actor: string, kind: "join" | "leave" | "start", input: RoomCommand): Promise<Ack>;
  confirmStarted(roomId: string, expectedVersion: number, matchId: string): Promise<void>;
  closeStarted(roomId: string, matchId: string): Promise<void>;
  expire(roomId: string): Promise<void>;
}
export function roomsService(deps: {
  repository: RoomsRepository;
  users: UserIdentityPort;
  games: CatalogPort;
}) {
  async function safe<T>(operation: () => Promise<T>): Promise<Outcome<T>> {
    try {
      return await operation();
    } catch (error) {
      return createErrorEnvelope(error instanceof RoomFault ? error.code : "INTERNAL_ERROR");
    }
  }
  async function actor(input: unknown) {
    const parsed = uuid.safeParse(input);
    if (!parsed.success) throw new RoomFault("UNAUTHENTICATED");
    if (!(await deps.users.findActiveById(parsed.data))) throw new RoomFault("UNAUTHENTICATED");
    return parsed.data;
  }
  function parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new RoomFault("INVALID_INPUT");
    return parsed.data;
  }
  async function admission(gameId: string, capacity: number) {
    const result = await deps.games.find(gameId);
    if (!result.ok) throw new RoomFault(result.error.code);
    const game = result.game;
    if (game.status !== "ACTIVE" || !game.playable || !game.privateRoomsEnabled)
      throw new RoomFault("GAME_UNAVAILABLE");
    if (capacity < game.minPlayers || capacity > game.maxPlayers)
      throw new RoomFault("INVALID_INPUT");
  }
  async function command(identity: unknown, kind: "join" | "leave" | "start", input: unknown) {
    return safe(async () => {
      const userId = await actor(identity);
      const parsed = parse(roomCommandSchema, input);
      const cached = await deps.repository.receipt(userId, kind, parsed);
      if (cached) return cached;
      const room = await deps.repository.read(parsed.roomId);
      if (!room) throw new RoomFault("NOT_FOUND");
      if (kind === "start") {
        if (!room.members.some((m) => m.userId === userId)) throw new RoomFault("NOT_FOUND");
        if (room.hostUserId !== userId) throw new RoomFault("FORBIDDEN");
        if (room.version !== parsed.expectedVersion) throw new RoomFault("ROOM_CONFLICT");
        for (const member of room.members) {
          if (!(await deps.users.findActiveById(member.userId))) throw new RoomFault("FORBIDDEN");
        }
      }
      if (kind !== "leave") await admission(room.gameId, room.capacity);
      return deps.repository.command(userId, kind, parsed);
    });
  }
  return {
    create(identity: unknown, input: unknown) {
      return safe(async () => {
        const userId = await actor(identity);
        const parsed = parse(createRoomSchema, input);
        const cached = await deps.repository.receipt(userId, "create", parsed);
        if (cached) return cached;
        await admission(parsed.gameId, parsed.capacity);
        return deps.repository.create(userId, parsed);
      });
    },
    read(identity: unknown, roomId: unknown) {
      return safe(async () => {
        const userId = await actor(identity);
        const room = await deps.repository.read(parse(uuid, roomId));
        if (!room || !room.members.some((m) => m.userId === userId))
          throw new RoomFault("NOT_FOUND");
        return { ok: true as const, schemaVersion: 1 as const, room };
      });
    },
    // Server-side invitation authorization is the responsibility of the future
    // Rooms invite adapter (8B). Never expose this port as an arbitrary UUID join.
    join: (identity: unknown, input: unknown) => command(identity, "join", input),
    leave: (identity: unknown, input: unknown) => command(identity, "leave", input),
    start: (identity: unknown, input: unknown) => command(identity, "start", input),
    confirmStarted(roomId: unknown, expectedVersion: unknown, matchId: unknown) {
      return safe(async () => {
        await deps.repository.confirmStarted(
          parse(uuid, roomId),
          parse(version, expectedVersion),
          parse(uuid, matchId),
        );
        return { ok: true as const };
      });
    },
    closeStarted(roomId: unknown, matchId: unknown) {
      return safe(async () => {
        await deps.repository.closeStarted(parse(uuid, roomId), parse(uuid, matchId));
        return { ok: true as const };
      });
    },
    expire(roomId: unknown) {
      return safe(async () => {
        await deps.repository.expire(parse(uuid, roomId));
        return { ok: true as const };
      });
    },
  };
}
export type RoomsPort = ReturnType<typeof roomsService>;
