import type { createDatabase } from "@hambazi/database";
import { MatchFault } from "../../application/processing.js";
export const personalMatchType = "PERSONAL_BOTS_V1";
function _matches(
  database: ReturnType<typeof createDatabase>,
): ReturnType<typeof database.forModule<"matches">> {
  return database.forModule("matches");
}
type Client = Pick<
  Parameters<Parameters<ReturnType<typeof _matches>["transaction"]>[0]>[0],
  "matchPlayer" | "matchBotSeat"
>;
export async function personalRoster(db: Client, matchId: string) {
  const humans = await db.matchPlayer.findMany({ where: { matchId }, orderBy: { seat: "asc" } });
  const bots = await db.matchBotSeat.findMany({ where: { matchId }, orderBy: { seat: "asc" } });
  if (
    humans.length !== 1 ||
    humans[0]!.seat !== 0 ||
    humans[0]!.agentType !== "HUMAN" ||
    bots.length !== 1 ||
    bots[0]!.seat !== 1
  )
    throw new MatchFault("GAME_STATE_CONFLICT");
  const owner = humans[0]!;
  return [
    owner,
    { ...owner, userId: bots[0]!.actorId, seat: 1, agentType: "BOT", connectionEpoch: 0 },
  ];
}
