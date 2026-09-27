/** Stable public codes. Infrastructure errors must be mapped by the owning use case. */
export const ERROR_CODES = Object.freeze([
  "INVALID_INPUT",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "GAME_STATE_CONFLICT",
  "PROFILE_CONFLICT",
  "ROOM_CONFLICT",
  "MATCHMAKING_CONFLICT",
  "MATCHMAKING_UNAVAILABLE",
  "GAME_UNAVAILABLE",
  "CLIENT_UPGRADE_REQUIRED",
  "INTERNAL_ERROR",
] as const);

export type ErrorCode = (typeof ERROR_CODES)[number];
