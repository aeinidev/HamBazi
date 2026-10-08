import type { UserIdentityPort } from "../../users/index.js";

export interface OwnerAdmission {
  telegramId(): Promise<string | undefined>;
  allowsTelegramId(id: string): Promise<boolean>;
  allowsUserId(id: string): Promise<boolean>;
}

/** Auth owns admission. Storage failures, policy removal and unknown users deny. */
export function ownerAdmissionPolicy(deps: {
  readOwner(): Promise<string | undefined>;
  users?: UserIdentityPort;
}): OwnerAdmission {
  async function telegramId() {
    try {
      return await deps.readOwner();
    } catch {
      return undefined;
    }
  }
  return Object.freeze({
    telegramId,
    async allowsTelegramId(id: string) {
      const current = await telegramId();
      return current !== undefined && current === id;
    },
    async allowsUserId(id: string) {
      try {
        const current = await telegramId();
        if (!current || !deps.users) return false;
        const user = await deps.users.findActiveByTelegramId(current);
        return user?.userId === id && (await telegramId()) === current;
      } catch {
        return false;
      }
    },
  });
}
