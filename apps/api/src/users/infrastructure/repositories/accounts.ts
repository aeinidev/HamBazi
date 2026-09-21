import type { createDatabase } from "@hambazi/database";
import type { AccountCandidate, AccountRepository } from "../../application/accounts.js";

export function createAccountRepository(
  database: ReturnType<typeof createDatabase>,
): AccountRepository {
  const scope = database.forModule("users");
  return Object.freeze({
    async findByTelegramId(telegramUserId: bigint) {
      const row = await scope.execute((db) =>
        db.user.findUnique({
          where: { telegramUserId },
          select: { id: true, displayName: true, publicHandle: true, status: true },
        }),
      );
      return row
        ? {
            userId: row.id,
            displayName: row.displayName,
            publicHandle: row.publicHandle,
            status: row.status,
          }
        : undefined;
    },
    async createOrGet(candidate: AccountCandidate) {
      return scope.transaction(async (db) => {
        await db.user.createMany({
          data: [
            {
              id: candidate.userId,
              telegramUserId: candidate.telegramUserId,
              displayName: candidate.displayName,
              publicHandle: candidate.publicHandle,
              status: "ACTIVE",
            },
          ],
          skipDuplicates: true,
        });
        // A separate READ COMMITTED statement sees the winning concurrent insert.
        const row = await db.user.findUnique({
          where: { telegramUserId: candidate.telegramUserId },
          select: { id: true, displayName: true, publicHandle: true, status: true },
        });
        return row
          ? {
              userId: row.id,
              displayName: row.displayName,
              publicHandle: row.publicHandle,
              status: row.status,
            }
          : undefined;
      });
    },
  });
}
