import { RetryDelivery, type Backend } from "./backend.js";
import { createBotTiming, messageAge, type BotTiming } from "./timing.js";
import { mapUpdate } from "./updates.js";
import { SupportDeliveryError } from "./telegram.js";
import type { Sender } from "./telegram.js";
import type { OwnerAdmission } from "@hambazi/api/auth";
export function createDeliveryHandler(options: {
  backend: Backend;
  sender: Sender;
  botId: string;
  username: string;
  ownerAdmission?: OwnerAdmission;
  timing?: BotTiming;
}) {
  const timing = options.timing ?? createBotTiming();
  return async (input: unknown, signal: AbortSignal, receivedAt = Date.now()) => {
    const started = performance.now();
    let operation: "bot_profile" | "bot_support" | "bot_other" = "bot_other";
    let success = false;
    try {
      signal.throwIfAborted();
      const update = mapUpdate(input, options.botId, options.username);
      if (!update) {
        success = true;
        return;
      }
      if (
        options.ownerAdmission &&
        !(await timing.measure("bot_sender_admit", () =>
          options.ownerAdmission!.allowsTelegramId(update.senderId),
        ))
      ) {
        success = true;
        return;
      }
      operation =
        update.action === "PROFILE"
          ? "bot_profile"
          : update.action === "SUPPORT" || update.action === "TEXT"
            ? "bot_support"
            : "bot_other";
      const age = messageAge(input, receivedAt);
      if (age !== undefined) timing.record("bot_ingress", age, true);
      let result = await timing.measure("bot_process", () =>
        options.backend.process(update, signal),
      );
      signal.throwIfAborted();
      if (result.status === "SUPPORT") {
        const d = result.delivery;
        const ownerId = await options.ownerAdmission?.telegramId();
        if (
          !ownerId ||
          !(await options.ownerAdmission!.allowsTelegramId(update.senderId)) ||
          d.chatId !== update.chatId ||
          d.updateId !== update.updateId ||
          d.adminChatId !== ownerId ||
          !options.sender.sendSupport
        )
          throw new RetryDelivery();
        let outcome: "DELIVERED" | "FAILED" | "UNKNOWN";
        let messageId: number | undefined;
        try {
          messageId = await timing.measure("bot_support_send", () =>
            options.sender.sendSupport!(d, signal),
          );
          outcome = "DELIVERED";
        } catch (error) {
          outcome = error instanceof SupportDeliveryError ? error.outcome : "UNKNOWN";
        }
        // Record even when the request was aborted after a possible network effect.
        await timing.measure("bot_support_ack", () =>
          options.backend.acknowledge(
            {
              schemaVersion: 1,
              kind: "SUPPORT",
              submissionId: d.submissionId,
              attemptVersion: d.attemptVersion,
              receiptClaim: { receiptId: d.receiptId, version: d.version },
              outcome,
              ...(messageId !== undefined ? { messageId } : {}),
            },
            AbortSignal.timeout(5000),
          ),
        );
        signal.throwIfAborted();
        // Resume this same verified update after durable settlement, within the
        // original deadline. There is at most one administrator send in this call.
        result = await timing.measure("bot_process", () => options.backend.process(update, signal));
        signal.throwIfAborted();
        if (result.status === "SUPPORT") throw new RetryDelivery();
      }
      if (result.status !== "REPLY") {
        success = true;
        return;
      }
      if (result.delivery.updateId !== update.updateId || result.delivery.chatId !== update.chatId)
        throw new RetryDelivery();
      if (
        options.ownerAdmission &&
        !(await options.ownerAdmission.allowsTelegramId(update.senderId))
      ) {
        success = true;
        return;
      }
      const replyDelivery = result.delivery;
      const messageId = await timing.measure("bot_reply_send", () =>
        options.sender.send(replyDelivery, signal),
      );
      signal.throwIfAborted();
      await timing.measure("bot_reply_ack", () =>
        options.backend.acknowledge(
          {
            schemaVersion: 1,
            receiptId: replyDelivery.receiptId,
            version: replyDelivery.version,
            messageId,
          },
          signal,
        ),
      );
      signal.throwIfAborted();
      success = true;
    } finally {
      timing.record(operation, performance.now() - started, success, true);
    }
  };
}
