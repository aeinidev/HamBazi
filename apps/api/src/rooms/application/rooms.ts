import { z } from "zod";
import {
  buildRoomDeepLink,
  parseRoomStartParam,
  roomInviteCodePattern,
  createErrorEnvelope,
  type ErrorEnvelope,
  type RoomLaunchTarget,
} from "@hambazi/contracts";
import type { UserIdentityPort } from "../../users/index.js";
import type { CatalogPort } from "../../games/index.js";
import { RoomFault, type Room, type RoomCode } from "../domain/room.js";
import { roomStartSnapshotSchema, roomStartPageSchema } from "./start.js";
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
export const resolveInviteSchema = z.strictObject({
  schemaVersion: z.literal(1),
  startParam: z.string().max(48),
});
export const joinRoomSchema = roomCommandSchema.extend({
  inviteCode: z.string().regex(roomInviteCodePattern),
});
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type RoomCommand = z.infer<typeof roomCommandSchema> & { inviteCode?: string };
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
  latestForMember?(userId: string, gameId: string): Promise<Room | null>;
  invitation(
    input: { roomId: string } | { inviteCode: string },
  ): Promise<{ room: Room; inviteCode: string } | null>;
  command(actor: string, kind: "join" | "leave" | "start", input: RoomCommand): Promise<Ack>;
  confirmStarted(roomId: string, expectedVersion: number, matchId: string): Promise<void>;
  closeStarted(roomId: string, matchId: string): Promise<void>;
  expire(roomId: string): Promise<void>;
  listStartWork(afterRoomId: string | undefined, limit: number): Promise<string[]>;
}
export function roomsService(deps: {
  repository: RoomsRepository;
  users: UserIdentityPort;
  games: CatalogPort;
  invites?: {
    target: RoomLaunchTarget;
    consume(
      userId: string,
    ): Promise<{ allowed: true } | { allowed: false; reason: "unavailable" | "limited" }>;
  };
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
  async function inviteBudget(userId: string) {
    if (!deps.invites) throw new RoomFault("INTERNAL_ERROR");
    const decision = await deps.invites.consume(userId);
    if (!decision.allowed)
      throw new RoomFault(decision.reason === "limited" ? "RATE_LIMITED" : "INTERNAL_ERROR");
  }
  async function command(identity: unknown, kind: "join" | "leave" | "start", input: unknown) {
    return safe(async () => {
      const userId = await actor(identity);
      if (kind === "join") await inviteBudget(userId);
      const parsed = parse(kind === "join" ? joinRoomSchema : roomCommandSchema, input);
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
    current(identity: unknown, gameId: unknown) {
      return safe(async () => {
        const userId = await actor(identity);
        const game = parse(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), gameId);
        if (!deps.repository.latestForMember) throw new RoomFault("INTERNAL_ERROR");
        const room = await deps.repository.latestForMember(userId, game);
        if (room && (room.gameId !== game || !room.members.some((p) => p.userId === userId)))
          throw new RoomFault("INTERNAL_ERROR");
        return { ok: true as const, schemaVersion: 1 as const, room };
      });
    },
    shareInvite(identity: unknown, roomId: unknown) {
      return safe(async () => {
        const userId = await actor(identity);
        await inviteBudget(userId);
        const value = await deps.repository.invitation({ roomId: parse(uuid, roomId) });
        if (!value || value.room.hostUserId !== userId) throw new RoomFault("NOT_FOUND");
        return {
          ok: true as const,
          schemaVersion: deps.invites!.target.mainApp ? (2 as const) : (1 as const),
          invite: {
            roomId: value.room.id,
            expiresAt: value.room.expiresAt,
            startParam: `room_${value.inviteCode}`,
            deepLink: buildRoomDeepLink(deps.invites!.target, value.inviteCode),
          },
        };
      });
    },
    resolveInvite(identity: unknown, input: unknown) {
      return safe(async () => {
        const userId = await actor(identity);
        await inviteBudget(userId);
        const parsed = parse(resolveInviteSchema, input);
        const inviteCode = parseRoomStartParam(parsed.startParam);
        if (!inviteCode) throw new RoomFault("INVALID_INPUT");
        const value = await deps.repository.invitation({ inviteCode });
        if (!value) throw new RoomFault("NOT_FOUND");
        const { id, gameId, capacity, status, version, expiresAt } = value.room;
        return {
          ok: true as const,
          schemaVersion: 1 as const,
          room: { id, gameId, capacity, status, version, expiresAt },
        };
      });
    },
    join: (identity: unknown, input: unknown) => command(identity, "join", input),
    leave: (identity: unknown, input: unknown) => command(identity, "leave", input),
    start: (identity: unknown, input: unknown) => command(identity, "start", input),
    // Trusted Matches orchestration only. No REST/Socket route exposes these ports.
    startSnapshot(roomId: unknown) {
      return safe(async () => {
        const room = await deps.repository.read(parse(uuid, roomId));
        if (
          !room ||
          !["STARTING", "STARTED", "CLOSED"].includes(room.status) ||
          (room.status === "CLOSED" && room.startedMatchId === null)
        )
          throw new RoomFault("NOT_FOUND");
        const snapshot = roomStartSnapshotSchema.parse({
          schemaVersion: 1,
          roomId: room.id,
          gameId: room.gameId,
          capacity: room.capacity,
          startVersion:
            room.version - (room.status === "STARTED" ? 1 : room.status === "CLOSED" ? 2 : 0),
          status: room.status,
          startedMatchId: room.startedMatchId,
          players: [...room.members]
            .sort((a, b) => a.seat - b.seat)
            .map(({ userId, seat }) => ({ userId, seat })),
        });
        return { ok: true as const, snapshot };
      });
    },
    listStartWork(input: unknown) {
      return safe(async () => {
        const page = parse(roomStartPageSchema, input);
        const ids = await deps.repository.listStartWork(page.afterRoomId, page.limit + 1);
        const roomIds = ids.slice(0, page.limit);
        return {
          ok: true as const,
          roomIds,
          nextRoomId: ids.length > page.limit ? roomIds.at(-1)! : null,
        };
      });
    },
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
