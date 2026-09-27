import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { roomsOpenApiDocument } from "../dist/rooms/index.js";
import { compatibleAuthContract } from "./contract-compatibility.mjs";
const target = new URL("../../../docs/contracts/rooms.openapi.json", import.meta.url);
const baseline = new URL("../../../docs/contracts/rooms.v1.baseline.json", import.meta.url);
const document = roomsOpenApiDocument();
const generated = JSON.stringify(document, null, 2) + "\n";
if (process.argv.includes("--initialize-baseline")) {
  await writeFile(baseline, generated, { flag: "wx", mode: 0o644 });
} else {
  if (!compatibleAuthContract(JSON.parse(await readFile(baseline, "utf8")), document))
    throw new Error("Breaking rooms contract change");
  if (process.argv.includes("--write")) await writeFile(target, generated);
  else if (!isDeepStrictEqual(JSON.parse(await readFile(target, "utf8")), document))
    throw new Error("Rooms contract drift");
}
console.log("Rooms OpenAPI verified/generated");
