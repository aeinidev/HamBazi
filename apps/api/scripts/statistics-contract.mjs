import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { statisticsOpenApiDocument } from "../dist/leaderboard/index.js";
import { compatibleAuthContract } from "./contract-compatibility.mjs";
const target = new URL("../../../docs/contracts/statistics.openapi.json", import.meta.url);
const baseline = new URL("../../../docs/contracts/statistics.v1.baseline.json", import.meta.url);
const document = statisticsOpenApiDocument();
const generated = JSON.stringify(document, null, 2) + "\n";
if (process.argv.includes("--initialize-baseline"))
  await writeFile(baseline, generated, { flag: "wx", mode: 0o644 });
else {
  if (!compatibleAuthContract(JSON.parse(await readFile(baseline, "utf8")), document))
    throw new Error("Breaking statistics contract change");
  if (process.argv.includes("--write")) await writeFile(target, generated);
  else if (!isDeepStrictEqual(JSON.parse(await readFile(target, "utf8")), document))
    throw new Error("Statistics contract drift");
}
console.log("Statistics OpenAPI verified/generated");
