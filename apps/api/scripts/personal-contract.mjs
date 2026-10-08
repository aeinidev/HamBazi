import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { personalEventCatalog } from "../dist/realtime/index.js";
const target = new URL("../../../docs/contracts/personal.v1.events.json", import.meta.url);
const baseline = new URL("../../../docs/contracts/personal.v1.baseline.json", import.meta.url);
const document = personalEventCatalog(),
  generated = JSON.stringify(document, null, 2) + "\n";
if (process.argv.includes("--initialize-baseline"))
  await writeFile(baseline, generated, { flag: "wx" });
else if (!isDeepStrictEqual(JSON.parse(await readFile(baseline, "utf8")), document))
  throw Error("Breaking personal v1 contract change");
if (process.argv.includes("--write")) await writeFile(target, generated);
else if (!isDeepStrictEqual(JSON.parse(await readFile(target, "utf8")), document))
  throw Error("Personal v1 event catalog drift");
console.info("Personal v1 event catalog verified/generated");
