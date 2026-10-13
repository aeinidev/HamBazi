import { z } from "zod";

/** Additive result contract. Existing unversioned standard results remain v1. */
export const gameResultV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    placements: z
      .array(z.strictObject({ playerId: z.uuid(), place: z.number().int().min(1).max(64) }))
      .min(2)
      .max(64),
    winnerId: z.uuid().nullable(),
    winnerIds: z.array(z.uuid()).min(1).max(64),
    outcome: z.enum(["SOLE_VICTORY", "SHARED_VICTORY"]),
    reason: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    metrics: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), z.number().finite()),
  })
  .refine((r) => {
    const ids = r.placements.map((p) => p.playerId);
    const first = r.placements.filter((p) => p.place === 1).map((p) => p.playerId);
    return (
      new Set(ids).size === ids.length &&
      new Set(r.winnerIds).size === r.winnerIds.length &&
      r.winnerIds.length === first.length &&
      r.winnerIds.every((id) => first.includes(id)) &&
      (r.winnerIds.length === 1
        ? r.outcome === "SOLE_VICTORY" && r.winnerId === r.winnerIds[0]
        : r.outcome === "SHARED_VICTORY" && r.winnerId === null)
    );
  });

/** K2 grants this producer version only to Kahroba; v1 games keep their exact shape. */
export const matchFinishedV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  matchId: z.uuid(),
  gameId: z.literal("kahroba"),
  stateVersion: z.number().int().min(0).max(2147483647),
  lastEventSeq: z.number().int().min(0).max(2147483647),
  finishedAt: z.number().int().min(0).max(253402300799999),
  engineVersion: z.string().min(1).max(64),
  stateSchemaVersion: z.number().int().min(1).max(2147483647),
  rulesetVersion: z.string().min(1).max(64),
  result: gameResultV2Schema,
});
export type GameResultV2 = z.infer<typeof gameResultV2Schema>;
