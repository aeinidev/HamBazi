import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import process from "node:process";
import { URL } from "node:url";
import { adminOpenApiDocument } from "../dist/admin/index.js";
import { compatibleAuthContract } from "./contract-compatibility.mjs";
const target = new URL("../../../docs/contracts/admin.openapi.json", import.meta.url);
const baseline = new URL("../../../docs/contracts/admin.v1.baseline.json", import.meta.url);
const document = adminOpenApiDocument(),
  generated = JSON.stringify(document, null, 2) + "\n";
if (process.argv.includes("--initialize-baseline"))
  await writeFile(baseline, generated, { flag: "wx" });
else {
  if (!compatibleAuthContract(JSON.parse(await readFile(baseline, "utf8")), document))
    throw new Error("Breaking Admin contract change");
  if (process.argv.includes("--write")) await writeFile(target, generated);
  else if (!isDeepStrictEqual(JSON.parse(await readFile(target, "utf8")), document))
    throw new Error("Admin contract drift");
}
process.stdout.write("Private Admin OpenAPI verified/generated\n");
