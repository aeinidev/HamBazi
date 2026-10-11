import { botExperience } from "./bot-experience.js";
import type { RegistrationPort } from "../../users/index.js";
import type { SupportRepository } from "./bot-onboarding-ports.js";
import { z } from "zod";
import { createErrorEnvelope } from "@hambazi/contracts";
import type { AccountCreationPort, UserIdentityPort } from "../../users/index.js";
import type { BotServiceContext } from "./bot-service.js";
import type { SessionClock } from "./session-ports.js";
import type { OwnerAdmission } from "./owner-admission.js";
import { botCleanupService } from "./bot-cleanup.js";
import {
  FLOW_LIFETIME_MS,
  RECEIPT_LIFETIME_MS,
  type BotOnboardingRepository,
  type BotReply,
  type Receipt,
  type OnboardingFlow,
  type Transition,
} from "./bot-onboarding-ports.js";

const id = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/)
  .pipe(z.string().refine((v) => BigInt(v) <= 9007199254740991n));
const messageId = z.number().int().min(1).max(2147483647);
const base = {
  schemaVersion: z.literal(1),
  updateId: z.number().int().min(0).max(2147483647),
  senderId: id,
  chatId: id,
  chatType: z.literal("private"),
  messageId,
};
export const legacyBotOnboardingUpdateSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...base, action: z.literal("START") }),
  z.strictObject({ ...base, action: z.literal("CREATE") }),
  z.strictObject({ ...base, action: z.literal("CANCEL") }),
  z.strictObject({
    ...base,
    action: z.literal("NAME"),
    replyToMessageId: messageId,
    displayName: z.string().max(256),
  }),
]);
export const legacyBotOnboardingAckSchema = z.strictObject({
  schemaVersion: z.literal(1),
  receiptId: z.uuid(),
  version: z.number().int().positive().max(2147483647),
  messageId,
});
/** Internal operation DTOs, not raw Telegram update schemas or public HTTP routes. */
export const botOnboardingUpdateSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...base, action: z.literal("START") }),
  z.strictObject({ ...base, action: z.literal("CREATE") }),
  z.strictObject({ ...base, action: z.literal("CANCEL") }),
  z.strictObject({
    ...base,
    action: z.literal("REGISTER"),
    displayName: z.string().min(1).max(256),
  }),
  z.strictObject({ ...base, action: z.enum(["PROFILE", "SUPPORT", "MEDIA", "NAVIGATION"]) }),
  z.strictObject({ ...base, action: z.literal("TEXT"), text: z.string().min(1).max(4096) }),
  z.strictObject({
    ...base,
    action: z.literal("NAME"),
    replyToMessageId: messageId,
    displayName: z.string().max(256),
  }),
]);
const replyAckSchema = z.strictObject({
  schemaVersion: z.literal(1),
  receiptId: z.uuid(),
  version: z.number().int().positive().max(2147483647),
  messageId,
});
export const botOnboardingAckSchema = z.union([
  replyAckSchema,
  z
    .strictObject({
      schemaVersion: z.literal(1),
      kind: z.literal("SUPPORT"),
      submissionId: z.uuid(),
      attemptVersion: z.number().int().positive(),
      outcome: z.enum(["DELIVERED", "FAILED", "UNKNOWN"]),
      messageId: messageId.optional(),
      // Opt-in continuation; legacy acknowledgements keep their lease semantics.
      receiptClaim: z
        .strictObject({
          receiptId: z.uuid(),
          version: z.number().int().positive().max(2147483647),
        })
        .optional(),
    })
    .refine((v) => (v.outcome === "DELIVERED") === (v.messageId !== undefined)),
]);
const contextSchema = z.strictObject({
  schemaVersion: z.literal(1),
  botId: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .pipe(z.string().refine((v) => BigInt(v) <= 9223372036854775807n)),
  scope: z.literal("bot:onboarding"),
});
const retry = () => ({ ok: true as const, schemaVersion: 1 as const, status: "RETRY" as const });
function reply(r: Receipt, outcome: BotReply, flow?: OnboardingFlow | null): Transition {
  return {
    phase: "REPLY",
    reply: outcome,
    flowId: null,
    promptVersion: null,
    ...(flow !== undefined ? { flow } : {}),
  };
}
function prompt(r: Receipt, flow: OnboardingFlow, invalid = false): Transition {
  const next = {
    ...flow,
    promptVersion: flow.promptVersion + 1,
    promptMessageId: null,
    state: "WAITING",
    admittedReceiptId: null,
  };
  return {
    ...reply(r, invalid ? "INVALID_NAME" : "PROMPT_NAME", next),
    flowId: next.id,
    promptVersion: next.promptVersion,
  };
}
function delivery(r: Receipt) {
  return {
    ok: true as const,
    schemaVersion: 1 as const,
    status: "REPLY" as const,
    delivery: {
      receiptId: r.id,
      version: r.version,
      updateId: r.updateId,
      chatId: r.telegramUserId,
      reply: r.reply as BotReply,
      ...(r.replyData ? { data: r.replyData } : {}),
    },
  };
}

