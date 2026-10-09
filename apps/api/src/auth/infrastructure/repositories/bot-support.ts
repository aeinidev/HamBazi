import type { createDatabase } from "@hambazi/database";
import type {
  SupportRepository,
  SupportSubmission,
} from "../../application/bot-onboarding-ports.js";
type Stored = Omit<
  SupportSubmission,
  "botId" | "telegramUserId" | "adminChatId" | "createdAt" | "leaseUntil"
> & {
  botId: bigint;
  telegramUserId: bigint;
  adminChatId: bigint;
  createdAt: Date;
  leaseUntil: Date;
};
const view = (s: Stored | null): SupportSubmission | undefined =>
  s
    ? {
        ...s,
        botId: String(s.botId),
        telegramUserId: String(s.telegramUserId),
        adminChatId: String(s.adminChatId),
        createdAt: s.createdAt.getTime(),
        leaseUntil: s.leaseUntil.getTime(),
      }
    : undefined;
export function createSupportRepository(
  database: ReturnType<typeof createDatabase>,
): SupportRepository {
  const scope = database.forModule("auth");
  return {
    async find(id, botId) {
      return view(
        await scope.execute((db) =>
          db.botSupportSubmission.findFirst({ where: { id, botId: BigInt(botId) } }),
        ),
      );
    },
    async pending(botId, telegramId) {
      return view(
        await scope.execute((db) =>
          db.botSupportSubmission.findFirst({
            where: {
              botId: BigInt(botId),
              telegramUserId: BigInt(telegramId),
              status: { not: "DELIVERED" },
            },
            orderBy: { createdAt: "asc" },
          }),
        ),
      );
    },
    async acquire(id, botId, now, leaseMs) {
      return scope.transaction(async (db) => {
        // An abandoned in-flight attempt is ambiguous, never automatically resend it.
        await db.botSupportSubmission.updateMany({
          where: {
            id,
            botId: BigInt(botId),
            status: "SENDING",
            leaseUntil: { lte: new Date(now) },
          },
          data: { status: "UNKNOWN" },
        });
        const acquired = await db.botSupportSubmission.updateMany({
          where: { id, botId: BigInt(botId), status: { in: ["PENDING", "FAILED"] } },
          data: {
            status: "SENDING",
            attemptVersion: { increment: 1 },
            leaseUntil: new Date(now + leaseMs),
          },
        });
        const row = view(
          await db.botSupportSubmission.findFirst({ where: { id, botId: BigInt(botId) } }),
        );
        return row && acquired.count ? { ...row, status: "CLAIMED" } : row;
      });
    },
    async settle(id, botId, version, outcome, messageId) {
      return scope.transaction(async (db) => {
        const changed = await db.botSupportSubmission.updateMany({
          where: {
            id,
            botId: BigInt(botId),
            attemptVersion: version,
            status: { in: ["SENDING", "UNKNOWN"] },
          },
          data: { status: outcome, deliveryMessageId: messageId ?? null },
        });
        if (changed.count) return true;
        const same = await db.botSupportSubmission.findFirst({
          where: {
            id,
            botId: BigInt(botId),
            attemptVersion: version,
            status: outcome,
            deliveryMessageId: messageId ?? null,
          },
        });
        return !!same;
      });
    },
  };
}
