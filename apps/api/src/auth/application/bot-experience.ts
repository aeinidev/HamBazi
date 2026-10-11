import type { RegistrationPort } from "../../users/index.js";
import type { OwnerAdmission } from "./owner-admission.js";
import type { BotServiceContext } from "./bot-service.js";
import type { botOnboardingUpdateSchema } from "./bot-onboarding.js";
import type { z } from "zod";
import type {
  BotOnboardingRepository,
  Receipt,
  OnboardingFlow,
  Transition,
  BotReply,
  SupportRepository,
} from "./bot-onboarding-ports.js";
const retry = () => ({ ok: true as const, schemaVersion: 1 as const, status: "RETRY" as const });
export async function botExperience(
  deps: {
    repository: BotOnboardingRepository;
    registration: RegistrationPort;
    support?: SupportRepository;
    ownerAdmission?: OwnerAdmission;
    supportTimeoutMs?: number;
    leaseMs: number;
    newId(): string;
    now(): number;
    delivery(r: Receipt): {
      ok: true;
      schemaVersion: 1;
      status: "REPLY";
      delivery: {
        receiptId: string;
        version: number;
        updateId: number;
        chatId: string;
        reply: BotReply;
        data?: Receipt["replyData"];
      };
    };
    reply(r: Receipt, outcome: BotReply, flow?: OnboardingFlow | null): Transition;
  },
  context: BotServiceContext,
  update: z.infer<typeof botOnboardingUpdateSchema>,
  receipt: Receipt,
) {
  const profile = await deps.registration.read(update.senderId);
  const registered = profile?.completed === true;
  const admin = deps.ownerAdmission ? await deps.ownerAdmission.telegramId() : undefined;
  const pending =
    deps.support && registered
      ? await deps.support.pending(context.botId, update.senderId)
      : undefined;
  const timeout = deps.supportTimeoutMs ?? 900000;
  if (!Number.isInteger(timeout) || timeout < 60000 || timeout > 900000)
    throw new Error("Invalid support timeout");
  const flowId = deps.newId(),
    submissionId = deps.newId();
  const planned = await deps.repository.transition(receipt, deps.now, (r, stored, now) => {
    if (r.phase === "REPLY")
      return {
        phase: "REPLY",
        reply: r.reply as BotReply,
        replyData: r.replyData,
        flowId: r.flowId,
        promptVersion: r.promptVersion,
      };
    const respond = (reply: BotReply, flow?: OnboardingFlow | null): Transition =>
      deps.reply(r, reply, flow);
    if (!registered) return respond("CREATE_ACCOUNT", stored ? null : undefined);
    if (update.action === "REGISTER") return respond("REGISTERED", stored ? null : undefined);
    if (update.action === "START") return respond("WELCOME_REGISTERED", stored ? null : undefined);
    if (update.action === "PROFILE")
      return {
        ...respond("PROFILE", stored ? null : undefined),
        replyData: {
          profile: profile
            ? {
                userId: profile.userId,
                displayName: profile.displayName,
                completed: profile.completed,
              }
            : undefined,
        },
      };
    if (update.action === "CANCEL" || update.action === "NAVIGATION")
      return respond("SUPPORT_CANCELLED", stored ? null : undefined);
    if (update.action === "SUPPORT") {
      if (!admin || !deps.support) return respond("SUPPORT_UNAVAILABLE", stored ? null : undefined);
      if (pending)
        return {
          ...respond("SUPPORT_DISPATCH", stored ? null : undefined),
          replyData: { submissionId: pending.id },
        };
      if (stored?.state === "SUPPORT_COMPOSING" && stored.expiresAt > now)
        return respond("SUPPORT_PROMPT");
      const flow: OnboardingFlow = {
        id: flowId,
        botId: context.botId,
        telegramUserId: update.senderId,
        schemaVersion: 1,
        version: 1,
        state: "SUPPORT_COMPOSING",
        createdAt: now,
        expiresAt: now + timeout,
        promptVersion: 1,
        promptMessageId: null,
        admittedReceiptId: null,
      };
      return respond("SUPPORT_PROMPT", flow);
    }
    if (!stored || stored.state !== "SUPPORT_COMPOSING" || stored.expiresAt <= now) {
      // Ordinary messages outside composition have no delivery effect.
      return {
        ...respond(
          stored?.state === "SUPPORT_COMPOSING" ? "EXPIRED" : "MENU",
          stored ? null : undefined,
        ),
        phase: stored?.state === "SUPPORT_COMPOSING" ? "REPLY" : "DONE",
      };
    }
    if (update.action !== "TEXT") return respond("SUPPORT_TEXT_REQUIRED");
    // One Telegram text including its administrator-only envelope, never truncate.
    if (update.text.length > 3500) return respond("SUPPORT_TOO_LONG");
    if (!admin || !deps.support || !profile) return respond("SUPPORT_UNAVAILABLE");
    return {
      ...respond("SUPPORT_DISPATCH", null),
      replyData: { submissionId },
      submission: {
        id: submissionId,
        botId: context.botId,
        telegramUserId: update.senderId,
        receiptId: r.id,
        profileId: profile.userId,
        displayName: profile.displayName,
        text: update.text,
        adminChatId: admin,
        status: "PENDING",
        attemptVersion: 0,
        leaseUntil: now,
        deliveryMessageId: null,
        createdAt: now,
      },
    };
  });
  if (!planned) return retry();
  if (planned.phase === "DONE")
    return { ok: true as const, schemaVersion: 1 as const, status: "DONE" as const };
  if (planned.reply !== "SUPPORT_DISPATCH") return deps.delivery(planned);
  const id = planned.replyData?.submissionId;
  if (!id || !deps.support || !admin) return retry();
  const prior = await deps.support.find(id, context.botId);
  if (receipt.phase === "REPLY" && prior?.status === "FAILED") {
    const failed = await deps.repository.transition(receipt, deps.now, (r) => ({
      ...deps.reply(r, "SUPPORT_FAILED"),
      replyData: planned.replyData,
    }));
    return failed ? deps.delivery(failed) : retry();
  }
  const submission = await deps.support.acquire(id, context.botId, deps.now(), deps.leaseMs);
  if (
    !submission ||
    submission.telegramUserId !== update.senderId ||
    submission.adminChatId !== admin
  )
    return retry();
  if (submission.status === "CLAIMED")
    return {
      ok: true as const,
      schemaVersion: 1 as const,
      status: "SUPPORT" as const,
      delivery: {
        ...deps.delivery(planned).delivery,
        reply: "SUPPORT_DISPATCH" as const,
        submissionId: id,
        attemptVersion: submission.attemptVersion,
        adminChatId: submission.adminChatId,
        text: `پیام پشتیبانی هم‌بازی\nپروفایل: ${submission.profileId}\nنام: ${submission.displayName}\nشناسه پیگیری: ${submission.id}\n\n${submission.text}`,
      },
    };
  const updated = await deps.repository.transition(receipt, deps.now, (r) => ({
    ...deps.reply(
      r,
      submission.status === "DELIVERED"
        ? "SUPPORT_SENT"
        : submission.status === "FAILED"
          ? "SUPPORT_FAILED"
          : "SUPPORT_UNKNOWN",
    ),
    replyData: planned.replyData,
  }));
  return updated ? deps.delivery(updated) : retry();
}