export function botOnboardingService(deps: {
  repository: BotOnboardingRepository;
  accounts: AccountCreationPort;
  users: UserIdentityPort;
  clock: SessionClock;
  newId(): string;
  leaseMs: number;
  ownerAdmission?: OwnerAdmission;
  registration?: RegistrationPort;
  support?: SupportRepository;
  supportTimeoutMs?: number;
}) {
  if (!Number.isSafeInteger(deps.leaseMs) || deps.leaseMs < 1000 || deps.leaseMs > 60000)
    throw new Error("Invalid onboarding lease configuration");
  const now = () => {
    const value = deps.clock.nowMs();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000 - RECEIPT_LIFETIME_MS)
      throw new Error("Invalid onboarding clock");
    return value;
  };
  return Object.freeze({
    async processLegacy(context: BotServiceContext, input: unknown) {
      const legacy = legacyBotOnboardingUpdateSchema.safeParse(input);
      if (!legacy.success) return createErrorEnvelope("INVALID_INPUT");
      return botOnboardingService({
        repository: deps.repository,
        accounts: deps.accounts,
        users: deps.users,
        clock: deps.clock,
        newId: deps.newId,
        leaseMs: deps.leaseMs,
        ...(deps.ownerAdmission ? { ownerAdmission: deps.ownerAdmission } : {}),
      }).process(context, legacy.data);
    },
    /** Call only after service authentication and Bot verification of an original private update. */
    async process(context: BotServiceContext, input: unknown) {
      if (!contextSchema.safeParse(context).success) return createErrorEnvelope("UNAUTHENTICATED");
      const parsed = botOnboardingUpdateSchema.safeParse(input);
      if (!parsed.success || parsed.data.chatId !== parsed.data.senderId)
        return createErrorEnvelope("INVALID_INPUT");
      const update = parsed.data;
      try {
        if (deps.ownerAdmission && !(await deps.ownerAdmission.allowsTelegramId(update.senderId)))
          return createErrorEnvelope("UNAUTHENTICATED");
        const receivedAt = now();
        const id = z.uuid().parse(deps.newId());
        const claim = await deps.repository.claim({
          id,
          botId: context.botId,
          telegramUserId: update.senderId,
          updateId: update.updateId,
          messageId: update.messageId,
          replyToMessageId: update.action === "NAME" ? update.replyToMessageId : null,
          schemaVersion: 1,
          action: update.action,
          phase: "PROCESSING",
          version: 1,
          receivedAt,
          expiresAt: receivedAt + RECEIPT_LIFETIME_MS,
          leaseUntil: receivedAt + deps.leaseMs,
          reply: null,
          flowId: null,
          promptVersion: null,
        });
        if (claim.status === "INVALID") return createErrorEnvelope("INVALID_INPUT");
        if (claim.status !== "CLAIMED")
          return { ok: true as const, schemaVersion: 1 as const, status: claim.status };
        const r = claim.receipt;
        const registration = deps.registration
          ? await deps.registration.read(update.senderId)
          : undefined;
        if (
          deps.registration &&
          (registration?.completed ||
            !["START", "CREATE", "REGISTER", "CANCEL", "NAME"].includes(update.action))
        ) {
          return await botExperience(
            { ...deps, registration: deps.registration, now, delivery, reply },
            context,
            update,
            r,
          );
        }
        if (!["START", "CREATE", "REGISTER", "CANCEL", "NAME"].includes(update.action))
          return retry();
        if (r.phase === "REPLY") {
          const resumed = await deps.repository.transition(r, now, (receipt, flow, at) => {
            if (
              (receipt.reply === "PROMPT_NAME" || receipt.reply === "INVALID_NAME") &&
              (!flow ||
                flow.expiresAt <= at ||
                flow.id !== receipt.flowId ||
                flow.promptVersion !== receipt.promptVersion ||
                flow.state !== "WAITING")
            )
              return reply(receipt, "EXPIRED");
            return {
              phase: "REPLY",
              reply: receipt.reply as BotReply,
              flowId: receipt.flowId,
              promptVersion: receipt.promptVersion,
            };
          });
          return resumed ? delivery(resumed) : retry();
        }
        const active = deps.registration
          ? registration?.completed
          : await deps.users.findActiveByTelegramId(update.senderId);
        const flowId = z.uuid().parse(deps.newId());
        const planned = await deps.repository.transition(r, now, (receipt, stored, at) => {
          const flow = stored && stored.expiresAt > at ? stored : undefined;
          if (active) return reply(receipt, "MENU", stored ? null : undefined);
          if (receipt.phase === "CREATING") {
            return flow?.state === "SUBMITTING" && flow.admittedReceiptId === receipt.id
              ? { phase: "CREATING", reply: null, flowId: flow.id, promptVersion: null }
              : reply(receipt, "EXPIRED");
          }
          if (flow?.state === "SUBMITTING") return undefined;
          if (update.action === "CANCEL")
            return reply(receipt, "CANCELLED", stored ? null : undefined);
          if (
            update.action === "START" ||
            update.action === "CREATE" ||
            update.action === "REGISTER"
          ) {
            if (flow) return prompt(receipt, flow);
            if (update.action === "START") return reply(receipt, "CREATE_ACCOUNT");
            const fresh: OnboardingFlow = {
              id: flowId,
              botId: context.botId,
              telegramUserId: update.senderId,
              schemaVersion: 1,
              version: 1,
              state: "WAITING",
              createdAt: at,
              expiresAt: at + FLOW_LIFETIME_MS,
              promptVersion: 1,
              promptMessageId: null,
              admittedReceiptId: null,
            };
            return { ...reply(receipt, "PROMPT_NAME", fresh), flowId, promptVersion: 1 };
          }
          if (update.action !== "NAME" || !flow || flow.promptMessageId !== update.replyToMessageId)
            return reply(receipt, "EXPIRED");
          return {
            phase: "CREATING",
            reply: null,
            flowId: flow.id,
            promptVersion: null,
            flow: { ...flow, state: "SUBMITTING", admittedReceiptId: receipt.id },
          };
        });
        if (!planned) return retry();
        if (planned.phase === "REPLY") return delivery(planned);
        if (planned.phase !== "CREATING" || update.action !== "NAME") return retry();
        // Irrevocable admission happened above. Users is idempotent by identity;
        // no external operation is executed while the Auth transaction is open.
        const created = deps.registration
          ? await deps.registration.complete(update.senderId, update.displayName)
          : await deps.accounts.createForVerifiedTelegramIdentity(
              update.senderId,
              update.displayName,
            );
        if (!created.ok && created.error.code === "INTERNAL_ERROR") return retry();
        const finished = await deps.repository.transition(r, now, (receipt, flow, finishedAt) => {
          const ownFlow = flow?.id === planned.flowId && flow.admittedReceiptId === receipt.id;
          if (created.ok)
            return reply(
              receipt,
              deps.registration ? "REGISTERED" : "MENU",
              ownFlow ? null : undefined,
            );
          if (created.error.code === "UNAUTHENTICATED")
            return reply(receipt, "DENIED", ownFlow ? null : undefined);
          if (ownFlow && flow.expiresAt > finishedAt) return prompt(receipt, flow, true);
          return reply(receipt, "EXPIRED", ownFlow ? null : undefined);
        });
        return finished ? delivery(finished) : retry();
      } catch {
        return retry();
      }
    },
    /** A successful Telegram send must supply its message ID; failure leaves the receipt pending. */
    async acknowledge(context: BotServiceContext, input: unknown) {
      if (!contextSchema.safeParse(context).success) return createErrorEnvelope("UNAUTHENTICATED");
      const parsed = botOnboardingAckSchema.safeParse(input);
      if (!parsed.success) return createErrorEnvelope("INVALID_INPUT");
      try {
        const ack = parsed.data;
        if ("kind" in ack) {
          if (!deps.support || !deps.ownerAdmission) return createErrorEnvelope("UNAUTHENTICATED");
          const submission = await deps.support.find(ack.submissionId, context.botId);
          const ownerId = await deps.ownerAdmission.telegramId();
          if (
            !submission ||
            !ownerId ||
            !(await deps.ownerAdmission.allowsTelegramId(submission.telegramUserId)) ||
            submission.adminChatId !== ownerId
          )
            return createErrorEnvelope("UNAUTHENTICATED");
          const settled = await deps.support.settle(
            ack.submissionId,
            context.botId,
            ack.attemptVersion,
            ack.outcome,
            ack.messageId,
            ack.receiptClaim ? { ...ack.receiptClaim, now: now() } : undefined,
          );
          return settled
            ? { ok: true as const, schemaVersion: 1 as const, status: "DONE" as const }
            : retry();
        }
        const admittedIds = deps.ownerAdmission
          ? await deps.ownerAdmission.admittedTelegramIds()
          : undefined;
        if (admittedIds && admittedIds.length === 0) return createErrorEnvelope("UNAUTHENTICATED");
        let deniedOwner = false;
        const result = await deps.repository.transition(
          { id: ack.receiptId, botId: context.botId, version: ack.version },
          now,
          (r, flow, at) => {
            if (admittedIds && !admittedIds.includes(r.telegramUserId)) {
              deniedOwner = true;
              return undefined;
            }
            if (r.phase !== "REPLY") return undefined;
            const matches =
              flow &&
              flow.id === r.flowId &&
              flow.promptVersion === r.promptVersion &&
              flow.state === "WAITING" &&
              flow.expiresAt > at;
            return {
              phase: "DONE",
              reply: r.reply as BotReply,
              ...(r.replyData ? { data: r.replyData } : {}),
              flowId: r.flowId,
              promptVersion: r.promptVersion,
              ...(matches ? { flow: { ...flow, promptMessageId: ack.messageId } } : {}),
            };
          },
        );
        if (deniedOwner) return createErrorEnvelope("UNAUTHENTICATED");
        return result?.phase === "DONE"
          ? { ok: true as const, schemaVersion: 1 as const, status: "DONE" as const }
          : retry();
      } catch {
        return retry();
      }
    },
    /** Trusted maintenance port; each call deletes at most limit rows from each owned table. */
    cleanup: botCleanupService(deps.repository, deps.clock),
  });
}
export type BotOnboarding = ReturnType<typeof botOnboardingService>;
