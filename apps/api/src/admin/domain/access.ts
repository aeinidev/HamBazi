export const adminCapabilities = [
  "overview.view",
  "users.view",
  "games.view",
  "rooms.view",
  "matches.view",
  "monitoring.view",
  "audit.view",
] as const;
export type AdminCapability = (typeof adminCapabilities)[number];
export interface AdminGrant {
  permission: string;
  environment: string;
  gameIds: readonly string[] | null;
  deny: boolean;
}
export interface AdminPrincipal {
  operatorId: string;
  isOwner: boolean;
  environment: string;
  authorizationVersion: number;
  policyRevision: number;
  grants: readonly AdminGrant[];
}
/** Only the entitlement layer has an OWNER branch. Identity and domain guards run separately. */
export function adminAccess(principal: AdminPrincipal, permission: string, gameId?: string) {
  if (!(adminCapabilities as readonly string[]).includes(permission)) return false;
  if (principal.isOwner) return true;
  const matching = principal.grants.filter(
    (g) =>
      g.permission === permission &&
      g.environment === principal.environment &&
      (g.gameIds === null || (gameId !== undefined && g.gameIds.includes(gameId))),
  );
  return matching.some((g) => !g.deny) && !matching.some((g) => g.deny);
}
export function adminGameScope(
  principal: AdminPrincipal,
  permission: string,
): readonly string[] | null {
  if (!(adminCapabilities as readonly string[]).includes(permission)) return [];
  if (principal.isOwner) return null;
  const grants = principal.grants.filter(
    (g) => g.permission === permission && g.environment === principal.environment,
  );
  const allowed = grants.filter((g) => !g.deny);
  const denied = grants.filter((g) => g.deny);
  if (denied.some((g) => g.gameIds === null)) return [];
  // A global allow with game-specific denials needs a NOT IN query, which this read port does not expose.
  // Deny safely rather than silently widening the scope.
  if (allowed.some((g) => g.gameIds === null)) return denied.length ? [] : null;
  const denyIds = new Set(denied.flatMap((g) => g.gameIds ?? []));
  return [...new Set(allowed.flatMap((g) => g.gameIds ?? []))].filter((id) => !denyIds.has(id));
}
