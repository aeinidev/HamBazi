import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { profileOpenApiDocument } from "../dist/users/index.js";
import { compatibleAuthContract } from "./contract-compatibility.mjs";
const target = new URL("../../../docs/contracts/profile.openapi.json", import.meta.url);
const baseline = new URL("../../../docs/contracts/profile.v1.baseline.json", import.meta.url);
const document = profileOpenApiDocument();
const generated = JSON.stringify(document, null, 2) + "\n";
if (process.argv.includes("--initialize-baseline")) {
  await writeFile(baseline, generated, { flag: "wx", mode: 0o644 });
} else {
  if (!compatibleAuthContract(JSON.parse(await readFile(baseline, "utf8")), document))
    throw new Error("Breaking profile contract change");
  if (process.argv.includes("--write")) await writeFile(target, generated);
  else if (!isDeepStrictEqual(JSON.parse(await readFile(target, "utf8")), document))
    throw new Error("Profile contract drift");
}
console.log("Profile OpenAPI verified/generated");
