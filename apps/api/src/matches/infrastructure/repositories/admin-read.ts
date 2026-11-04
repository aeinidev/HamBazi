import {
  adminMatchPageSchema,
  adminMatchDetailSchema,
  type AdminMatchSearchQuery,
  type AdminMatchPage,
  type AdminMatchDetail,
} from "@hambazi/validation";
import type { createDatabase } from "@hambazi/database";
export function createMatchesAdminReadRepository(database: ReturnType<typeof createDatabase>) {
  const scope = database.forModule("matches");
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
            db.match.findMany({
              where: {
                id: query.id ?? { gt: query.cursor ?? "00000000-0000-0000-0000-000000000000" },
                gameId: { notIn: [...excluded] },
              },
              orderBy: { id: "asc" },
              take: query.limit + 1,
              select: {
                id: true,
                status: true,
                gameId: true,
                stateVersion: true,
                engineVersion: true,
                stateSchemaVersion: true,
                rulesetVersion: true,
              },
            }),
          )
        : await scope.execute((db) =>
            db.match.findMany({
              where: {
                id: query.id ?? { gt: query.cursor ?? "00000000-0000-0000-0000-000000000000" },
                gameId: { in: [...games], notIn: [...excluded] },
              },
              orderBy: { id: "asc" },
              take: query.limit + 1,
              select: {
                id: true,
                status: true,
                gameId: true,
                stateVersion: true,
                engineVersion: true,
                stateSchemaVersion: true,
                rulesetVersion: true,
              },
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
        pins: {
          engineVersion: row.engineVersion,
          stateSchemaVersion: row.stateSchemaVersion,
          rulesetVersion: row.rulesetVersion,
        },
      })),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null,
    };
  };
}

export function createMatchesAdminManagementRead(database: ReturnType<typeof createDatabase>) {
  const scope = database.forModule("matches");
  function read(
    query: AdminMatchSearchQuery,
    games: readonly string[] | null,
    excluded: readonly string[],
  ): Promise<AdminMatchPage>;
  function read(
    query: AdminMatchSearchQuery,
    games: readonly string[] | null,
    excluded: readonly string[],
    id: string,
  ): Promise<AdminMatchDetail | null>;
  async function read(
    query: AdminMatchSearchQuery,
    games: readonly string[] | null,
    excluded: readonly string[],
    id?: string,
  ) {
    const limit = id === undefined ? (query.limit ?? 25) : 1;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("ADMIN_READ_INVALID");
    const rows = await scope.snapshot((db) =>
      db.readAdminMatches(
        { ...query, limit, ...(id === undefined ? {} : { id }) },
        games,
        excluded,
      ),
    );
    const asOf = new Date().toISOString();
    const items = rows
      .slice(0, limit)
      .map(
        ({
          stateVersion,
          createdAt,
          updatedAt,
          startedAt,
          finishedAt,
          engineVersion,
          stateSchemaVersion,
          rulesetVersion,
          ...row
        }) => ({
          ...row,
          version: stateVersion,
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
          startedAt: startedAt?.toISOString() ?? null,
          finishedAt: finishedAt?.toISOString() ?? null,
          pins: { engineVersion, stateSchemaVersion, rulesetVersion },
        }),
      );
    if (id !== undefined)
      return items[0]
        ? adminMatchDetailSchema.parse({ schemaVersion: 1, asOf, item: items[0] })
        : null;
    return adminMatchPageSchema.parse({
      schemaVersion: 1,
      asOf,
      items,
      nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
    });
  }
  return {
    search: (
      query: AdminMatchSearchQuery,
      games: readonly string[] | null,
      excluded: readonly string[] = [],
    ) => read(query, games, excluded),
    detail: (id: string, games: readonly string[] | null, excluded: readonly string[] = []) =>
      read({}, games, excluded, id),
  };
}
