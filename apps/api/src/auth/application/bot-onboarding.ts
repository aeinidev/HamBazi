import { z } from "zod";
import { createErrorEnvelope } from "@hambazi/contracts";
import type { AccountCreationPort, UserIdentityPort } from "../../users/index.js";
import type { BotServiceContext } from "./bot-service.js";
import type { SessionClock } from "./session-ports.js";
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
/** Internal operation DTOs, not raw Telegram update schemas or public HTTP routes. */
export const botOnboardingUpdateSchema = z.discriminatedUnion("action", [
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
export const botOnboardingAckSchema = z.strictObject({
  schemaVersion: z.literal(1),
  receiptId: z.uuid(),
  version: z.number().int().positive().max(2147483647),
  messageId,
});
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
    /** Call only after service authentication and Bot verification of an original private update. */
    async process(context: BotServiceContext, input: unknown) {
      if (!contextSchema.safeParse(context).success) return createErrorEnvelope("UNAUTHENTICATED");
      const parsed = botOnboardingUpdateSchema.safeParse(input);
      if (!parsed.success || parsed.data.chatId !== parsed.data.senderId)
        return createErrorEnvelope("INVALID_INPUT");
      const update = parsed.data;
      try {
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
        const active = await deps.users.findActiveByTelegramId(update.senderId);
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
          if (update.action === "START" || update.action === "CREATE") {
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
          if (!flow || flow.promptMessageId !== update.replyToMessageId)
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
        const created = await deps.accounts.createForVerifiedTelegramIdentity(
          update.senderId,
          update.displayName,
        );
        if (!created.ok && created.error.code === "INTERNAL_ERROR") return retry();
        const finished = await deps.repository.transition(r, now, (receipt, flow, finishedAt) => {
          const ownFlow = flow?.id === planned.flowId && flow.admittedReceiptId === receipt.id;
          if (created.ok) return reply(receipt, "MENU", ownFlow ? null : undefined);
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
        const result = await deps.repository.transition(
          { id: ack.receiptId, botId: context.botId, version: ack.version },
          now,
          (r, flow, at) => {
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
              flowId: r.flowId,
              promptVersion: r.promptVersion,
              ...(matches ? { flow: { ...flow, promptMessageId: ack.messageId } } : {}),
            };
          },
        );
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
