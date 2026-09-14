import type { ActionId, EventId, MatchId, WIRE_SCHEMA_VERSION } from "./primitives.js";

/** Socket event data, not the outer Socket.IO event name or authenticated context. */
export interface GameCommandEnvelope<Command> {
  readonly schemaVersion: typeof WIRE_SCHEMA_VERSION;
  readonly actionId: ActionId;
  readonly matchId: MatchId;
  readonly expectedVersion: number;
  readonly command: Command;
}

/** Public, recipient-safe match event, never the internal replay/storage event. */
export interface MatchEventEnvelope<Type extends string, Payload> {
  readonly schemaVersion: typeof WIRE_SCHEMA_VERSION;
  readonly eventId: EventId;
  readonly matchId: MatchId;
  readonly type: Type;
  readonly seq: number;
  readonly stateVersion: number;
  readonly payload: Payload;
}

/** View must already be projected for the authenticated player/spectator. */
export interface MatchSnapshotEnvelope<View> {
  readonly schemaVersion: typeof WIRE_SCHEMA_VERSION;
  readonly matchId: MatchId;
  readonly stateVersion: number;
  readonly lastEventSeq: number;
  readonly view: View;
}

/** Normalized application input; HTTP adapters decode query strings explicitly. */
export interface PageRequest {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export interface Page<Item> {
  readonly items: readonly Item[];
  readonly nextCursor: string | null;
}
