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
