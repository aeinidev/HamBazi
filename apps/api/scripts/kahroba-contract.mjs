import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { format } from "prettier";
import { gameResultV2Schema, matchFinishedV2Schema } from "@hambazi/validation";
const baseline = new URL(
  "../../../docs/contracts/kahroba.result.v2.baseline.json",
  import.meta.url,
);
const target = new URL("../../../docs/contracts/kahroba.result.v2.json", import.meta.url);
const document = {
  schemaVersion: 2,
  eventType: "MATCH_FINISHED_V2",
  queue: "match-finished-v2",
  result: z.toJSONSchema(gameResultV2Schema, { io: "input" }),
  payload: z.toJSONSchema(matchFinishedV2Schema, { io: "input" }),
  invariants: {
    winners: "exactly the unique placements at place 1",
    sole: "one winnerId equal to the sole winnerIds entry",
    shared: "winnerId null, multiple winnerIds, SHARED_VICTORY",
    statistics: "one completed and one win per winner, deduplicated per Match and generation",
  },
};
const generated = await format(JSON.stringify(document), { parser: "json" });
if (process.argv.includes("--initialize-baseline"))
  await writeFile(baseline, generated, { flag: "wx", mode: 0o644 });
else {
  if (!isDeepStrictEqual(JSON.parse(await readFile(baseline, "utf8")), document))
    throw new Error("Breaking Kahroba result v2 contract change");
  if (process.argv.includes("--write")) await writeFile(target, generated);
  else if (!isDeepStrictEqual(JSON.parse(await readFile(target, "utf8")), document))
    throw new Error("Kahroba result v2 contract drift");
}
console.log("Kahroba result v2 contract verified/generated");
