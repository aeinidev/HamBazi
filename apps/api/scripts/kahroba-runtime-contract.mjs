import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { format } from "prettier";
import {
  roomsOpenApiDocument,
  mainInviteResponseSchema,
  roomResponseSchema,
} from "../dist/rooms/index.js";
import { realtimeEventCatalog } from "../dist/realtime/index.js";
import {
  kahrobaCapabilitiesSchema,
  kahrobaPublicNamesSchema,
} from "../dist/composition/kahroba-http.js";
import {
  privateRoomReadinessSchema,
  matchReadySchema,
  matchAckSchema,
} from "../dist/matches/index.js";
const rooms = roomsOpenApiDocument(),
  socket = realtimeEventCatalog();
const unsupported = [
  "matchmaking:search",
  "matchmaking:status",
  "matchmaking:cancel",
  "matchmaking:found",
  "matchmaking:admit",
  "chat:send",
  "chat:list",
];
const document = {
  schemaVersion: 1,
  access: "server-authenticated existing restricted cohort only",
  publicCatalog: false,
  paths: Object.fromEntries(
    Object.entries(rooms.paths).map(([path, value]) => [
      path.replace("/v1/", "/v1/kahroba/"),
      value,
    ]),
  ),
  capabilities: {
    path: "/v1/kahroba/capabilities",
    method: "GET",
    response: z.toJSONSchema(kahrobaCapabilitiesSchema),
  },
  names: {
    path: "/v1/kahroba/matches/{id}/players",
    method: "GET",
    authorization: "active admitted user + match membership; public roster only",
    response: z.toJSONSchema(kahrobaPublicNamesSchema),
  },
  socket: {
    ...socket,
    path: "/v1/kahroba/socket.io",
    namespace: "/kahroba-v1",
    unsupportedEvents: unsupported,
  },
  pins: {
    engineVersion: "kahroba-v1",
    stateSchemaVersion: 1,
    rulesetVersion: "kahroba-base-v1",
    viewSchemaVersion: 1,
  },
  policy: { turnDurationMs: null, timeoutPolicyVersion: null },
};
const baseline = new URL(
    "../../../docs/contracts/kahroba.runtime.v1.baseline.json",
    import.meta.url,
  ),
  target = new URL("../../../docs/contracts/kahroba.runtime.v1.json", import.meta.url);
const generated = JSON.stringify(document, null, 2) + "\n";
if (process.argv.includes("--initialize-baseline"))
  await writeFile(baseline, generated, { flag: "wx" });
else if (!isDeepStrictEqual(JSON.parse(await readFile(baseline, "utf8")), document))
  throw Error("Breaking private Kahroba runtime contract change");
if (process.argv.includes("--write")) await writeFile(target, generated);
else if (
  !process.argv.includes("--initialize-baseline") &&
  !isDeepStrictEqual(JSON.parse(await readFile(target, "utf8")), document)
)
  throw Error("Private Kahroba runtime contract drift");
console.info("Private Kahroba runtime contract verified/generated");
// Main launch responses are explicitly versioned; preserve the frozen named-app v1 contract.
const mainDocument = JSON.parse(JSON.stringify(document));
mainDocument.schemaVersion = 2;
// Additive, private member-only roster read. Frozen public/named-app v1 is unchanged.
mainDocument.roomNames = {
  path: "/v1/kahroba/rooms/{id}/players",
  method: "GET",
  authorization: "active admitted user + room membership; public display names only",
  response: z.toJSONSchema(kahrobaPublicNamesSchema),
};
const invitation = mainDocument.paths["/v1/kahroba/rooms/{id}/invite"].get.responses[200];
invitation.content["application/json"].schema = {
  anyOf: [invitation.content["application/json"].schema, z.toJSONSchema(mainInviteResponseSchema)],
};
const mainBaseline = new URL(
  "../../../docs/contracts/kahroba.runtime.v2.baseline.json",
  import.meta.url,
);
const mainTarget = new URL("../../../docs/contracts/kahroba.runtime.v2.json", import.meta.url);
const mainGenerated = await format(JSON.stringify(mainDocument), {
  ...JSON.parse(await readFile(new URL("../../../.prettierrc.json", import.meta.url), "utf8")),
  parser: "json",
});
if (process.argv.includes("--initialize-main-baseline"))
  await writeFile(mainBaseline, mainGenerated, { flag: "wx" });
else if (!isDeepStrictEqual(JSON.parse(await readFile(mainBaseline, "utf8")), mainDocument))
  throw Error("Breaking private Kahroba v2 runtime contract change");
if (process.argv.includes("--write") || process.argv.includes("--write-main"))
  await writeFile(mainTarget, mainGenerated);
else if (
  !process.argv.includes("--initialize-main-baseline") &&
  !isDeepStrictEqual(JSON.parse(await readFile(mainTarget, "utf8")), mainDocument)
)
  throw Error("Private Kahroba v2 runtime contract drift");
console.info("Private Kahroba v2 Main Mini App contract verified/generated");

// Additive lobby surface; the frozen public/named-app v1 and Main-app v2 documents above remain byte/semantically unchanged.
const lobbyDocument = {
  schemaVersion: 1,
  access: "existing authenticated two-account cohort only",
  paths: {
    "/v1/kahroba/current-room": {
      method: "GET",
      response: z.toJSONSchema(
        roomResponseSchema.extend({ room: roomResponseSchema.shape.room.nullable() }),
      ),
      authorization:
        "authenticated membership; latest nonclosed Kahroba room only; no invitation secret",
    },
    "/v1/kahroba/lobby-permissions": {
      method: "GET",
      response: z.toJSONSchema(
        z.strictObject({ schemaVersion: z.literal(1), canCreate: z.boolean() }),
      ),
      authorization: "owner-only creation; tester invitation join",
    },
    "/v1/kahroba/rooms/{id}/readiness": {
      method: "GET",
      response: z.toJSONSchema(
        z.strictObject({ ok: z.literal(true), value: privateRoomReadinessSchema }),
        { io: "input" },
      ),
      authorization: "room membership",
    },
    "/v1/kahroba/rooms/{id}/start": {
      method: "POST",
      request: z.toJSONSchema(matchReadySchema, { io: "input" }),
      response: z.toJSONSchema(z.strictObject({ ok: z.literal(true), value: matchAckSchema }), {
        io: "input",
      }),
      authorization:
        "host + bound private match + all durable readyAt + expectedVersion + actionId",
    },
  },
  policy: {
    prepare: "host room:start freezes full roster into WAITING_FOR_PLAYERS",
    ready:
      "match:ready persists readiness in WAITING_FOR_PLAYERS; canStart requires every durable readyAt",
    start: "explicit authenticated host start; recovery completes STARTING",
    rollback:
      "fully ready new rooms remain WAITING_FOR_PLAYERS and retained APIs hold them; preserve readyAt and compatible v2 Worker; no DB rewind",
  },
};
const lobbyTarget = new URL("../../../docs/contracts/kahroba.lobby.v1.json", import.meta.url);
const lobbyGenerated = await format(JSON.stringify(lobbyDocument), {
  ...JSON.parse(await readFile(new URL("../../../.prettierrc.json", import.meta.url), "utf8")),
  parser: "json",
});
if (process.argv.includes("--write-lobby")) await writeFile(lobbyTarget, lobbyGenerated);
else if (!isDeepStrictEqual(JSON.parse(await readFile(lobbyTarget, "utf8")), lobbyDocument))
  throw Error("Private Kahroba lobby contract drift");
console.info("Private Kahroba playable lobby contract verified/generated");
