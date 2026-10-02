import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { botInternalOpenApiDocument } from "../dist/auth/index.js";
import { healthOpenApiDocument, botHealthOperation } from "../dist/health/index.js";
import { healthPaths } from "@hambazi/observability";
import { compatibleAuthContract } from "./contract-compatibility.mjs";
const target = new URL("../../../docs/contracts/bot-internal.openapi.json", import.meta.url);
const baseline = new URL("../../../docs/contracts/bot-internal.v1.baseline.json", import.meta.url);
const document = botInternalOpenApiDocument();
const healthOperation = botHealthOperation();
for (const status of ["401", "403"])
  healthOperation.responses[status].content =
    document.paths["/v1/internal/bot/admit"].post.responses[status].content;
document.paths[healthPaths.ready] = { get: healthOperation };
const generated = JSON.stringify(document, null, 2) + "\n";
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
const healthTarget = new URL("../../../docs/contracts/health.openapi.json", import.meta.url);
const healthBaseline = new URL("../../../docs/contracts/health.v1.baseline.json", import.meta.url);
const healthGenerated = JSON.stringify(healthOpenApiDocument(), null, 2) + "\n";
if (
  !compatibleAuthContract(
    JSON.parse(await readFile(healthBaseline, "utf8")),
    JSON.parse(healthGenerated),
  )
)
  throw new Error("Breaking operations health contract change");
if (process.argv.includes("--write"))
  await writeFile(healthTarget, healthGenerated, { mode: 0o644 });
else if (
  !isDeepStrictEqual(JSON.parse(await readFile(healthTarget, "utf8")), JSON.parse(healthGenerated))
)
  throw new Error("Operations health OpenAPI drift");
console.info("Operations health OpenAPI matches runtime projection");
