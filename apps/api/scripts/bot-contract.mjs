import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { botInternalOpenApiDocument } from "../dist/auth/index.js";
import { compatibleAuthContract } from "./contract-compatibility.mjs";
const target = new URL("../../../docs/contracts/bot-internal.openapi.json", import.meta.url);
const baseline = new URL("../../../docs/contracts/bot-internal.v1.baseline.json", import.meta.url);
const generated = JSON.stringify(botInternalOpenApiDocument(), null, 2) + "\n";
if (process.argv.includes("--initialize-baseline")) {
  await writeFile(baseline, generated, { flag: "wx", mode: 0o644 });
  console.info("Internal Bot v1 baseline initialized without overwrite");
} else {
  if (!compatibleAuthContract(JSON.parse(await readFile(baseline, "utf8")), JSON.parse(generated)))
    throw new Error("Breaking internal Bot contract change");
  if (process.argv.includes("--write")) await writeFile(target, generated, { mode: 0o644 });
  else if (!isDeepStrictEqual(JSON.parse(await readFile(target, "utf8")), JSON.parse(generated)))
    throw new Error("Internal Bot OpenAPI drift");
  console.info("Internal Bot OpenAPI matches runtime schemas");
}
