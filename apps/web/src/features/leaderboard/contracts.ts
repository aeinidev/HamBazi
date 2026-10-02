import { z } from "zod";
const count = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
const gameId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const period = z.string().regex(/^(all_time|week:\d{4}-\d{2}-\d{2})$/);
export const ownStatsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    period,
    games: z
      .array(
        z
          .strictObject({ gameId, completed: count, wins: count, losses: count })
          .refine((r) => BigInt(r.wins) + BigInt(r.losses) === BigInt(r.completed)),
      )
      .max(100),
  })
  .refine((r) => new Set(r.games.map((g) => g.gameId)).size === r.games.length);
export const leaderboardSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    gameId,
    metric: z.literal("wins"),
    period,
    entries: z
      .array(
        z.strictObject({
          userId: z.uuid(),
          displayName: z.string().min(1).max(256),
          rank: count,
          wins: count,
        }),
      )
      .max(50),
    nextOffset: z.number().int().min(0).max(1000000).nullable(),
  })
  .refine((r) => new Set(r.entries.map((e) => e.userId)).size === r.entries.length);
