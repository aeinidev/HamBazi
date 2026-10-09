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
export function errorMessage(error: unknown) {
  const code = error instanceof ClientError ? error.code : "INTERNAL_ERROR";
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
