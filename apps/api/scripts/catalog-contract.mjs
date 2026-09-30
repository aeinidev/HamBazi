import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { catalogOpenApiDocument } from "../dist/games/index.js";
import { compatibleLegacyCatalog } from "./catalog-compatibility.mjs";
import { compatibleAuthContract } from "./contract-compatibility.mjs";
const target = new URL("../../../docs/contracts/catalog.openapi.json", import.meta.url);
const baseline = new URL("../../../docs/contracts/catalog.v1.baseline.json", import.meta.url);
const document = catalogOpenApiDocument();
const modesBaseline = new URL(
  "../../../docs/contracts/catalog.modes.v1.baseline.json",
  import.meta.url,
);
const generated = JSON.stringify(document, null, 2) + "\n";
if (process.argv.includes("--initialize-baseline")) {
  await writeFile(baseline, generated, { flag: "wx", mode: 0o644 });
} else {
  if (!compatibleLegacyCatalog(JSON.parse(await readFile(baseline, "utf8")), document))
    throw new Error("Breaking catalog contract change");
  if (process.argv.includes("--initialize-modes-baseline"))
    await writeFile(modesBaseline, generated, { flag: "wx", mode: 0o644 });
  else if (!compatibleAuthContract(JSON.parse(await readFile(modesBaseline, "utf8")), document))
    throw new Error("Breaking catalog modes contract change");
  if (process.argv.includes("--write")) await writeFile(target, generated);
  else if (!isDeepStrictEqual(JSON.parse(await readFile(target, "utf8")), document))
    throw new Error("Catalog contract drift");
}
console.log("Catalog OpenAPI verified/generated");
