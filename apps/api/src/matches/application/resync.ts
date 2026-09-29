import { z } from "zod";
import { createErrorEnvelope, type ErrorEnvelope } from "@hambazi/contracts";
import type { MatchGame } from "./processing.js";
import { MatchFault } from "./processing.js";
import { matchStatuses } from "../domain/lifecycle.js";
const uuid = z.uuid().transform((value) => value.toLowerCase());
const counter = z.number().int().min(0).max(2147483647);
export const matchSnapshotRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  matchId: uuid,
});
export const matchCatchupRequestSchema = matchSnapshotRequestSchema.extend({ afterSeq: counter });
export const matchSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  matchId: uuid,
  stateVersion: counter,
  lastEventSeq: counter,
  status: z.enum(matchStatuses),
  role: z.enum(["PLAYER", "SPECTATOR"]),
  gameId: z.string(),
  engineVersion: z.string(),
  stateSchemaVersion: counter,
  rulesetVersion: z.string(),
  view: z.json().nullable(),
});
// Public invalidations deliberately carry no internal event type or payload.
export const matchDeliveryEventSchema = z.strictObject({
  schemaVersion: z.literal(1),
  eventId: uuid,
  matchId: uuid,
  type: z.literal("MATCH_INVALIDATED_V1"),
  seq: counter.min(1),
  stateVersion: counter,
  payload: z.strictObject({}),
});
export const matchCatchupSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mode: z.enum(["EVENTS", "SNAPSHOT"]),
  events: z.array(matchDeliveryEventSchema).max(100),
  snapshot: matchSnapshotSchema,
});
export type MatchSnapshot = z.infer<typeof matchSnapshotSchema>;
export type MatchCatchup = z.infer<typeof matchCatchupSchema>;
/** A pinned, trusted game adapter must construct and validate a recipient-safe view. */
export interface MatchViewGame extends Pick<MatchGame, "gameId" | "descriptor" | "restore"> {
  project(
    state: unknown,
    userId: string,
    role: "PLAYER" | "SPECTATOR",
  ): z.infer<ReturnType<typeof z.json>>;
}
export interface MatchResyncRepository {
  read(userId: string, matchId: string, afterSeq?: number): Promise<MatchCatchup>;
}
export function matchResyncService(repository: MatchResyncRepository) {
  async function read(
    identity: unknown,
    input: unknown,
    catchup: boolean,
  ): Promise<{ ok: true; value: MatchCatchup } | ErrorEnvelope> {
    const actor = uuid.safeParse(identity);
    const request = (catchup ? matchCatchupRequestSchema : matchSnapshotRequestSchema).safeParse(
      input,
    );
    if (!actor.success) return createErrorEnvelope("UNAUTHENTICATED");
    if (!request.success) return createErrorEnvelope("INVALID_INPUT");
    try {
      return {
        ok: true,
        value: matchCatchupSchema.parse(
          await repository.read(
            actor.data,
            request.data.matchId,
            "afterSeq" in request.data ? (request.data.afterSeq as number) : undefined,
          ),
        ),
      };
    } catch (error) {
      return createErrorEnvelope(error instanceof MatchFault ? error.code : "INTERNAL_ERROR");
    }
  }
  return Object.freeze({
    snapshot: async (identity: unknown, input: unknown) => {
      const result = await read(identity, input, false);
      return result.ok ? { ok: true as const, value: result.value.snapshot } : result;
    },
    catchup: (identity: unknown, input: unknown) => read(identity, input, true),
  });
}
export type MatchResyncPort = ReturnType<typeof matchResyncService>;
