import type { Api } from "grammy";
export const botDescription =
  "به هم‌بازی خوش اومدی! 🎴\n\nدنیای بازی‌های فکری و دورهمی، داخل تلگرام.\nفعلاً نسخهٔ آزمایشی کودتا فعال است؛ بازی‌های بیشتری به‌مرور اضافه می‌شوند.\n\nبرای ورود به بازی، ابتدا دکمهٔ «ایجاد حساب کاربری» را بزن.\nپس از ساخت حساب، با دکمهٔ Open می‌توانی مینی‌اپ را باز کنی.";

/** Explicit operator action for the native pre-Start introduction. */
export async function configureBotDescription(api: Api, username: string, signal: AbortSignal) {
  const abort = signal as unknown as NonNullable<Parameters<Api["getMe"]>[0]>;
  const bot = await api.getMe(abort);
  if (bot.username?.toLowerCase() !== username.toLowerCase())
    throw new Error("Bot identity mismatch");
  for (const language_code of [undefined, "fa"] as const) {
    const options = language_code ? { language_code } : {};
    await api.getMyDescription(options, abort);
    await api.setMyDescription(botDescription, options, abort);
    const current = await api.getMyDescription(options, abort);
    if (current.description !== botDescription) throw new Error("Description verification failed");
  }
  return { defaultVerified: true, persianVerified: true };
}
