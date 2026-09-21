import { vi } from "vitest";
import type { Backend, Delivery } from "../../src/backend.js";
export const delivery: Delivery = {
  receiptId: "911be1c6-febe-40f6-b24e-a57a956dc781",
  version: 1,
  updateId: 1,
  chatId: "100",
  reply: "PROMPT_NAME",
};
export function raw(text = "/start", updateId = 1) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId + 1,
      from: { id: 100, is_bot: false },
      chat: { id: 100, type: "private" },
      text,
    },
  };
}
export function name(text = "  Mehdi  ") {
  return {
    ...raw(text),
    message: {
      ...raw(text).message,
      reply_to_message: {
        message_id: 900,
        from: { id: 123, is_bot: true },
        chat: { id: 100, type: "private" },
      },
    },
  };
}
export function fixture() {
  const backend = {
    admit: vi.fn<Backend["admit"]>(async () => {}),
    process: vi.fn<Backend["process"]>(async () => ({
      schemaVersion: 1,
      ok: true,
      status: "REPLY",
      delivery,
    })),
    acknowledge: vi.fn<Backend["acknowledge"]>(async () => {}),
  };
  const sender = { send: vi.fn(async () => 900) };
  return { backend, sender, botId: "123", username: "hambazi_test_bot" };
}
