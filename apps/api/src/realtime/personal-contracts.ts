import { z } from "zod";
import { handshakeSchema } from "./contracts.js";
import {
  personalStartSchema,
  personalReadSchema,
  personalCloseSchema,
  personalCurrentSchema,
  personalCurrentResultSchema,
  matchCommandSchema,
  matchCatchupRequestSchema,
  matchSnapshotSchema,
  matchAckSchema,
} from "../matches/index.js";
export function personalEventCatalog() {
  return {
    schemaVersion: 1,
    path: "/v1/personal/socket.io",
    namespace: "/personal-v1",
    profile: "owner-bots-v1",
    transport: "websocket",
    handshake: z.toJSONSchema(handshakeSchema, { io: "input" }),
    clientEvents: Object.fromEntries(
      Object.entries({
        "personal:current": personalCurrentSchema,
        "personal:start": personalStartSchema,
        "personal:close": personalCloseSchema,
        "match:subscribe": personalReadSchema,
        "match:catchup": matchCatchupRequestSchema,
        "game:command": matchCommandSchema,
      }).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: "input" })]),
    ),
    results: {
      current: z.toJSONSchema(personalCurrentResultSchema, { io: "input" }),
      snapshot: z.toJSONSchema(matchSnapshotSchema, { io: "input" }),
      command: z.toJSONSchema(matchAckSchema, { io: "input" }),
    },
    delivery:
      "Authorized full snapshots over acknowledged requests; client rejects stale versions and polls at two seconds. No raw events or bot views are broadcast.",
  };
}
