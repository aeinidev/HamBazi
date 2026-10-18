/** Per-image provenance is additive; retained components keep their original source. */
export function componentSourceCommit(inventory, item) {
  const commit = item.sourceCommit ?? inventory.sourceCommit;
  if (!/^[a-f0-9]{40}$/.test(commit ?? "")) throw new Error("STAGING_COMPONENT_PROVENANCE_INVALID");
  return commit;
}

export function selectedComponentRoles(roles = ["ingress", "acme"]) {
  if (
    !Array.isArray(roles) ||
    roles.length < 1 ||
    roles.length > 2 ||
    new Set(roles).size !== roles.length ||
    roles.some((role) => !["ingress", "acme"].includes(role))
  )
    throw new Error("STAGING_COMPONENT_ROLE_INVALID");
  return roles;
}
