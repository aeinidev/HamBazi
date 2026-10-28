import { hash } from "node:crypto";
import { z } from "zod";
import { createErrorEnvelope, type ErrorEnvelope } from "@hambazi/contracts";
import { currentCorrelation, createCorrelation, withCorrelation } from "@hambazi/observability";
import {
  roomStartSnapshotSchema,
  roomStartPageSchema,
  roomCommandSchema,
  type RoomStartSnapshot,
  type RoomsPort,
} from "../../rooms/index.js";
import type { CatalogPort } from "../../games/index.js";
import type { UserIdentityPort } from "../../users/index.js";
import { executableDescriptorSchema, type ExecutableDescriptor } from "./admission.js";
import { matchStatuses } from "../domain/lifecycle.js";
import { matchReadySchema, matchCommandSchema, type MatchProcessingPort } from "./processing.js";
import type { MatchCorrelation } from "./correlation.js";

const uuid = z.uuid().transform((value) => value.toLowerCase());
export const privateRoomMatchSchema = z.strictObject({
  schemaVersion: z.literal(1),
  matchId: uuid,
  roomId: uuid,
  gameId: z.string().min(1),
  startVersion: z.number().int().min(1).max(2147483645),
  stateVersion: z.number().int().min(0).max(2147483647),
  status: z.enum(matchStatuses),
  descriptor: executableDescriptorSchema,
  readyUserIds: z.array(uuid).max(64).optional(),
  players: z
    .array(z.strictObject({ userId: uuid, seat: z.number().int().nonnegative() }))
    .min(2)
    .max(64),
});
export const privateRoomReadinessSchema = z.strictObject({
  schemaVersion: z.literal(1),
  roomId: uuid,
  matchId: uuid.nullable(),
  stateVersion: z.number().int().nonnegative().nullable(),
  status: z.enum(matchStatuses).nullable(),
  canStart: z.boolean(),
  players: z.array(z.strictObject({ userId: uuid, ready: z.boolean() })).max(64),
});
export type PrivateRoomMatch = z.infer<typeof privateRoomMatchSchema>;
type Code = Parameters<typeof createErrorEnvelope>[0];
export class PrivateRoomMatchFault extends Error {
  constructor(readonly code: Code) {
    super(code);
  }
}
export interface PrivateRoomMatchRepository {
  read(roomId: string): Promise<PrivateRoomMatch | null>;
  roomForMatch(matchId: string): Promise<string | null>;
  create(
    snapshot: RoomStartSnapshot,
    descriptor: ExecutableDescriptor,
    correlation: MatchCorrelation,
  ): Promise<PrivateRoomMatch>;
}
// Version is part of the intent identity, so a conflicting writer never reuses
// an action ID with different expectedVersion. No credentials/randomness enter it.
function actionId(match: PrivateRoomMatch, operation: string) {
  const hex = hash(
    "sha256",
    JSON.stringify(["private-room-v1", match.matchId, operation, match.stateVersion]),
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function privateRoomMatchService(deps: {
  repository: PrivateRoomMatchRepository;
  /** Explicit host launch after durable readiness; opt-in, defaults preserve existing games. */
  manualStart?: boolean;
  rooms: Pick<
    RoomsPort,
    "start" | "read" | "startSnapshot" | "listStartWork" | "confirmStarted" | "closeStarted"
  >;
  processing: MatchProcessingPort;
  users: UserIdentityPort;
  games: Pick<CatalogPort, "find">;
  descriptor(input: { gameId: string; capacity: number }): Promise<ExecutableDescriptor | null>;
}) {
  function fault(code: Code): never {
    throw new PrivateRoomMatchFault(code);
  }
  function accepted<T extends { ok: true } | { ok: false; error: { code: string } }>(
    result: T,
  ): Extract<T, { ok: true }> {
    if (!result.ok) {
      // Only stable codes from owning ports escape, never arbitrary diagnostics.
      if ("error" in result) {
        try {
          createErrorEnvelope(result.error.code as Code);
        } catch {
          fault("INTERNAL_ERROR");
        }
        fault(result.error.code as Code);
      }
      fault("INTERNAL_ERROR");
    }
    return result as Extract<T, { ok: true }>;
  }
  async function safe<T>(operation: () => Promise<T>): Promise<T | ErrorEnvelope<Code>> {
    try {
      return await withCorrelation(currentCorrelation() ?? createCorrelation(), operation);
    } catch (error) {
      return createErrorEnvelope(
        error instanceof PrivateRoomMatchFault ? error.code : "INTERNAL_ERROR",
      );
    }
  }
  async function descriptor(gameId: string, capacity: number) {
    const result = accepted(await deps.games.find(gameId));
    const game = result.game;
    if (
      game.id !== gameId ||
      game.status !== "ACTIVE" ||
      !game.playable ||
      !game.privateRoomsEnabled ||
      capacity < game.minPlayers ||
      capacity > game.maxPlayers
    )
      fault("GAME_UNAVAILABLE");
    const selected = await deps.descriptor({ gameId, capacity });
    if (selected === null) fault("INCOMPATIBLE_GAME_VERSION");
    const parsed = executableDescriptorSchema.safeParse(selected);
    if (!parsed.success) fault("INCOMPATIBLE_GAME_VERSION");
    return parsed.data;
  }
  function verify(snapshot: RoomStartSnapshot, match: PrivateRoomMatch) {
    if (
      snapshot.roomId !== match.roomId ||
      snapshot.gameId !== match.gameId ||
      snapshot.startVersion !== match.startVersion ||
      (snapshot.startedMatchId !== null && snapshot.startedMatchId !== match.matchId) ||
      JSON.stringify(snapshot.players) !== JSON.stringify(match.players)
    )
      fault("ROOM_CONFLICT");
  }
  async function advance(roomId: string) {
    const snapshot = roomStartSnapshotSchema.parse(
      accepted(await deps.rooms.startSnapshot(roomId)).snapshot,
    );
    let match = await deps.repository.read(roomId);
    if (!match) {
      if (snapshot.status !== "STARTING") fault("ROOM_CONFLICT");
      const pins = await descriptor(snapshot.gameId, snapshot.capacity);
      for (const player of snapshot.players)
        if (!(await deps.users.findActiveById(player.userId))) fault("FORBIDDEN");
      match = await deps.repository.create(
        snapshot,
        pins,
        currentCorrelation() ?? createCorrelation(),
      );
    }
    verify(snapshot, match);
    if (snapshot.status === "CLOSED" && !["FINISHED", "TERMINATED"].includes(match.status))
      fault("ROOM_CONFLICT");
    // Both owners already confirm the durable active binding. Recovery has no
    // transition to perform; do not repeat the same projections on every sweep.
    // Terminal states still pass through the closure path below.
    if (snapshot.status === "STARTED" && match.status === "ACTIVE")
      return { ok: true as const, matchId: match.matchId };
    for (let step = 0; step < 8; step++) {
      // The initial binding is already validated; refresh after a transition or conflict.
      if (step > 0) match = await deps.repository.read(roomId);
      if (!match) fault("INTERNAL_ERROR");
      verify(snapshot, match);
      let operation: "WAIT" | "START" | "ACTIVATE" | undefined;
      if (match.status === "CREATED") operation = "WAIT";
      else {
        const room = roomStartSnapshotSchema.parse(
          accepted(await deps.rooms.startSnapshot(roomId)).snapshot,
        );
        verify(room, match);
        if (room.status === "STARTING") {
          const result = await deps.rooms.confirmStarted(roomId, match.startVersion, match.matchId);
          if (!result.ok && result.error.code === "ROOM_CONFLICT") continue;
          accepted(result);
        } else if (room.status === "CLOSED" && !["FINISHED", "TERMINATED"].includes(match.status))
          fault("ROOM_CONFLICT");
        if (match.status === "READY" && !deps.manualStart) operation = "START";
        else if (match.status === "STARTING") operation = "ACTIVATE";
        else if (["FINISHED", "TERMINATED"].includes(match.status)) {
          accepted(await deps.rooms.closeStarted(roomId, match.matchId));
          return { ok: true as const, matchId: match.matchId };
        } else return { ok: true as const, matchId: match.matchId };
      }
      const result = await deps.processing.lifecycle({
        schemaVersion: 1,
        matchId: match.matchId,
        actionId: actionId(match, operation),
        expectedVersion: match.stateVersion,
        operation,
      });
      if (!result.ok && result.error.code === "GAME_STATE_CONFLICT") continue;
      accepted(result);
    }
    fault("GAME_STATE_CONFLICT");
  }
  async function follow(matchId: string) {
    const roomId = await deps.repository.roomForMatch(matchId);
    if (roomId !== null) await advance(roomId);
  }
  const hostLifecycle = (identity: unknown, input: unknown, operation: "START" | "TERMINATE") =>
    safe(async () => {
      const request = matchReadySchema.safeParse(input),
        actor = uuid.safeParse(identity);
      if (!deps.manualStart || !request.success || !actor.success) fault("INVALID_INPUT");
      const roomId = await deps.repository.roomForMatch(request.data.matchId);
      if (!roomId) fault("NOT_FOUND");
      const room = accepted(await deps.rooms.read(actor.data, roomId)).room;
      if (room.hostUserId !== actor.data) fault("FORBIDDEN");
      if (
        room.startedMatchId !== request.data.matchId ||
        !["STARTED", "CLOSED"].includes(room.status)
      )
        fault("ROOM_CONFLICT");
      const snapshot = roomStartSnapshotSchema.parse(
        accepted(await deps.rooms.startSnapshot(roomId)).snapshot,
      );
      const match = await deps.repository.read(roomId);
      if (!match) fault("NOT_FOUND");
      verify(snapshot, match);
      if (snapshot.status === "CLOSED" && !["FINISHED", "TERMINATED"].includes(match.status))
        fault("ROOM_CONFLICT");
      // Match owner locks the row, verifies version and every durable readyAt,
      // and records an idempotent receipt before activation/recovery follows.
      if (
        operation === "TERMINATE" &&
        !["WAITING_FOR_PLAYERS", "READY", "TERMINATED"].includes(match.status)
      )
        fault("GAME_STATE_CONFLICT");
      const result = await deps.processing.lifecycle({ ...request.data, operation });
      if (!result.ok) return result;
      await advance(roomId);
      return result;
    });
  return Object.freeze({
    readiness: (identity: unknown, roomId: unknown) =>
      safe(async () => {
        const room = accepted(await deps.rooms.read(identity, roomId)).room;
        const match = await deps.repository.read(room.id);
        return {
          ok: true as const,
          value: privateRoomReadinessSchema.parse({
            schemaVersion: 1,
            roomId: room.id,
            matchId: match?.matchId ?? null,
            stateVersion: match?.stateVersion ?? null,
            status: match?.status ?? null,
            canStart:
              !!match &&
              ["WAITING_FOR_PLAYERS", "READY"].includes(match.status) &&
              match.players.length === room.members.length &&
              match.players.every((p) => match.readyUserIds?.includes(p.userId)),
            players: room.members.map((p) => ({
              userId: p.userId,
              ready: match?.readyUserIds?.includes(p.userId) ?? false,
            })),
          }),
        };
      }),
    begin: (identity: unknown, input: unknown) => hostLifecycle(identity, input, "START"),
    cancel: (identity: unknown, input: unknown) => hostLifecycle(identity, input, "TERMINATE"),
    start: (identity: unknown, input: unknown) =>
      safe(async () => {
        const parsed = roomCommandSchema.safeParse(input);
        const actor = uuid.safeParse(identity);
        if (parsed.success && actor.success) {
          const read = await deps.rooms.read(actor.data, parsed.data.roomId);
          if (
            read.ok &&
            read.room.status === "FULL" &&
            read.room.hostUserId === actor.data &&
            read.room.version === parsed.data.expectedVersion
          )
            await descriptor(read.room.gameId, read.room.capacity);
        }
        const ack = accepted(await deps.rooms.start(identity, input));
        await advance(ack.roomId);
        return ack;
      }),
    ready: (identity: unknown, input: unknown, context?: unknown) =>
      safe(async () => {
        const result = await deps.processing.ready(identity, input, context);
        if (!result.ok) return result;
        await follow(matchReadySchema.parse(input).matchId);
        return result;
      }),
    command: (identity: unknown, input: unknown, context?: unknown) =>
      safe(async () => {
        const result = await deps.processing.command(identity, input, context);
        if (!result.ok) return result;
        if (result.value.status === "FINISHED")
          await follow(matchCommandSchema.parse(input).matchId);
        return result;
      }),
    // Recovery authority is never exposed over a player transport.
    resume: (roomId: unknown) =>
      safe(() => {
        const parsed = uuid.safeParse(roomId);
        if (!parsed.success) fault("INVALID_INPUT");
        return advance(parsed.data);
      }),
    recover: (input: unknown) =>
      safe(async () => {
        const parsed = roomStartPageSchema.safeParse(input);
        if (!parsed.success) fault("INVALID_INPUT");
        const page = accepted(await deps.rooms.listStartWork(parsed.data));
        const results: { roomId: string; ok: boolean; errorCode?: Code }[] = [];
        for (const roomId of page.roomIds) {
          const result = await safe(() => advance(roomId));
          results.push(
            result.ok ? { roomId, ok: true } : { roomId, ok: false, errorCode: result.error.code },
          );
        }
        return { ok: true as const, nextRoomId: page.nextRoomId, results };
      }),
  });
}
export type PrivateRoomMatchPort = ReturnType<typeof privateRoomMatchService>;
