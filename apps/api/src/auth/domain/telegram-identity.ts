/** Verified Telegram identity, not an application session or membership authority. */
export interface TelegramIdentity {
  readonly telegramUserId: string;
  readonly authDate: number;
  readonly startParam?: string;
}

/** Explicit operational bounds; transport rate/size limits remain independently required. */
export interface TelegramVerificationPolicy {
  readonly maxAgeSeconds: number;
  readonly maxFutureSkewSeconds: number;
  readonly maxBytes: number;
  readonly maxFields: number;
}
