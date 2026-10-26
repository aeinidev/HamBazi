import type { createDatabase } from "@hambazi/database";
export function createGamesAdminReadRepository(database: ReturnType<typeof createDatabase>) {
  const scope = database.forModule("games");
  return async (
    query: { cursor?: string; limit: number; id?: string },
    games: readonly string[] | null,
  ) => {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50)
      throw new Error("ADMIN_READ_INVALID");
    const rows =
      games === null
        ? await scope.execute((db) =>
            db.game.findMany({
              where: { id: query.id ?? { gt: query.cursor ?? "" } },
              orderBy: { id: "asc" },
              take: query.limit + 1,
              select: { id: true, status: true, title: true },
            }),
          )
        : await scope.execute((db) =>
            db.game.findMany({
              where: {
                AND: [{ id: query.id ?? { gt: query.cursor ?? "" } }, { id: { in: [...games] } }],
              },
              orderBy: { id: "asc" },
              take: query.limit + 1,
              select: { id: true, status: true, title: true },
            }),
          );
    return {
      schemaVersion: 1 as const,
      asOf: new Date().toISOString(),
      items: rows.slice(0, query.limit).map((row) => ({
        id: row.id,
        label: row.title,
        status: row.status,
        gameId: row.id,
        version: null,
      })),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null,
    };
  };
}
