import {
  adminRoomPageSchema,
  adminRoomDetailSchema,
  type AdminRoomSearchQuery,
  type AdminRoomPage,
  type AdminRoomDetail,
} from "@hambazi/validation";
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

export function createRoomsAdminManagementRead(database: ReturnType<typeof createDatabase>) {
  const scope = database.forModule("rooms");
  function read(
    query: AdminRoomSearchQuery,
    games: readonly string[] | null,
    excluded: readonly string[],
  ): Promise<AdminRoomPage>;
  function read(
    query: AdminRoomSearchQuery,
    games: readonly string[] | null,
    excluded: readonly string[],
    id: string,
  ): Promise<AdminRoomDetail | null>;
  async function read(
    query: AdminRoomSearchQuery,
    games: readonly string[] | null,
    excluded: readonly string[],
    id?: string,
  ) {
    const limit = id === undefined ? (query.limit ?? 25) : 1;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("ADMIN_READ_INVALID");
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      query.search ?? "",
    );
    const rows = await scope.snapshot((db) =>
      db.room.findMany({
        where: {
          AND: [
            { id: id ?? { gt: query.cursor ?? "00000000-0000-0000-0000-000000000000" } },
            { gameId: { ...(games === null ? {} : { in: [...games] }), notIn: [...excluded] } },
            { gameId: query.gameId ?? {} },
            { status: query.status ?? {} },
            { id: isId ? query.search! : {} },
            { gameId: query.search && !isId ? query.search : {} },
            {
              createdAt: {
                ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
                ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
              },
            },
          ],
        },
        orderBy: { id: "asc" },
        take: id === undefined ? limit + 1 : 1,
        select: {
          id: true,
          gameId: true,
          status: true,
          stateVersion: true,
          capacity: true,
          hostUserId: true,
          createdAt: true,
          updatedAt: true,
          expiresAt: true,
          startedMatchId: true,
        },
      }),
    );
    const asOf = new Date().toISOString();
    const items = rows
      .slice(0, limit)
      .map(({ stateVersion, createdAt, updatedAt, expiresAt, ...row }) => ({
        ...row,
        version: stateVersion,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }));
    if (id !== undefined)
      return items[0]
        ? adminRoomDetailSchema.parse({ schemaVersion: 1, asOf, item: items[0] })
        : null;
    return adminRoomPageSchema.parse({
      schemaVersion: 1,
      asOf,
      items,
      nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
    });
  }
  return {
    search: (
      query: AdminRoomSearchQuery,
      games: readonly string[] | null,
      excluded: readonly string[] = [],
    ) => read(query, games, excluded),
    detail: (id: string, games: readonly string[] | null, excluded: readonly string[] = []) =>
      read({}, games, excluded, id),
  };
}
