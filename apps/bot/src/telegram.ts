import { Api, GrammyError } from "grammy";
import type { Delivery } from "./backend.js";
import { RetryDelivery } from "./backend.js";
export interface Sender {
  send(delivery: Delivery, signal: AbortSignal): Promise<number>;
}
export function createTelegramSender(
  options: { token: { reveal(): string }; miniAppUrl: string; timeoutMs: number },
  api = new Api(options.token.reveal(), {
    timeoutSeconds: options.timeoutMs / 1000,
    canUseWebhookReply: () => false,
    sensitiveLogs: false,
    baseFetchConfig: { redirect: "error", size: 65536 },
  }),
): Sender {
  return {
    async send(delivery, signal) {
      const create = {
        keyboard: [[{ text: "Create Account" }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      };
      const messages = {
        CREATE_ACCOUNT: "Welcome to HamBazi. Choose Create Account to begin.",
        PROMPT_NAME: "Reply to this message with your display name. Use /cancel to cancel.",
        INVALID_NAME:
          "That name is not valid. Reply with a different display name, or use /cancel.",
        MENU: "Your account is ready. Open HamBazi to continue.",
        CANCELLED: "Account creation cancelled. You can start again.",
        EXPIRED: "This request has expired. Choose Create Account to start again.",
        DENIED: "This account is unavailable.",
      } as const;
      const reply_markup =
        delivery.reply === "PROMPT_NAME" || delivery.reply === "INVALID_NAME"
          ? { force_reply: true as const, selective: true, input_field_placeholder: "Display name" }
          : delivery.reply === "MENU"
            ? {
                inline_keyboard: [[{ text: "Open HamBazi", web_app: { url: options.miniAppUrl } }]],
              }
            : delivery.reply === "DENIED"
              ? { remove_keyboard: true as const }
              : create;
      try {
        // The SDK types use legacy abort-controller; Node's signal implements the
        // add/removeEventListener + aborted interface consumed by grammY at runtime.
        const bounded = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]);
        const result = await api.sendMessage(
          delivery.chatId,
          messages[delivery.reply],
          { reply_markup, link_preview_options: { is_disabled: true } },
          bounded as unknown as NonNullable<Parameters<Api["sendMessage"]>[3]>,
        );
        if (
          !Number.isInteger(result.message_id) ||
          result.message_id < 1 ||
          result.message_id > 2147483647 ||
          String(result.chat.id) !== delivery.chatId
        )
          throw new Error();
        return result.message_id;
      } catch (error) {
        const retry = error instanceof GrammyError ? error.parameters.retry_after : undefined;
        throw new RetryDelivery(
          typeof retry === "number" && Number.isInteger(retry)
            ? Math.min(Math.max(retry, 1), 60)
            : 1,
        );
      }
    },
  };
}
