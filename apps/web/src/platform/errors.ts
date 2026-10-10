export class ClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable = false,
  ) {
    super(code);
    this.name = "ClientError";
  }
}
export function failure(value: unknown): ClientError | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("ok" in value) ||
    value.ok !== false ||
    !("error" in value)
  )
    return;
  const error = value.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string")
    return new ClientError("INVALID_RESPONSE");
  return new ClientError(error.code, "retryable" in error && error.retryable === true);
}
export function errorMessage(error: unknown, language?: "fa") {
  const code = error instanceof ClientError ? error.code : "INTERNAL_ERROR";
  if (language === "fa") {
    const persian: Record<string, string> = {
      REGISTRATION_REQUIRED: "برای ورود به هم‌بازی، ابتدا در ربات حساب کاربری بساز.",
      UNAUTHENTICATED: "نشستت پایان یافته است. مینی‌اپ را دوباره از ربات باز کن.",
      NOT_FOUND: "این بازی یا حساب در دسترس نیست.",
      FORBIDDEN: "این کار برای حساب تو در دسترس نیست.",
      INVALID_INPUT: "اطلاعات را بررسی کن و دوباره تلاش کن.",
      RATE_LIMITED: "درخواست‌ها زیاد شده‌اند. کمی صبر کن و دوباره تلاش کن.",
      PROFILE_CONFLICT: "پروفایل تغییر کرده است. پیش از ویرایش دوباره آن را بارگذاری کن.",
      GAME_STATE_CONFLICT: "وضعیت بازی تغییر کرده است. میز را دوباره همگام کن.",
      GAME_UNAVAILABLE: "این بازی فعلاً در دسترس نیست.",
      NETWORK_ERROR: "ارتباط قطع شد. با تلاش دوباره، نتیجهٔ همان درخواست بررسی می‌شود.",
      INVALID_RESPONSE: "پاسخ سرور قابل خواندن نبود. دوباره تلاش کن.",
      INCOMPATIBLE_GAME_VERSION: "برای این بازی، نسخهٔ تازهٔ مینی‌اپ لازم است.",
    };
    return persian[code] ?? "سرویس فعلاً در دسترس نیست. کمی بعد دوباره تلاش کن.";
  }
  const messages: Record<string, string> = {
    REGISTRATION_REQUIRED: "برای ورود به هم‌بازی، ابتدا در ربات حساب کاربری بساز.",
    UNAUTHENTICATED: "Your session ended. Reopen this app from Telegram to sign in again.",
    NOT_FOUND: "This account, invitation or room is not available.",
    FORBIDDEN: "This action is not available to your account.",
    INVALID_INPUT: "Check your details and try again.",
    RATE_LIMITED: "Too many requests. Wait a moment before retrying.",
    PROFILE_CONFLICT: "Your profile changed. Reload it before making another edit.",
    CHAT_CONFLICT: "This message differs from its original request. Start a new message.",
    ROOM_CONFLICT: "The room changed. Refresh it before trying again.",
    GAME_STATE_CONFLICT: "The match changed. Synchronize before continuing.",
    GAME_UNAVAILABLE: "This game is not accepting players yet.",
    NETWORK_ERROR: "Connection interrupted. Retry to check the result of the same request.",
    INVALID_RESPONSE: "This app could not read the server response. Try reopening it.",
    INCOMPATIBLE_GAME_VERSION: "This match needs a newer version of the app.",
  };
  return messages[code] ?? "The service is unavailable. Please try again later.";
}
