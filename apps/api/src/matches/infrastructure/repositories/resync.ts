import { personalRoster, personalMatchType } from "./personal-roster.js";
import type { createDatabase } from "@hambazi/database";
import { MatchFault, matchAckSchema } from "../../application/processing.js";
import {
  matchSnapshotSchema,
  type MatchResyncRepository,
  type MatchViewGame,
  type MatchCatchup,
} from "../../application/resync.js";

export function createMatchResyncRepository(
  database: ReturnType<typeof createDatabase>,
  games: readonly MatchViewGame[],
  personal = false,
): MatchResyncRepository {
  const registrations = games.map(
    (game) =>
      `${game.gameId}/${game.descriptor.engineVersion}/${game.descriptor.stateSchemaVersion}/${game.descriptor.rulesetVersion}`,
  );
  if (new Set(registrations).size !== games.length)
    throw new Error("Duplicate Match view registration");
  const scope = database.forModule("matches");
  return {
    async read(userId, matchId, afterSeq) {
      let fault: MatchFault | undefined;
      try {
        return await scope.transaction(async (db): Promise<MatchCatchup> => {
          try {
            // The same row lock as writers keeps roster, role, checkpoint and event tail consistent.
            await db.lockMatch(matchId);
            const row = await db.match.findUnique({ where: { id: matchId } });
            if (!row || row.status === "TERMINATED") throw new MatchFault("NOT_FOUND");
            if ((row.matchType === personalMatchType) !== personal)
              throw new MatchFault("NOT_FOUND");
            const players = personal
              ? await personalRoster(db, matchId)
              : await db.matchPlayer.findMany({
                  where: { matchId },
                  orderBy: { seat: "asc" },
                });
            const player = players.find((p) => p.userId === userId);
            if (!player) throw new MatchFault("NOT_FOUND");
            const role =
              player.agentType === "HUMAN" &&
              player.replacedAt === null &&
              player.connectionStatus !== "REPLACED_BY_BOT"
                ? "PLAYER"
                : "SPECTATOR";
            const game = games.find(
              (g) =>
                g.gameId === row.gameId &&
                g.descriptor.engineVersion === row.engineVersion &&
                g.descriptor.stateSchemaVersion === row.stateSchemaVersion &&
                g.descriptor.rulesetVersion === row.rulesetVersion,
            );
            if (!game) throw new MatchFault("INCOMPATIBLE_GAME_VERSION");
            const snapshot = matchSnapshotSchema.parse({
              schemaVersion: 1,
              matchId,
              stateVersion: row.stateVersion,
              lastEventSeq: row.lastEventSeq,
              status: row.status,
              role,
              gameId: row.gameId,
              engineVersion: row.engineVersion,
              stateSchemaVersion: row.stateSchemaVersion,
              rulesetVersion: row.rulesetVersion,
              view:
                row.stateJsonb === null
                  ? null
                  : game.project(
                      game.restore(
                        row.stateJsonb,
                        players.map((p) => p.userId),
                      ),
                      userId,
                      role,
                    ),
            });
            const fallback = {
              schemaVersion: 1 as const,
              mode: "SNAPSHOT" as const,
              events: [],
              snapshot,
            };
            if (
              afterSeq === undefined ||
              afterSeq > row.lastEventSeq ||
              row.lastEventSeq - afterSeq > 100
            )
              return fallback;
            // The locked checkpoint has no tail beyond this cursor. Still build
            // the fresh authorized view above; empty event/receipt reads add no
            // information and amplify reconnect waves.
            if (afterSeq === row.lastEventSeq)
              return { schemaVersion: 1, mode: "EVENTS", events: [], snapshot };
            const events = await db.gameEvent.findMany({
              where: { matchId, seq: { gt: afterSeq, lte: row.lastEventSeq } },
              orderBy: { seq: "asc" },
              take: 100,
              select: { id: true, seq: true },
            });
            if (
              events.length !== row.lastEventSeq - afterSeq ||
              events.some((e, i) => e.seq !== afterSeq + i + 1)
            )
              return fallback;
            const receipts = await db.processedCommand.findMany({
              where: { matchId, resultJsonb: { path: ["lastEventSeq"], gt: afterSeq } },
              orderBy: { resultingVersion: "asc" },
              take: 100,
              select: { resultJsonb: true },
            });
            const checkpoints = receipts.map((r) => matchAckSchema.parse(r.resultJsonb));
            return {
              schemaVersion: 1,
              mode: "EVENTS",
              snapshot,
              events: events.map((e) => {
                const checkpoint = checkpoints.find((c) => c.lastEventSeq >= e.seq);
                if (!checkpoint || checkpoint.matchId !== matchId)
                  throw new MatchFault("INTERNAL_ERROR");
                return {
                  schemaVersion: 1,
                  eventId: e.id,
                  matchId,
                  type: "MATCH_INVALIDATED_V1",
                  seq: e.seq,
                  stateVersion: checkpoint.stateVersion,
                  payload: {},
                };
              }),
            };
          } catch (error) {
            if (error instanceof MatchFault) fault = error;
            throw error;
          }
        });
      } catch (error) {
        throw fault ?? error;
      }
    },
  };
}
