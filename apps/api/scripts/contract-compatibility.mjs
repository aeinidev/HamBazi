import { isDeepStrictEqual } from "node:util";
// Conservative v1 freeze: new paths allowed; existing wire schemas/security cannot drift.
// Descriptions may improve without changing wire semantics. Schema relaxations also need review.
function semantic(value) {
  if (Array.isArray(value)) return value.map(semantic);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "description")
        .map(([key, v]) => [key, semantic(v)]),
    );
  return value;
}
export function compatibleAuthContract(baseline, candidate) {
  if (
    baseline.openapi !== candidate.openapi ||
    !isDeepStrictEqual(semantic(baseline.components), semantic(candidate.components))
  )
    return false;
  for (const [path, operations] of Object.entries(baseline.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!isDeepStrictEqual(semantic(operation), semantic(candidate.paths?.[path]?.[method])))
        return false;
    }
  }
  return true;
}
