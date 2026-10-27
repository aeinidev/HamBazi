import type { createDatabase } from "@hambazi/database";
export function createUsersAdminReadRepository(database: ReturnType<typeof createDatabase>) {
  const scope = database.forModule("users");
  return async (
    query: { cursor?: string; limit: number; id?: string },
    games: readonly string[] | null,
    excluded: readonly string[] = [],
  ) => {
    if (games !== null || excluded.length !== 0) throw new Error("ADMIN_READ_INVALID");
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50)
      throw new Error("ADMIN_READ_INVALID");
    const rows = await scope.execute((db) =>
      db.user.findMany({
        where: { id: query.id ?? { gt: query.cursor ?? "00000000-0000-0000-0000-000000000000" } },
        orderBy: { id: "asc" },
        take: query.limit + 1,
        select: { id: true, status: true, displayName: true, profileVersion: true },
      }),
    );
    return {
      schemaVersion: 1 as const,
      asOf: new Date().toISOString(),
      items: rows.slice(0, query.limit).map((row) => ({
        id: row.id,
        label: row.displayName,
        status: row.status,
        gameId: null,
        version: row.profileVersion,
      })),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null,
    };
  };
}
