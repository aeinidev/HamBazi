import type { UserIdentityPort } from "../../users/index.js";

export interface OwnerAdmission {
  telegramId(): Promise<string | undefined>;
  admittedTelegramIds(): Promise<readonly string[]>;
  allowsTelegramId(id: string): Promise<boolean>;
  allowsUserId(id: string): Promise<boolean>;
}

/** Auth owns admission. Storage failures, policy removal and unknown users deny. */
export function ownerAdmissionPolicy(deps: {
  readOwner(): Promise<string | undefined>;
  readTestUser?: () => Promise<string | undefined>;
  users?: UserIdentityPort;
}): OwnerAdmission {
  async function telegramId() {
    try {
      return await deps.readOwner();
    } catch {
      return undefined;
    }
  }
  async function admittedTelegramIds() {
    const owner = await telegramId();
    if (!owner) return [];
    let test: string | undefined;
    try {
      test = await deps.readTestUser?.();
    } catch {
      /* A missing exception denies only the tester. */
    }
    if ((await telegramId()) !== owner) return [];
    return test && test !== owner ? [owner, test] : [owner];
  }
  return Object.freeze({
    telegramId,
    admittedTelegramIds,
    async allowsTelegramId(id: string) {
      return (await admittedTelegramIds()).includes(id);
    },
    async allowsUserId(id: string) {
      try {
        if (!deps.users) return false;
        for (const telegramId of await admittedTelegramIds()) {
          const user = await deps.users.findActiveByTelegramId(telegramId);
          if (user?.userId === id && (await admittedTelegramIds()).includes(telegramId))
            return true;
        }
        return false;
      } catch {
        return false;
      }
    },
  });
}
