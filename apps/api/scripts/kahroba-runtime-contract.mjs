import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { format } from "prettier";
import { roomsOpenApiDocument, mainInviteResponseSchema } from "../dist/rooms/index.js";
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
// Main launch responses are explicitly versioned; preserve the frozen named-app v1 contract.
const mainDocument = JSON.parse(JSON.stringify(document));
mainDocument.schemaVersion = 2;
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
