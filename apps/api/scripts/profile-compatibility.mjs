import { compatibleAuthContract } from "./contract-compatibility.mjs";
/** ADR-080 adds only optional profile fields; freeze every legacy wire field. */
export function compatibleLegacyProfile(baseline, candidate) {
  const projection = JSON.parse(JSON.stringify(candidate));
  const profile = projection.paths?.["/v1/me"];
  const response = profile?.get?.responses?.["200"]?.content?.["application/json"]?.schema;
  const patch =
    profile?.patch?.requestBody?.content?.["application/json"]?.schema?.properties?.patch;
  for (const schema of [response, patch]) {
    if (!schema?.properties) return false;
    for (const key of ["username", "avatar"]) {
      if (schema.required?.includes(key)) return false;
      delete schema.properties[key];
    }
  }
  return compatibleAuthContract(baseline, projection);
}
