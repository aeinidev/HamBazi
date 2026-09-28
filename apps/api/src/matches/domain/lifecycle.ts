export const matchStatuses = [
  "CREATED",
  "WAITING_FOR_PLAYERS",
  "READY",
  "STARTING",
  "ACTIVE",
  "FINISHED",
  "TERMINATED",
] as const;
export type MatchStatus = (typeof matchStatuses)[number];
export function canTransition(from: MatchStatus, to: MatchStatus): boolean {
  if (from === "FINISHED" || from === "TERMINATED") return false;
  return to === "TERMINATED" || matchStatuses[matchStatuses.indexOf(from) + 1] === to;
}
