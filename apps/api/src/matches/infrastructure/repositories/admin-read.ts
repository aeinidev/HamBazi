import {
  adminMatchPageSchema,
  adminMatchDetailSchema,
  adminMatchPlayersSchema,
  adminMatchHistorySchema,
  adminMatchHistoryEventSchema,
  type AdminMatchHistoryQuery,
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
  async function players(
    id: string,
    games: readonly string[] | null,
    excluded: readonly string[] = [],
  ) {
    return scope.snapshot(async (db) => {
      const match = await db.match.findFirst({
        where: {
          id,
          gameId: { ...(games === null ? {} : { in: [...games] }), notIn: [...excluded] },
        },
        select: { id: true },
      });
      if (!match) return null;
      const registered = await db.matchPlayer.findMany({
        where: { matchId: id },
        orderBy: { seat: "asc" },
        take: 65,
        select: {
          userId: true,
          seat: true,
          joinedAt: true,
          agentType: true,
          connectionStatus: true,
          connectionEpoch: true,
          readyAt: true,
          disconnectedAt: true,
          disconnectDeadlineAt: true,
          replacedAt: true,
        },
      });
      const bots = await db.matchBotSeat.findMany({
        where: { matchId: id },
        orderBy: { seat: "asc" },
        take: 65,
        select: { actorId: true, seat: true },
      });
      if (registered.length + bots.length > 64) throw new Error("ADMIN_READ_OVERFLOW");
      const items = [
        ...registered.map(
          ({ joinedAt, readyAt, disconnectedAt, disconnectDeadlineAt, replacedAt, ...row }) => ({
            ...row,
            kind: "REGISTERED_PLAYER" as const,
            joinedAt: joinedAt.toISOString(),
            readyAt: readyAt?.toISOString() ?? null,
            disconnectedAt: disconnectedAt?.toISOString() ?? null,
            disconnectDeadlineAt: disconnectDeadlineAt?.toISOString() ?? null,
            replacedAt: replacedAt?.toISOString() ?? null,
          }),
        ),
        ...bots.map((row) => ({
          ...row,
          kind: "SERVER_BOT" as const,
          userId: null,
          agentType: "BOT" as const,
        })),
      ].sort((a, b) => a.seat - b.seat);
      return adminMatchPlayersSchema.parse({
        schemaVersion: 1,
        asOf: new Date().toISOString(),
        matchId: id,
        items,
      });
    });
  }
  async function history(
    id: string,
    query: AdminMatchHistoryQuery,
    games: readonly string[] | null,
    excluded: readonly string[] = [],
  ) {
    const limit = query.limit ?? 25;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (query.cursor !== undefined &&
        (!Number.isInteger(query.cursor) || query.cursor < 1 || query.cursor > 2147483647))
    )
      throw new Error("ADMIN_READ_INVALID");
    return scope.snapshot(async (db) => {
      const match = await db.match.findFirst({
        where: {
          id,
          gameId: { ...(games === null ? {} : { in: [...games] }), notIn: [...excluded] },
        },
        select: { id: true, status: true },
      });
      if (!match) return null;
      const registered = await db.matchPlayer.findMany({
        where: { matchId: id },
        orderBy: { seat: "asc" },
        take: 65,
        select: { userId: true },
      });
      if (registered.length > 64) throw new Error("ADMIN_READ_OVERFLOW");
      const outcomes =
        match.status === "FINISHED"
          ? await db.gameResult.findMany({
              where: { matchId: id },
              orderBy: { userId: "asc" },
              take: 65,
              select: { userId: true, placement: true, winner: true },
            })
          : [];
      if (outcomes.length > 64) throw new Error("ADMIN_READ_OVERFLOW");
      const events = await db.gameEvent.findMany({
        where: {
          matchId: id,
          seq: { gt: query.cursor ?? 0 },
          type: { in: [...adminMatchHistoryEventSchema.shape.type.options] },
        },
        orderBy: { seq: "asc" },
        take: limit + 1,
        select: {
          id: true,
          seq: true,
          schemaVersion: true,
          type: true,
          actorUserId: true,
          createdAt: true,
        },
      });
      return adminMatchHistorySchema.parse({
        schemaVersion: 1,
        asOf: new Date().toISOString(),
        matchId: id,
        items: events
          .slice(0, limit)
          .map(({ createdAt, ...row }) => ({ ...row, createdAt: createdAt.toISOString() })),
        nextCursor: events.length > limit ? events[limit - 1]!.seq : null,
        results: registered.map(({ userId }) => {
          const result = outcomes.find((row) => row.userId === userId);
          return { userId, placement: result?.placement ?? null, winner: result?.winner ?? null };
        }),
      });
    });
  }
  return {
    players,
    history,
    search: (
      query: AdminMatchSearchQuery,
      games: readonly string[] | null,
      excluded: readonly string[] = [],
    ) => read(query, games, excluded),
    detail: (id: string, games: readonly string[] | null, excluded: readonly string[] = []) =>
      read({}, games, excluded, id),
  };
}
