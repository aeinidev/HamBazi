import {
  adminGamePageSchema,
  adminGameDetailSchema,
  type AdminGameSearchQuery,
  type AdminGamePage,
  type AdminGameDetail,
} from "@hambazi/validation";
import type { createDatabase } from "@hambazi/database";
export function createGamesAdminReadRepository(database: ReturnType<typeof createDatabase>) {
  const scope = database.forModule("games");
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
            db.game.findMany({
              where: {
                AND: [
                  { id: query.id ?? { gt: query.cursor ?? "" } },
                  { id: { notIn: [...excluded] } },
                ],
              },
              orderBy: { id: "asc" },
              take: query.limit + 1,
              select: {
                id: true,
                status: true,
                title: true,
                adminVersion: true,
                adminAvailability: true,
              },
            }),
          )
        : await scope.execute((db) =>
            db.game.findMany({
              where: {
                AND: [
                  { id: query.id ?? { gt: query.cursor ?? "" } },
                  { id: { in: [...games], notIn: [...excluded] } },
                ],
              },
              orderBy: { id: "asc" },
              take: query.limit + 1,
              select: {
                id: true,
                status: true,
                title: true,
                adminVersion: true,
                adminAvailability: true,
              },
            }),
          );
    return {
      schemaVersion: 1 as const,
      asOf: new Date().toISOString(),
      items: rows.slice(0, query.limit).map((row) => ({
        id: row.id,
        label: row.title,
        status: row.adminAvailability,
        gameId: row.id,
        version: row.adminVersion,
      })),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null,
    };
  };
}

export function createGamesAdminManagementRead(database: ReturnType<typeof createDatabase>) {
  const scope = database.forModule("games");
  function read(
    query: AdminGameSearchQuery,
    games: readonly string[] | null,
    excluded: readonly string[],
  ): Promise<AdminGamePage>;
  function read(
    query: AdminGameSearchQuery,
    games: readonly string[] | null,
    excluded: readonly string[],
    id: string,
  ): Promise<AdminGameDetail | null>;
  async function read(
    query: AdminGameSearchQuery,
    games: readonly string[] | null,
    excluded: readonly string[],
    id?: string,
  ) {
    const limit = id === undefined ? (query.limit ?? 25) : 1;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("ADMIN_READ_INVALID");
    const search = query.search?.replace(/[\\%_]/g, "\\$&");
    const rows = await scope.snapshot((db) =>
      db.game.findMany({
        where: {
          AND: [
            { id: id ?? { gt: query.cursor ?? "" } },
            { id: { ...(games === null ? {} : { in: [...games] }), notIn: [...excluded] } },
            { id: query.gameId ?? {} },
            { adminAvailability: query.status ?? {} },
            {
              OR: [
                { id: { contains: search ?? "", mode: "insensitive" } },
                { slug: { contains: search ?? "", mode: "insensitive" } },
                { title: { contains: search ?? "", mode: "insensitive" } },
              ],
            },
          ],
        },
        orderBy: { id: "asc" },
        take: id === undefined ? limit + 1 : 1,
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          adminAvailability: true,
          adminVersion: true,
          minPlayers: true,
          maxPlayers: true,
          matchmakingEnabled: true,
          privateRoomsEnabled: true,
          chatEnabled: true,
          voiceEnabled: true,
          configSchemaVersion: true,
        },
      }),
    );
    const asOf = new Date().toISOString();
    const items = rows.slice(0, limit).map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      releaseStatus: r.status,
      admissionStatus: r.adminAvailability,
      version: r.adminVersion,
    }));
    if (id !== undefined) {
      const row = rows[0];
      return row
        ? adminGameDetailSchema.parse({
            schemaVersion: 1,
            asOf,
            item: {
              ...items[0],
              minPlayers: row.minPlayers,
              maxPlayers: row.maxPlayers,
              matchmakingEnabled: row.matchmakingEnabled,
              privateRoomsEnabled: row.privateRoomsEnabled,
              chatEnabled: row.chatEnabled,
              voiceEnabled: row.voiceEnabled,
              configSchemaVersion: row.configSchemaVersion,
              installedVersions: null,
            },
          })
        : null;
    }
    return adminGamePageSchema.parse({
      schemaVersion: 1,
      asOf,
      items,
      nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
    });
  }
  return {
    search: (
      query: AdminGameSearchQuery,
      games: readonly string[] | null,
      excluded: readonly string[] = [],
    ) => read(query, games, excluded),
    detail: (id: string, games: readonly string[] | null, excluded: readonly string[] = []) =>
      read({}, games, excluded, id),
  };
}
