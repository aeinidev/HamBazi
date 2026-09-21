import { randomInt, randomUUID } from "node:crypto";
import { accountCreationService, type AccountCreationPort } from "./application/accounts.js";
import { createAccountRepository } from "./infrastructure/repositories/accounts.js";
import { identityService, type UserIdentityPort } from "./application/identity.js";
import { createIdentityRepository } from "./infrastructure/repositories/identity.js";

export function createUserIdentityPort(
  database: Parameters<typeof createIdentityRepository>[0],
): UserIdentityPort {
  return identityService(createIdentityRepository(database));
}

export function createAccountCreationPort(
  database: Parameters<typeof createAccountRepository>[0],
): AccountCreationPort {
  return accountCreationService({
    repository: createAccountRepository(database),
    newUserId: randomUUID,
    newHandleSuffix: () => randomInt(10000, 100000),
  });
}
