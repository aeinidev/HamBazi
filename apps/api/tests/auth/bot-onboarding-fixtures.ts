import { randomUUID } from "node:crypto";
import { botOnboardingService } from "../../src/auth/application/bot-onboarding.js";
import type {
  Receipt,
  OnboardingFlow,
  BotOnboardingRepository,
} from "../../src/auth/application/bot-onboarding-ports.js";
import { onboardingFixture } from "./onboarding-fixtures.js";
export const botContext = {
  schemaVersion: 1 as const,
  botId: "123",
  scope: "bot:onboarding" as const,
};
export function update(
  action: "START" | "CREATE" | "CANCEL" | "NAME",
  updateId = 1,
  senderId = "100",
) {
  return {
    schemaVersion: 1,
    updateId,
    senderId,
    chatId: senderId,
    chatType: "private",
    messageId: updateId + 1,
    action,
    ...(action === "NAME" ? { replyToMessageId: 900, displayName: "  Mehdi " } : {}),
  };
}
/** Sequential unit-only repository. Concurrency/rollback are tested against PostgreSQL. */
export function botFixture() {
  const f = onboardingFixture();
  const receipts = new Map<string, Receipt>();
  const flows = new Map<string, OnboardingFlow>();
  const repository: BotOnboardingRepository = {
    async claim(candidate) {
      const key = `${candidate.botId}:${candidate.updateId}`;
      const old = receipts.get(key);
      if (!old) {
        receipts.set(key, { ...candidate });
        return { status: "CLAIMED", receipt: { ...candidate } };
      }
      if (
        old.telegramUserId !== candidate.telegramUserId ||
        old.action !== candidate.action ||
        old.messageId !== candidate.messageId ||
        old.replyToMessageId !== candidate.replyToMessageId
      )
        return { status: "INVALID" };
      if (old.expiresAt <= candidate.receivedAt) return { status: "EXPIRED" };
      if (old.phase === "DONE") return { status: "DONE" };
      if (old.leaseUntil > candidate.receivedAt) return { status: "RETRY" };
      const receipt = {
        ...old,
        version: old.version + 1,
        leaseUntil: Math.min(candidate.leaseUntil, old.expiresAt),
      };
      receipts.set(key, receipt);
      return { status: "CLAIMED", receipt: { ...receipt } };
    },
    async transition(claim, now, decide) {
      const at = now();
      const row = [...receipts.values()].find(
        (r) =>
          r.id === claim.id &&
          r.botId === claim.botId &&
          r.version === claim.version &&
          r.expiresAt > at,
      );
      if (!row) return undefined;
      if (row.phase === "DONE") return { ...row };
      if (row.leaseUntil <= at) return undefined;
      const key = `${row.botId}:${row.telegramUserId}`;
      const flow = flows.get(key);
      const next = decide({ ...row }, flow ? { ...flow } : undefined, at);
      if (!next) return undefined;
      if (next.flow === null) flows.delete(key);
      else if (next.flow)
        flows.set(key, { ...next.flow, version: flow?.id === next.flow.id ? flow.version + 1 : 1 });
      const result = {
        ...row,
        phase: next.phase,
        reply: next.reply,
        flowId: next.flowId,
        promptVersion: next.promptVersion,
      };
      receipts.set(`${row.botId}:${row.updateId}`, result);
      return { ...result };
    },
    async cleanup(now, limit) {
      let a = 0,
        b = 0;
      for (const [key, row] of receipts)
        if (a < limit && row.expiresAt <= now) {
          receipts.delete(key);
          a++;
        }
      for (const [key, row] of flows)
        if (b < limit && row.expiresAt <= now) {
          flows.delete(key);
          b++;
        }
      return { receipts: a, flows: b };
    },
  };
  const deps = { ...f, repository, clock: f.clock, newId: randomUUID, leaseMs: 5000 };
  return { ...f, deps, repository, receipts, flows, service: botOnboardingService(deps) };
}
export async function acknowledge(
  service: ReturnType<typeof botOnboardingService>,
  result: Awaited<ReturnType<typeof service.process>>,
  messageId = 900,
) {
  if (!result.ok || !("delivery" in result)) throw new Error("Expected synthetic delivery");
  return service.acknowledge(botContext, {
    schemaVersion: 1,
    receiptId: result.delivery.receiptId,
    version: result.delivery.version,
    messageId,
  });
}
