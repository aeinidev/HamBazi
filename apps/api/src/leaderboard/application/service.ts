import { z } from "zod";
import { createErrorEnvelope } from "@hambazi/contracts";
import type { UserIdentityPort, PublicNamesPort } from "../../users/index.js";
import {
  leaderboardQuerySchema,
  leaderboardResponseSchema,
  periodKey,
  statsQuerySchema,
  statsResponseSchema,
} from "./contracts.js";
export interface StatisticsReadRepository {
  own(userId: string, period: string): Promise<z.infer<typeof statsResponseSchema>["games"]>;
  board(
    gameId: string,
    period: string,
    offset: number,
    limit: number,
  ): Promise<{
    entries: readonly { userId: string; rank: string; wins: string }[];
    nextOffset: number | null;
  }>;
}
export function statisticsService(deps: {
  repository: StatisticsReadRepository;
  users: UserIdentityPort;
  names: PublicNamesPort;
  clock: { nowMs(): number };
}) {
  async function identity(userId: unknown) {
    const id = z.uuid().safeParse(userId);
    return id.success && (await deps.users.findActiveById(id.data)) ? id.data.toLowerCase() : null;
  }
  return Object.freeze({
    async own(userId: unknown, query: unknown) {
      try {
        const actor = await identity(userId);
        if (!actor) return createErrorEnvelope("UNAUTHENTICATED");
        const parsed = statsQuerySchema.safeParse(query);
        if (!parsed.success) return createErrorEnvelope("INVALID_INPUT");
        const period = periodKey(parsed.data.period, deps.clock.nowMs());
        return {
          ok: true as const,
          value: statsResponseSchema.parse({
            schemaVersion: 1,
            period,
            games: await deps.repository.own(actor, period),
          }),
        };
      } catch {
        return createErrorEnvelope("INTERNAL_ERROR");
      }
    },
    async board(userId: unknown, gameId: unknown, query: unknown) {
      try {
        if (!(await identity(userId))) return createErrorEnvelope("UNAUTHENTICATED");
        const game = z
          .string()
          .regex(/^[a-z][a-z0-9-]{0,63}$/)
          .safeParse(gameId);
        const parsed = leaderboardQuerySchema.safeParse(query);
        if (!game.success || !parsed.success) return createErrorEnvelope("INVALID_INPUT");
        if (game.data !== "coup") return createErrorEnvelope("NOT_FOUND");
        const period = periodKey(parsed.data.period, deps.clock.nowMs());
        const page = await deps.repository.board(
          game.data,
          period,
          parsed.data.offset,
          parsed.data.limit,
        );
        const names = await deps.names.find(page.entries.map((r) => r.userId));
        return {
          ok: true as const,
          value: leaderboardResponseSchema.parse({
            schemaVersion: 1,
            gameId: game.data,
            metric: "wins",
            period,
            entries: page.entries.map((r) => ({
              ...r,
              displayName: names.find((n) => n.userId === r.userId)?.displayName ?? "Player",
            })),
            nextOffset: page.nextOffset,
          }),
        };
      } catch {
        return createErrorEnvelope("INTERNAL_ERROR");
      }
    },
  });
}
export type StatisticsPort = ReturnType<typeof statisticsService>;
