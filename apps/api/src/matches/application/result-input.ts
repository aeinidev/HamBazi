import { matchFinishedV2Schema } from "@hambazi/validation";
import { z } from "zod";
const uuid = z.uuid();
const counter = z.number().int().min(0).max(2147483647);
export const standardResultInputSchema = z
  .strictObject({
    placements: z
      .array(z.strictObject({ playerId: uuid, place: z.number().int().min(1).max(64) }))
      .min(2)
      .max(64),
    winnerId: uuid.nullable(),
    reason: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    metrics: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), z.number().finite()),
  })
  .refine(
    (v) =>
      new Set(v.placements.map((p) => p.playerId)).size === v.placements.length &&
      (v.winnerId === null || v.placements.some((p) => p.playerId === v.winnerId && p.place === 1)),
  );
export const matchFinishedInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  matchId: uuid,
  gameId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  stateVersion: counter,
  lastEventSeq: counter,
  finishedAt: z.number().int().nonnegative(),
  engineVersion: z.string().min(1).max(64),
  stateSchemaVersion: counter.positive(),
  rulesetVersion: z.string().min(1).max(64),
  result: standardResultInputSchema,
});

export type FinishedResult = z.infer<typeof matchFinishedInputSchema>;

export const durableMatchFinishedSchema = z.union([
  matchFinishedInputSchema,
  matchFinishedV2Schema,
]);
export type DurableFinishedResult = z.infer<typeof durableMatchFinishedSchema>;
