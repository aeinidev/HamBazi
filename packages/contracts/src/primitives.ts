/** Transport version, independent of engine/state/ruleset versions pinned on a match. */
export const WIRE_SCHEMA_VERSION = 1;

/** Matches the current PostgreSQL INTEGER storage for versions and sequences. */
export const MAX_WIRE_COUNTER = 2_147_483_647;

// Semantic aliases, not proof of validation or authorization. Parse unknown input first.
export type EntityId = string;
export type ActionId = EntityId;
export type EventId = EntityId;
export type MatchId = EntityId;
export type RoomId = EntityId;
export type UserId = EntityId;
