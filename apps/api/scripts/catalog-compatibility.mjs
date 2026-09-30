import { compatibleAuthContract } from "./contract-compatibility.mjs";
/** Allow only the owner-approved optional property; all old wire fields remain frozen. */
export function compatibleLegacyCatalog(baseline, candidate) {
  const projection = JSON.parse(JSON.stringify(candidate));
  for (const [path, key] of [
    ["/v1/games", "games"],
    ["/v1/games/{slug}", "game"],
  ]) {
    const root =
      projection.paths?.[path]?.get?.responses?.["200"]?.content?.["application/json"]?.schema;
    const game = key === "games" ? root?.properties?.games?.items : root?.properties?.game;
    if (!game || game.required?.includes("matchmakingModes")) return false;
    delete game.properties.matchmakingModes;
  }
  return compatibleAuthContract(baseline, projection);
}
