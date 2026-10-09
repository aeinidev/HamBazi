import type { createDatabase } from "@hambazi/database";
import type { RegistrationRepository } from "../../application/registration.js";
export function createRegistrationRepository(
  database: ReturnType<typeof createDatabase>,
): RegistrationRepository {
  const scope = database.forModule("users");
  const view = (
    row: {
      id: string;
      displayName: string;
      status: string;
      registrationCompletedAt: Date | null;
    } | null,
  ) =>
    row?.status === "ACTIVE"
      ? {
          userId: row.id,
          displayName: row.displayName,
          completed: row.registrationCompletedAt !== null,
        }
      : undefined;
  return {
    async read(telegramUserId) {
      return view(
        await scope.execute((db) =>
          db.user.findUnique({
            where: { telegramUserId },
            select: { id: true, displayName: true, status: true, registrationCompletedAt: true },
          }),
        ),
      );
    },
    async complete(telegramUserId, at) {
      return scope.transaction(async (db) => {
        await db.user.updateMany({
          where: { telegramUserId, status: "ACTIVE", registrationCompletedAt: null },
          data: { registrationCompletedAt: new Date(at) },
        });
        return view(
          await db.user.findUnique({
            where: { telegramUserId },
            select: { id: true, displayName: true, status: true, registrationCompletedAt: true },
          }),
        );
      });
    },
  };
}
