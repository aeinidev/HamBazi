import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { roomsOpenApiDocument } from "../dist/rooms/index.js";
import { realtimeEventCatalog } from "../dist/realtime/index.js";
import {
  kahrobaCapabilitiesSchema,
  kahrobaPublicNamesSchema,
} from "../dist/composition/kahroba-http.js";
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
