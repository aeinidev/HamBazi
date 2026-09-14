import { identityService, type UserIdentityPort } from "./application/identity.js";
import { createIdentityRepository } from "./infrastructure/repositories/identity.js";

export function createUserIdentityPort(
  database: Parameters<typeof createIdentityRepository>[0],
): UserIdentityPort {
  return identityService(createIdentityRepository(database));
}
