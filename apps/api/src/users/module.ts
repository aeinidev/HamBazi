import { registrationService } from "./application/registration.js";
import { createRegistrationRepository } from "./infrastructure/repositories/registration.js";
import { randomInt, randomUUID } from "node:crypto";
import { accountCreationService, type AccountCreationPort } from "./application/accounts.js";
import { createAccountRepository } from "./infrastructure/repositories/accounts.js";
import { identityService, type UserIdentityPort } from "./application/identity.js";
import { createIdentityRepository } from "./infrastructure/repositories/identity.js";
import { profileService } from "./application/profile.js";
import { createProfileRepository } from "./infrastructure/repositories/profile.js";

export function createProfilePort(
  database: Parameters<typeof createProfileRepository>[0],
  clock: { nowMs(): number },
) {
  return profileService(createProfileRepository(database, clock));
}
export function createProfileCleanup(
  database: Parameters<typeof createProfileRepository>[0],
  clock: { nowMs(): number },
) {
  const repository = createProfileRepository(database, clock);
  return async (input: { schemaVersion: 1; limit: number }) => {
    try {
      if (input.schemaVersion !== 1) return { ok: false as const };
      return { ok: true as const, receipts: await repository.cleanup(input.limit), flows: 0 };
    } catch {
      return { ok: false as const };
    }
  };
}

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

import { publicNamesService } from "./application/public-names.js";
import { createPublicNamesRepository } from "./infrastructure/repositories/public-names.js";
export function createPublicNamesPort(database: Parameters<typeof createPublicNamesRepository>[0]) {
  return publicNamesService(createPublicNamesRepository(database));
}

export function createRegistrationPort(
  database: Parameters<typeof createRegistrationRepository>[0],
  clock: { nowMs(): number },
) {
  return registrationService({
    repository: createRegistrationRepository(database),
    accounts: createAccountCreationPort(database),
    clock,
  });
}

export { createUsersAdminReadRepository as createUsersAdminRead } from "./infrastructure/repositories/admin-read.js";
