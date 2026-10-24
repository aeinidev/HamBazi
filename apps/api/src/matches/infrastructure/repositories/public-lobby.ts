import type { createDatabase } from "@hambazi/database";
import {
  publicLobbySchema,
  publicSearchSchema,
  type PublicLobbyRepository,
} from "../../application/public-lobby.js";
export function createPublicLobbyRepository(
  database: ReturnType<typeof createDatabase>,
): PublicLobbyRepository {
  const scope = database.forModule("matches");
  return {
    current: (userId, gameId, at) =>
      scope.execute(async (db) => {
        let ticket = await db.matchAdmission.findFirst({
          where: {
            actorUserId: userId,
            gameId,
            status: { in: ["SEARCHING", "RESERVED"] },
            expiresAt: { gt: new Date(at) },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, status: true, capacity: true, expiresAt: true, matchId: true },
        });
        if (!ticket) {
          // Owned scalar reads, matching the Room current-membership projection.
          const seats = await db.matchPlayer.findMany({
            where: { userId },
            select: { matchId: true },
          });
          if (!seats.length) return null;
          const match = await db.match.findFirst({
            where: {
              gameId,
              matchType: "MATCHMAKING",
              id: { in: seats.map((s) => s.matchId) },
              status: { in: ["CREATED", "WAITING_FOR_PLAYERS", "READY", "STARTING", "ACTIVE"] },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true },
          });
          if (!match) return null;
          ticket = await db.matchAdmission.findFirst({
            where: { actorUserId: userId, gameId, matchId: match.id, status: "MATCHED" },
            select: { id: true, status: true, capacity: true, expiresAt: true, matchId: true },
          });
        }
        return ticket
          ? publicSearchSchema.parse({
              schemaVersion: 1,
              ticketId: ticket.id,
              status: ticket.status,
              capacity: ticket.capacity,
              expiresAt: ticket.expiresAt.getTime(),
              matchId: ticket.matchId,
            })
          : null;
      }),
    read: (userId, matchId) =>
      scope.transaction(async (db) => {
        const match = await db.match.findUnique({
          where: { id: matchId },
          select: { id: true, gameId: true, matchType: true, status: true, stateVersion: true },
        });
        if (!match || match.matchType !== "MATCHMAKING") return null;
        const players = await db.matchPlayer.findMany({
          where: { matchId },
          orderBy: { seat: "asc" },
          select: {
            userId: true,
            seat: true,
            readyAt: true,
            agentType: true,
            connectionStatus: true,
          },
        });
        if (
          !players.some(
            (p) =>
              p.userId === userId &&
              (["ACTIVE", "FINISHED"].includes(match.status) ||
                (p.agentType === "HUMAN" && p.connectionStatus !== "REPLACED_BY_BOT")),
          )
        )
          return null;
        return publicLobbySchema.parse({
          schemaVersion: 1,
          matchId,
          gameId: match.gameId,
          stateVersion: match.stateVersion,
          status: match.status,
          hostUserId: players[0]?.userId,
          players: players.map((p) => ({
            userId: p.userId,
            seat: p.seat,
            ready: p.readyAt !== null,
          })),
        });
      }),
  };
}
