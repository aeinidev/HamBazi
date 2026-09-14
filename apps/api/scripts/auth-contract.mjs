import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import console from "node:console";
import { fileURLToPath, URL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { authOpenApiDocument } from "../dist/auth/index.js";
import { compatibleAuthContract } from "./contract-compatibility.mjs";
const target = fileURLToPath(new URL("../../../docs/contracts/auth.openapi.json", import.meta.url));
const baseline = fileURLToPath(
  new URL("../../../docs/contracts/auth.v1.baseline.json", import.meta.url),
);
const generated = JSON.stringify(authOpenApiDocument(), null, 2) + "\n";
if (process.argv.includes("--initialize-baseline")) {
  await writeFile(baseline, generated, { mode: 0o644, flag: "wx" });
  console.log("Initial v1 compatibility baseline created without overwrite");
} else if (process.argv.includes("--write")) {
  if (!compatibleAuthContract(JSON.parse(await readFile(baseline, "utf8")), JSON.parse(generated)))
    throw new Error("Breaking v1 auth contract change; new namespace/version and ADR required");
  await writeFile(target, generated, { mode: 0o644 });
  console.log("Authentication OpenAPI generated");
} else {
  if (
    !isDeepStrictEqual(JSON.parse(await readFile(target, "utf8")), JSON.parse(generated)) ||
    !compatibleAuthContract(JSON.parse(await readFile(baseline, "utf8")), JSON.parse(generated))
  ) {
    console.error("Authentication OpenAPI drift; review compatibility before regeneration");
    process.exitCode = 1;
  } else console.log("Authentication OpenAPI matches runtime schemas");
}
