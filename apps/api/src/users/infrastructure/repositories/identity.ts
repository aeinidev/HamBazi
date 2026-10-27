import type { createDatabase } from "@hambazi/database";
import type { IdentityRepository } from "../../application/identity.js";

export function createIdentityRepository(
  database: ReturnType<typeof createDatabase>,
): IdentityRepository {
  const scope = database.forModule("users");
  return Object.freeze({
    async findByTelegramId(id: bigint) {
      const user = await scope.execute((db) =>
        db.user.findUnique({
          where: { telegramUserId: id },
          select: { id: true, status: true, authVersion: true, registrationCompletedAt: true },
        }),
      );
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
      const user = await scope.execute((db) =>
        db.user.findUnique({
          where: { id: userId },
          select: { id: true, status: true, authVersion: true, registrationCompletedAt: true },
        }),
      );
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
