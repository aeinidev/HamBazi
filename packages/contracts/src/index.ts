// Public transport contracts; feature-specific payloads stay with their owners.
export { WIRE_SCHEMA_VERSION, MAX_WIRE_COUNTER } from "./primitives.js";
export type { EntityId, ActionId, EventId, MatchId, RoomId, UserId } from "./primitives.js";
export type {
  GameCommandEnvelope,
  MatchEventEnvelope,
  MatchSnapshotEnvelope,
  PageRequest,
  Page,
} from "./envelopes.js";
export { createErrorEnvelope } from "./errors.js";
export type { ErrorEnvelope } from "./errors.js";

export {
  roomInviteCodePattern,
  parseRoomStartParam,
  buildRoomDeepLink,
} from "./telegram-room-invite.js";
