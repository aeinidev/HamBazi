import { RetryDelivery, type Backend } from "./backend.js";
import { mapUpdate } from "./updates.js";
import type { Sender } from "./telegram.js";
export function createDeliveryHandler(options: {
  backend: Backend;
  sender: Sender;
  botId: string;
  username: string;
}) {
  return async (input: unknown, signal: AbortSignal) => {
    signal.throwIfAborted();
    const update = mapUpdate(input, options.botId, options.username);
    if (!update) return;
    const result = await options.backend.process(update, signal);
    signal.throwIfAborted();
    if (result.status !== "REPLY") return;
    if (result.delivery.updateId !== update.updateId || result.delivery.chatId !== update.chatId)
      throw new RetryDelivery();
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
