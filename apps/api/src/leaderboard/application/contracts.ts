import { matchFinishedV2Schema } from "@hambazi/validation";
import { z } from "zod";
export const countSchema = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
const gameId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const queryInteger = (max: number) =>
  z
    .string()
    .regex(/^(0|[1-9][0-9]{0,6})$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(max));
export const statsQuerySchema = z.strictObject({
  period: z.enum(["all_time", "weekly"]).default("all_time"),
});
export const leaderboardQuerySchema = statsQuerySchema.extend({
  offset: queryInteger(1000000).default(0),
  limit: queryInteger(50).pipe(z.number().min(1)).default(50),
});
export function periodKey(period: "all_time" | "weekly", at: number): string {
  if (!Number.isSafeInteger(at) || at < 0 || at > 253402300799999)
    throw new Error("Invalid statistics time");
  if (period === "all_time") return "all_time";
  const day = new Date(at);
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return `week:${day.toISOString().slice(0, 10)}`;
}
export const statsResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  period: z.string().regex(/^(all_time|week:\d{4}-\d{2}-\d{2})$/),
  games: z
    .array(
      z.strictObject({ gameId, completed: countSchema, wins: countSchema, losses: countSchema }),
    )
    .max(100),
});
export const leaderboardResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  gameId,
  metric: z.literal("wins"),
  period: statsResponseSchema.shape.period,
  entries: z
    .array(
      z.strictObject({
        userId: z.uuid(),
        displayName: z.string().min(1).max(256),
        rank: countSchema,
        wins: countSchema,
      }),
    )
    .max(50),
  nextOffset: z.number().int().min(0).max(1000000).nullable(),
});
// Projection input is an owned public DTO; no persistence or Matches internals are imported.
export const statsFinishV1Schema = z
  .strictObject({
    eventId: z.uuid(),
    payload: z.strictObject({
      schemaVersion: z.literal(1),
      matchId: z.uuid(),
      gameId,
      stateVersion: z.number().int().nonnegative(),
      lastEventSeq: z.number().int().nonnegative(),
      finishedAt: z.number().int().min(0).max(253402300799999),
      engineVersion: z.string().min(1).max(64),
      stateSchemaVersion: z.number().int().positive(),
      rulesetVersion: z.string().min(1).max(64),
      result: z.strictObject({
        placements: z
          .array(z.strictObject({ playerId: z.uuid(), place: z.number().int().min(1).max(64) }))
          .min(2)
          .max(64),
        winnerId: z.uuid().nullable(),
        reason: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
        metrics: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), z.number().finite()),
      }),
    }),
  })
  .refine(
    ({ payload: p }) =>
      new Set(p.result.placements.map((r) => r.playerId)).size === p.result.placements.length &&
      (p.result.winnerId === null ||
        p.result.placements.some((r) => r.playerId === p.result.winnerId && r.place === 1)),
  );
export const statsFinishSchema = z.union([
  statsFinishV1Schema,
  z.strictObject({ eventId: z.uuid(), payload: matchFinishedV2Schema }),
]);
export type StatsFinish = z.infer<typeof statsFinishSchema>;
export type StatsResponse = z.infer<typeof statsResponseSchema>;
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
