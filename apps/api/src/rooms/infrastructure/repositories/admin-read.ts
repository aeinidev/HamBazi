import type { createDatabase } from "@hambazi/database";
export function createRoomsAdminReadRepository(database: ReturnType<typeof createDatabase>) {
  const scope = database.forModule("rooms");
  return async (
    query: { cursor?: string; limit: number; id?: string },
    games: readonly string[] | null,
    excluded: readonly string[] = [],
  ) => {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50)
      throw new Error("ADMIN_READ_INVALID");
    const rows =
      games === null
        ? await scope.execute((db) =>
            db.room.findMany({
              where: {
                id: query.id ?? { gt: query.cursor ?? "00000000-0000-0000-0000-000000000000" },
                gameId: { notIn: [...excluded] },
              },
              orderBy: { id: "asc" },
              take: query.limit + 1,
              select: { id: true, status: true, gameId: true, stateVersion: true },
            }),
          )
        : await scope.execute((db) =>
            db.room.findMany({
              where: {
                id: query.id ?? { gt: query.cursor ?? "00000000-0000-0000-0000-000000000000" },
                gameId: { in: [...games], notIn: [...excluded] },
              },
              orderBy: { id: "asc" },
              take: query.limit + 1,
              select: { id: true, status: true, gameId: true, stateVersion: true },
            }),
          );
    return {
      schemaVersion: 1 as const,
      asOf: new Date().toISOString(),
      items: rows.slice(0, query.limit).map((row) => ({
        id: row.id,
        label: row.gameId,
        status: row.status,
        gameId: row.gameId,
        version: row.stateVersion,
      })),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null,
    };
  };
}
