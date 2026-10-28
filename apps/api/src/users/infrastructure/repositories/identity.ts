import type { createDatabase } from "@hambazi/database";
import { createRestrictionExpiry } from "./restrictions.js";
import type { IdentityRepository } from "../../application/identity.js";

export function createIdentityRepository(
  database: ReturnType<typeof createDatabase>,
  clock: { nowMs(): number } = { nowMs: () => Date.now() },
): IdentityRepository {
  const scope = database.forModule("users");
  const expiry = createRestrictionExpiry(database, clock);
  async function refresh<T extends { id: string; status: string }>(user: T | null, userId: string) {
    if (user?.status !== "BANNED") return user;
    await expiry.expire(user.id);
    return scope.execute((db) =>
      db.user.findUnique({
        where: { id: userId },
        select: { id: true, status: true, authVersion: true, registrationCompletedAt: true },
      }),
    );
  }
  return Object.freeze({
    async findByTelegramId(id: bigint) {
      const found = await scope.execute((db) =>
        db.user.findUnique({
          where: { telegramUserId: id },
          select: { id: true, status: true, authVersion: true, registrationCompletedAt: true },
        }),
      );
      const user = found ? await refresh(found, found.id) : null;
      return user
        ? {
            userId: user.id,
            status: user.status,
            authVersion: user.authVersion,
            registrationCompleted: user.registrationCompletedAt !== null,
          }
        : undefined;
    },
    async findById(userId: string) {
      const found = await scope.execute((db) =>
        db.user.findUnique({
          where: { id: userId },
          select: { id: true, status: true, authVersion: true, registrationCompletedAt: true },
        }),
      );
      const user = found ? await refresh(found, found.id) : null;
      return user
        ? {
            userId: user.id,
            status: user.status,
            authVersion: user.authVersion,
            registrationCompleted: user.registrationCompletedAt !== null,
          }
        : undefined;
    },
  });
}
