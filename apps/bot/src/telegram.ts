import { Api, GrammyError } from "grammy";
import type { Delivery, SupportDelivery } from "./backend.js";
import { RetryDelivery } from "./backend.js";
export interface Sender {
  send(delivery: Delivery, signal: AbortSignal): Promise<number>;
  sendSupport?(delivery: SupportDelivery, signal: AbortSignal): Promise<number>;
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
    async sendSupport(delivery, signal) {
      try {
        const bounded = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]);
        const result = await api.sendMessage(
          delivery.adminChatId,
          delivery.text,
          { link_preview_options: { is_disabled: true }, protect_content: true },
          bounded as unknown as NonNullable<Parameters<Api["sendMessage"]>[3]>,
        );
        if (
          !Number.isInteger(result.message_id) ||
          result.message_id < 1 ||
          String(result.chat.id) !== delivery.adminChatId
        )
          throw new Error();
        return result.message_id;
      } catch (error) {
        throw new SupportDeliveryError(error instanceof GrammyError ? "FAILED" : "UNKNOWN");
      }
    },
    async send(delivery, signal) {
      const create = {
        keyboard: [[{ text: "ایجاد حساب کاربری", style: "primary" as const }]],
        resize_keyboard: true,
        is_persistent: true,
        one_time_keyboard: false,
      };
      const menu = {
        keyboard: [[{ text: "پروفایل من" }], [{ text: "ارتباط با پشتیبان" }]],
        resize_keyboard: true,
        is_persistent: true,
        one_time_keyboard: false,
      };
      const messages: Record<Delivery["reply"], string> = {
        CREATE_ACCOUNT: startReply,
        WELCOME_REGISTERED: startReply,
        REGISTERED: "حساب کاربری‌ات ساخته شد ✅\nبرای ورود به بازی، دکمهٔ Open را بزن.",
        PROMPT_NAME:
          "دوست داری با چه اسمی در بازی دیده بشی؟ در پاسخ به همین پیام بنویس. برای انصراف، لغو را بزن.",
        INVALID_NAME: "این نام معتبر نیست. نام دیگری بنویس یا لغو را بزن.",
        MENU: "برای ورود به بازی، دکمهٔ Open را بزن.",
        CANCELLED: "ایجاد حساب لغو شد. می‌توانی دوباره تلاش کنی.",
        EXPIRED: "مهلت این درخواست تمام شده است. دوباره دکمهٔ مربوط را بزن.",
        DENIED: "این حساب در دسترس نیست.",
        PROFILE: delivery.data?.profile
          ? `پروفایل من\nنام نمایشی: ${delivery.data.profile.displayName}\nوضعیت ثبت‌نام: ${delivery.data.profile.completed ? "کامل ✅" : "تکمیل نشده"}`
          : "پروفایل در دسترس نیست.",
        SUPPORT_PROMPT: "پیامت رو همین‌جا بنویس و ارسال کن تا پشتیبانی بررسی کنه.",
        SUPPORT_DISPATCH: "پیام پشتیبانی در انتظار بررسی وضعیت تحویل است.",
        SUPPORT_SENT: "پیامت برای پشتیبانی ارسال شد ✅",
        SUPPORT_FAILED: "ارسال پیام به پشتیبانی انجام نشد. لطفاً دوباره تلاش کن.",
        SUPPORT_UNKNOWN:
          "وضعیت تحویل پیام پشتیبانی هنوز مشخص نیست. پیام محفوظ است و برای بررسی پشتیبانی نگه داشته می‌شود.",
        SUPPORT_UNAVAILABLE: "پشتیبانی فعلاً در دسترس نیست. لطفاً بعداً دوباره تلاش کن.",
        SUPPORT_TEXT_REQUIRED: "لطفاً پیامت را به‌صورت متن ارسال کن.",
        SUPPORT_TOO_LONG: "پیام طولانی است. لطفاً متنی با حداکثر ۳۵۰۰ نویسه ارسال کن.",
        SUPPORT_CANCELLED: "درخواست پشتیبانی لغو شد.",
      };
      const composing = ["SUPPORT_PROMPT", "SUPPORT_TEXT_REQUIRED", "SUPPORT_TOO_LONG"].includes(
        delivery.reply,
      );
      const reply_markup =
        delivery.reply === "PROMPT_NAME" || delivery.reply === "INVALID_NAME"
          ? { force_reply: true as const, selective: true, input_field_placeholder: "نام نمایشی" }
          : delivery.reply === "DENIED"
            ? { remove_keyboard: true as const }
            : composing
              ? {
                  keyboard: [[{ text: "لغو" }]],
                  resize_keyboard: true,
                  is_persistent: true,
                  one_time_keyboard: false,
                }
              : ["CREATE_ACCOUNT", "CANCELLED"].includes(delivery.reply)
                ? create
                : menu;
      try {
        // The SDK types use legacy abort-controller; Node's signal implements the
        // add/removeEventListener + aborted interface consumed by grammY at runtime.
        const bounded = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]);
        const abort = bounded as unknown as NonNullable<Parameters<Api["sendMessage"]>[3]>;
        const result = await api.sendMessage(
          delivery.chatId,
          messages[delivery.reply],
          { reply_markup, link_preview_options: { is_disabled: true } },
          abort,
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

export class SupportDeliveryError extends Error {
  constructor(readonly outcome: "FAILED" | "UNKNOWN") {
    super("Support delivery incomplete");
  }
}
export const startReply = "برای ادامه، از دکمه‌های پایین استفاده کن.";
