import { z } from "zod";
import type { createDatabase } from "@hambazi/database";
import type {
  BotOnboardingRepository,
  Receipt,
  OnboardingFlow,
} from "../../application/bot-onboarding-ports.js";

type StoredReceipt = Omit<
  Receipt,
  "replyData" | "botId" | "telegramUserId" | "receivedAt" | "expiresAt" | "leaseUntil"
> & {
  replyData?: unknown;
  botId: bigint;
  telegramUserId: bigint;
  receivedAt: Date;
  expiresAt: Date;
  leaseUntil: Date;
};
type StoredFlow = Omit<OnboardingFlow, "botId" | "telegramUserId" | "createdAt" | "expiresAt"> & {
  botId: bigint;
  telegramUserId: bigint;
  createdAt: Date;
  expiresAt: Date;
};
const receiptView = (r: StoredReceipt): Receipt => ({
  ...r,
  replyData:
    r.replyData === null || r.replyData === undefined
      ? null
      : z
          .object({
            profile: z
              .object({ userId: z.uuid(), displayName: z.string(), completed: z.boolean() })
              .optional(),
            submissionId: z.uuid().optional(),
          })
          .parse(r.replyData),
  botId: String(r.botId),
  telegramUserId: String(r.telegramUserId),
  receivedAt: r.receivedAt.getTime(),
  expiresAt: r.expiresAt.getTime(),
  leaseUntil: r.leaseUntil.getTime(),
});
const flowView = (r: StoredFlow): OnboardingFlow => ({
  ...r,
  botId: String(r.botId),
  telegramUserId: String(r.telegramUserId),
  createdAt: r.createdAt.getTime(),
  expiresAt: r.expiresAt.getTime(),
});
export function createBotOnboardingRepository(
  database: ReturnType<typeof createDatabase>,
): BotOnboardingRepository {
  const scope = database.forModule("auth");
  return {
    async claim(candidate) {
      return scope.transaction(async (db) => {
        const inserted = await db.botUpdateReceipt.createMany({
          data: [
            {
              id: candidate.id,
              updateId: candidate.updateId,
              messageId: candidate.messageId,
              replyToMessageId: candidate.replyToMessageId,
              schemaVersion: candidate.schemaVersion,
              action: candidate.action,
              phase: candidate.phase,
              version: candidate.version,
              reply: candidate.reply,
              flowId: candidate.flowId,
              promptVersion: candidate.promptVersion,
              botId: BigInt(candidate.botId),
              telegramUserId: BigInt(candidate.telegramUserId),
              receivedAt: new Date(candidate.receivedAt),
              expiresAt: new Date(candidate.expiresAt),
              leaseUntil: new Date(candidate.leaseUntil),
            },
          ],
          skipDuplicates: true,
        });
        const stored = await db.botUpdateReceipt.findUniqueOrThrow({
          where: {
            botId_updateId: { botId: BigInt(candidate.botId), updateId: candidate.updateId },
          },
        });
        const r = receiptView(stored);
        if (
          r.telegramUserId !== candidate.telegramUserId ||
          r.action !== candidate.action ||
          r.messageId !== candidate.messageId ||
          r.replyToMessageId !== candidate.replyToMessageId
        )
          return { status: "INVALID" };
        if (r.expiresAt <= candidate.receivedAt) return { status: "EXPIRED" };
        if (r.phase === "DONE") return { status: "DONE" };
        if (inserted.count === 1) return { status: "CLAIMED", receipt: r };
        if (r.leaseUntil > candidate.receivedAt) return { status: "RETRY" };
        const leaseUntil = Math.min(candidate.leaseUntil, r.expiresAt);
        const updated = await db.botUpdateReceipt.updateMany({
          where: {
            id: r.id,
            version: r.version,
            phase: { not: "DONE" },
            leaseUntil: { lte: new Date(candidate.receivedAt) },
          },
          data: { version: { increment: 1 }, leaseUntil: new Date(leaseUntil) },
        });
        return updated.count
          ? { status: "CLAIMED", receipt: { ...r, version: r.version + 1, leaseUntil } }
          : { status: "RETRY" };
      });
    },
    async transition(claim, now, decide) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const result = await scope.transaction(async (db) => {
          // A no-op UPDATE locks only this receipt; no cross-module I/O occurs here.
          const lock = await db.botUpdateReceipt.updateMany({
            where: {
              id: claim.id,
              botId: BigInt(claim.botId),
              version: claim.version,
              phase: { not: "DONE" },
              expiresAt: { gt: new Date(now()) },
              leaseUntil: { gt: new Date(now()) },
            },
            data: { version: claim.version },
          });
          if (!lock.count) {
            const done = await db.botUpdateReceipt.findFirst({
              where: {
                id: claim.id,
                botId: BigInt(claim.botId),
                version: claim.version,
                phase: "DONE",
                expiresAt: { gt: new Date(now()) },
              },
            });
            return { retry: false, receipt: done ? receiptView(done) : undefined };
          }
          const stored = await db.botUpdateReceipt.findUniqueOrThrow({ where: { id: claim.id } });
          const key = { botId: stored.botId, telegramUserId: stored.telegramUserId };
          const old = await db.botOnboardingFlow.findUnique({
            where: { botId_telegramUserId: key },
          });
          // Re-sample after lock waits/reads; a pre-transaction timestamp is not a lease guard.
          const at = now();
          if (stored.expiresAt.getTime() <= at || stored.leaseUntil.getTime() <= at)
            return { retry: false, receipt: undefined };
          const next = decide(receiptView(stored), old ? flowView(old) : undefined, at);
          if (!next) return { retry: false, receipt: undefined };
          if (next.flow !== undefined) {
            if (old) {
              if (next.flow === null || next.flow.id !== old.id) {
                const removed = await db.botOnboardingFlow.deleteMany({
                  where: { id: old.id, version: old.version },
                });
                if (!removed.count) return { retry: true, receipt: undefined };
              } else {
                const f = next.flow;
                const updated = await db.botOnboardingFlow.updateMany({
                  where: { id: old.id, version: old.version },
                  data: {
                    version: old.version + 1,
                    state: f.state,
                    promptVersion: f.promptVersion,
                    promptMessageId: f.promptMessageId,
                    admittedReceiptId: f.admittedReceiptId,
                  },
                });
                if (!updated.count) return { retry: true, receipt: undefined };
              }
            }
            if (next.flow && (!old || next.flow.id !== old.id)) {
              // If a replacement insert conflicts after deletion, throwing rolls it all back.
              await db.botOnboardingFlow.create({
                data: {
                  id: next.flow.id,
                  botId: key.botId,
                  telegramUserId: key.telegramUserId,
                  schemaVersion: next.flow.schemaVersion,
                  version: next.flow.version,
                  state: next.flow.state,
                  promptVersion: next.flow.promptVersion,
                  promptMessageId: next.flow.promptMessageId,
                  admittedReceiptId: next.flow.admittedReceiptId,
                  createdAt: new Date(next.flow.createdAt),
                  expiresAt: new Date(next.flow.expiresAt),
                },
              });
            }
          }
          if (next.submission) {
            const s = next.submission;
            await db.botSupportSubmission.create({
              data: {
                id: s.id,
                receiptId: s.receiptId,
                profileId: s.profileId,
                displayName: s.displayName,
                text: s.text,
                status: s.status,
                attemptVersion: s.attemptVersion,
                deliveryMessageId: s.deliveryMessageId,
                botId: BigInt(s.botId),
                telegramUserId: BigInt(s.telegramUserId),
                adminChatId: BigInt(s.adminChatId),
                createdAt: new Date(s.createdAt),
                leaseUntil: new Date(s.leaseUntil),
              },
            });
          }
          if (next.replyData)
            await db.botUpdateReceipt.update({
              where: { id: claim.id },
              data: { replyData: next.replyData },
            });
          const receipt = await db.botUpdateReceipt.update({
            where: { id: claim.id },
            data: {
              phase: next.phase,
              reply: next.reply,
              flowId: next.flowId,
              promptVersion: next.promptVersion,
            },
          });
          const committedAt = now();
          if (
            stored.expiresAt.getTime() <= committedAt ||
            stored.leaseUntil.getTime() <= committedAt ||
            (next.flow && next.flow.expiresAt <= committedAt)
          ) {
            // Throwing here rolls back both writes if a later row-lock wait crossed a deadline.
            throw new Error("Onboarding transition deadline exceeded");
          }
          return { retry: false, receipt: receiptView(receipt) };
        });
        if (!result.retry) return result.receipt;
      }
      return undefined;
    },
    async cleanup(now, limit) {
      return scope.transaction(async (db) => {
        const receipts = await db.botUpdateReceipt.findMany({
          where: { expiresAt: { lte: new Date(now) } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          take: limit,
          select: { id: true },
        });
        const flows = await db.botOnboardingFlow.findMany({
          where: { expiresAt: { lte: new Date(now) } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          take: limit,
          select: { id: true },
        });
        const a = await db.botUpdateReceipt.deleteMany({
          where: { id: { in: receipts.map((r) => r.id) }, expiresAt: { lte: new Date(now) } },
        });
        const b = await db.botOnboardingFlow.deleteMany({
          where: { id: { in: flows.map((r) => r.id) }, expiresAt: { lte: new Date(now) } },
        });
        return { receipts: a.count, flows: b.count };
      });
    },
  };
}
