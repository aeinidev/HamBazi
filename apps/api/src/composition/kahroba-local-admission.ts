import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { z } from "zod";
import type { OwnerAdmission } from "../auth/index.js";
import type { UserIdentityPort } from "../users/index.js";
const policy = z
  .strictObject({
    schemaVersion: z.literal(1),
    purpose: z.literal("kahroba-local-synthetic-only"),
    telegramUserIds: z
      .array(z.string().regex(/^[1-9][0-9]{0,15}$/))
      .min(2)
      .max(4),
  })
  .refine((v) => new Set(v.telegramUserIds).size === v.telegramUserIds.length);
/** Only selected after the pure local/loopback configuration guard. No real staging identities. */
export function createKahrobaLocalAdmission(path: string, users: UserIdentityPort): OwnerAdmission {
  async function admittedTelegramIds(): Promise<readonly string[]> {
    try {
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const s = await file.stat();
        if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o077) !== 0 || s.size > 4096) return [];
        const bytes = await file.readFile(),
          fresh = await file.stat();
        if (fresh.nlink !== 1 || (fresh.mode & 0o077) !== 0 || fresh.size !== bytes.length)
          return [];
        return policy.parse(JSON.parse(bytes.toString("utf8"))).telegramUserIds;
      } finally {
        await file.close();
      }
    } catch {
      return [];
    }
  }
  return Object.freeze({
    admittedTelegramIds,
    telegramId: async () => (await admittedTelegramIds())[0],
    allowsTelegramId: async (id: string) => (await admittedTelegramIds()).includes(id),
    async allowsUserId(id: string) {
      for (const telegramId of await admittedTelegramIds()) {
        const user = await users.findActiveByTelegramId(telegramId);
        if (user?.userId === id && (await admittedTelegramIds()).includes(telegramId)) return true;
      }
      return false;
    },
  });
}
