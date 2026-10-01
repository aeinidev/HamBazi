import {
  chatSendSchema,
  chatListSchema,
  chatMessageSchema,
  chatPageSchema,
} from "../chat/index.js";
import { z } from "zod";
import { roomCommandSchema, joinRoomSchema } from "../rooms/index.js";
import { searchSchema, ticketSchema, admissionSchema } from "../matchmaking/index.js";
import {
  matchCommandSchema,
  matchReadySchema,
  matchSnapshotRequestSchema,
  matchCatchupRequestSchema,
  matchSnapshotSchema,
  matchDeliveryEventSchema,
  matchCatchupSchema,
} from "../matches/index.js";

const uuid = z.uuid().transform((value) => value.toLowerCase());
export const handshakeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  accessToken: z.string().min(1).max(4096),
});
export const roomSubscriptionSchema = z.strictObject({ schemaVersion: z.literal(1), roomId: uuid });
export const matchSubscriptionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  matchId: uuid,
});
export const presencePingSchema = z.strictObject({ schemaVersion: z.literal(1) });

export const incomingEvents = Object.freeze({
  "room:subscribe": roomSubscriptionSchema,
  "room:join": joinRoomSchema,
  "room:leave": roomCommandSchema,
  "room:start": roomCommandSchema,
  "matchmaking:search": searchSchema,
  "matchmaking:status": ticketSchema,
  "matchmaking:cancel": ticketSchema,
  "matchmaking:found": ticketSchema,
  "matchmaking:admit": admissionSchema,
  "match:subscribe": matchSubscriptionSchema,
  "match:snapshot": matchSnapshotRequestSchema,
  "match:catchup": matchCatchupRequestSchema,
  "match:ready": matchReadySchema,
  "game:command": matchCommandSchema,
  "presence:ping": presencePingSchema,
  "chat:send": chatSendSchema,
  "chat:list": chatListSchema,
});
export type IncomingEvent = keyof typeof incomingEvents;

// Reserved for their owning delivery/presence/chat phases. The gateway never
// forwards stored game events or accepts chat content via these names.
export const outgoingEvents = Object.freeze([
  "room:player_joined",
  "room:player_left",
  "room:host_changed",
  "room:ready",
  "matchmaking:started",
  "matchmaking:cancelled",
  "matchmaking:found",
  "match:started",
  "match:snapshot",
  "match:event",
  "match:finished",
  "player:disconnected",
  "player:reconnected",
  "player:bot_takeover",
  "chat:message",
] as const);

export function realtimeEventCatalog() {
  return {
    schemaVersion: 1,
    path: "/v1/socket.io",
    namespace: "/v1",
    handshake: z.toJSONSchema(handshakeSchema, { io: "input" }),
    clientEvents: Object.fromEntries(
      Object.entries(incomingEvents).map(([name, schema]) => [
        name,
        z.toJSONSchema(schema, { io: "input" }),
      ]),
    ),
    serverEvents: {
      "match:snapshot": z.toJSONSchema(matchSnapshotSchema, { io: "input" }),
      "match:event": z.toJSONSchema(matchDeliveryEventSchema, { io: "input" }),
      "chat:message": z.toJSONSchema(chatMessageSchema, { io: "input" }),
    },
    chatSendResult: z.toJSONSchema(chatMessageSchema, { io: "input" }),
    chatListResult: z.toJSONSchema(chatPageSchema, { io: "input" }),
    catchupResult: z.toJSONSchema(matchCatchupSchema, { io: "input" }),
    reservedServerEvents: [...outgoingEvents],
    acknowledgement: {
      success: "{ok:true,value:<owner result>}",
      failure: "{ok:false,error:{code,message,retryable}}",
    },
  };
}
