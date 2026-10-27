import { adminPermissionSchema } from "@hambazi/validation";
export const adminCapabilities = adminPermissionSchema.options;
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
  if (/^(admins|roles)\./.test(permission)) return false;
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
  const scope = adminReadScope(principal, permission);
  // Aggregate ports cannot subtract a game; deny them rather than disclose excluded counts.
  return scope.excluded.length ? [] : scope.games;
}
export function adminReadScope(
  principal: AdminPrincipal,
  permission: string,
): { games: readonly string[] | null; excluded: readonly string[] } {
  if (!(adminCapabilities as readonly string[]).includes(permission))
    return { games: [], excluded: [] };
  if (principal.isOwner) return { games: null, excluded: [] };
  if (/^(admins|roles)\./.test(permission)) return { games: [], excluded: [] };
  const grants = principal.grants.filter(
    (g) => g.permission === permission && g.environment === principal.environment,
  );
  const allowed = grants.filter((g) => !g.deny);
  const denied = grants.filter((g) => g.deny);
  if (denied.some((g) => g.gameIds === null)) return { games: [], excluded: [] };
  const denyIds = new Set(denied.flatMap((g) => g.gameIds ?? []));
  if (allowed.some((g) => g.gameIds === null)) return { games: null, excluded: [...denyIds] };
  return {
    games: [...new Set(allowed.flatMap((g) => g.gameIds ?? []))].filter((id) => !denyIds.has(id)),
    excluded: [],
  };
}
