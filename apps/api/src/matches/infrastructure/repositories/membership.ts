import type { createDatabase } from "@hambazi/database";
import type { MatchMembershipRepository } from "../../application/membership.js";

export function createMatchMembershipRepository(
  database: ReturnType<typeof createDatabase>,
): MatchMembershipRepository {
  const scope = database.forModule("matches");
  return Object.freeze({
    find: (userId: string, matchId: string) =>
      scope.execute(async (db) => {
        const match = await db.match.findUnique({
          where: { id: matchId },
          select: { id: true, status: true },
        });
        if (!match || match.status === "TERMINATED") return null;
        const player = await db.matchPlayer.findUnique({
          where: { matchId_userId: { matchId, userId } },
          select: { agentType: true, connectionStatus: true, replacedAt: true },
        });
        if (!player) return null;
        return {
          schemaVersion: 1 as const,
          matchId,
          role:
            player.agentType === "HUMAN" &&
            player.connectionStatus !== "REPLACED_BY_BOT" &&
            player.replacedAt === null
              ? ("PLAYER" as const)
              : ("SPECTATOR" as const),
        };
      }),
  });
}
