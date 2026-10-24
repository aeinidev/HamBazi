import { hash } from "node:crypto";
import { z } from "zod";
import { createErrorEnvelope } from "@hambazi/contracts";
import { matchReadySchema, type MatchProcessingPort } from "./processing.js";

export const publicLobbySchema = z.strictObject({
  schemaVersion: z.literal(1),
  matchId: z.uuid(),
  gameId: z.string(),
  stateVersion: z.number().int().nonnegative(),
  status: z.enum([
    "CREATED",
    "WAITING_FOR_PLAYERS",
    "READY",
    "STARTING",
    "ACTIVE",
    "FINISHED",
    "TERMINATED",
  ]),
  hostUserId: z.uuid(),
  players: z
    .array(
      z.strictObject({
        userId: z.uuid(),
        seat: z.number().int().nonnegative(),
        ready: z.boolean(),
      }),
    )
    .min(2)
    .max(64),
});
export type PublicLobby = z.infer<typeof publicLobbySchema>;
export const publicSearchSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ticketId: z.uuid(),
  status: z.enum(["SEARCHING", "RESERVED", "MATCHED"]),
  capacity: z.number().int().min(2).max(64),
  expiresAt: z.number().int().nonnegative(),
  matchId: z.uuid().nullable(),
});
export type PublicSearch = z.infer<typeof publicSearchSchema>;
export interface PublicLobbyRepository {
  read(userId: string, matchId: string): Promise<PublicLobby | null>;
  current(userId: string, gameId: string, at: number): Promise<PublicSearch | null>;
}
function action(match: PublicLobby, operation: string) {
  const h = hash("sha256", `public-lobby-v1:${match.matchId}:${match.stateVersion}:${operation}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function publicLobbyService(
  repository: PublicLobbyRepository,
  processing: MatchProcessingPort,
  options: { gameId: string; clock: { nowMs(): number } },
) {
  async function read(identity: unknown, matchId: unknown) {
    const u = z.uuid().safeParse(identity),
      m = z.uuid().safeParse(matchId);
    if (!u.success || !m.success) return createErrorEnvelope("INVALID_INPUT");
    try {
      let value = await repository.read(u.data, m.data);
      if (!value || value.gameId !== options.gameId) return createErrorEnvelope("NOT_FOUND");
      // Durable, idempotent recovery on every member read, including after API restart.
      for (let step = 0; step < 2; step++) {
        const operation =
          value.status === "CREATED" ? "WAIT" : value.status === "STARTING" ? "ACTIVATE" : null;
        if (!operation) break;
        const result = await processing.lifecycle({
          schemaVersion: 1,
          matchId: value.matchId,
          expectedVersion: value.stateVersion,
          actionId: action(value, operation),
          operation,
        });
        if (!result.ok && result.error.code !== "GAME_STATE_CONFLICT") return result;
        const next = await repository.read(u.data, m.data);
        if (!next) return createErrorEnvelope("NOT_FOUND");
        value = next;
      }
      return { ok: true as const, value };
    } catch {
      return createErrorEnvelope("INTERNAL_ERROR");
    }
  }
  async function hostLifecycle(
    identity: unknown,
    input: unknown,
    operation: "START" | "TERMINATE",
  ) {
    const parsed = matchReadySchema.safeParse(input);
    if (!parsed.success) return createErrorEnvelope("INVALID_INPUT");
    const lobby = await read(identity, parsed.data.matchId);
    if (!lobby.ok) return lobby;
    if (lobby.value.hostUserId !== identity) return createErrorEnvelope("FORBIDDEN");
    if (
      operation === "TERMINATE" &&
      !["WAITING_FOR_PLAYERS", "READY", "TERMINATED"].includes(lobby.value.status)
    )
      return createErrorEnvelope("GAME_STATE_CONFLICT");
    const started = await processing.lifecycle({ ...parsed.data, operation });
    if (!started.ok) return started;
    return read(identity, parsed.data.matchId);
  }
  return Object.freeze({
    read,
    async current(identity: unknown) {
      const user = z.uuid().safeParse(identity);
      if (!user.success) return createErrorEnvelope("INVALID_INPUT");
      try {
        return {
          ok: true as const,
          value: await repository.current(user.data, options.gameId, options.clock.nowMs()),
        };
      } catch {
        return createErrorEnvelope("INTERNAL_ERROR");
      }
    },
    begin: (identity: unknown, input: unknown) => hostLifecycle(identity, input, "START"),
    cancel: (identity: unknown, input: unknown) => hostLifecycle(identity, input, "TERMINATE"),
  });
}
export type PublicLobbyPort = ReturnType<typeof publicLobbyService>;
