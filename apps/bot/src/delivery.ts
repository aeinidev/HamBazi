import { RetryDelivery, type Backend } from "./backend.js";
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
}) {
  return async (input: unknown, signal: AbortSignal) => {
    signal.throwIfAborted();
    const update = mapUpdate(input, options.botId, options.username);
    if (!update) return;
    if (options.ownerAdmission && !(await options.ownerAdmission.allowsTelegramId(update.senderId)))
      return;
    const result = await options.backend.process(update, signal);
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
        messageId = await options.sender.sendSupport(d, signal);
        outcome = "DELIVERED";
      } catch (error) {
        outcome = error instanceof SupportDeliveryError ? error.outcome : "UNKNOWN";
      }
      // Record even when the request was aborted after a possible network effect.
      await options.backend.acknowledge(
        {
          schemaVersion: 1,
          kind: "SUPPORT",
          submissionId: d.submissionId,
          attemptVersion: d.attemptVersion,
          outcome,
          ...(messageId !== undefined ? { messageId } : {}),
        },
        AbortSignal.timeout(5000),
      );
      // Telegram redelivery resumes the persisted result after the receipt lease.
      throw new RetryDelivery();
    }
    if (result.status !== "REPLY") return;
    if (result.delivery.updateId !== update.updateId || result.delivery.chatId !== update.chatId)
      throw new RetryDelivery();
    if (options.ownerAdmission && !(await options.ownerAdmission.allowsTelegramId(update.senderId)))
      return;
    const messageId = await options.sender.send(result.delivery, signal);
    signal.throwIfAborted();
    await options.backend.acknowledge(
      {
        schemaVersion: 1,
        receiptId: result.delivery.receiptId,
        version: result.delivery.version,
        messageId,
      },
      signal,
    );
    signal.throwIfAborted();
  };
}
