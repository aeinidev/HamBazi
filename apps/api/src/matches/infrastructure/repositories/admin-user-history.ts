import type { createDatabase } from "@hambazi/database";
/** Explicit summary projection: never loads state, events, metrics or another player's result. */
export function createAdminUserHistoryRepository(database: ReturnType<typeof createDatabase>) {
  const scope = database.forModule("matches");
  return async (userId: string, cursor?: string, limit = 25) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("ADMIN_READ_INVALID");
    const players = await scope.execute((db) =>
      db.matchPlayer.findMany({
        where: { userId, matchId: { gt: cursor ?? "00000000-0000-0000-0000-000000000000" } },
        orderBy: { matchId: "asc" },
        take: limit + 1,
        select: { matchId: true },
      }),
    );
    const ids = players.slice(0, limit).map((p) => p.matchId);
    const matches = await scope.execute((db) =>
      db.match.findMany({
        where: { id: { in: ids } },
        select: { id: true, gameId: true, status: true, startedAt: true, finishedAt: true },
      }),
    );
    const results = await scope.execute((db) =>
      db.gameResult.findMany({
        where: { matchId: { in: ids }, userId },
        select: { matchId: true, placement: true, winner: true },
      }),
    );
    return {
      schemaVersion: 1 as const,
      items: ids.map((id) => {
        const m = matches.find((row) => row.id === id),
          result = results.find((row) => row.matchId === id);
        if (!m) throw new Error("ADMIN_READ_INVALID");
        return {
          id: m.id,
          gameId: m.gameId,
          status: m.status,
          startedAt: m.startedAt?.toISOString() ?? null,
          finishedAt: m.finishedAt?.toISOString() ?? null,
          placement: result?.placement ?? null,
          winner: result?.winner ?? null,
        };
      }),
      nextCursor: players.length > limit ? players[limit - 1]!.matchId : null,
    };
  };
}
