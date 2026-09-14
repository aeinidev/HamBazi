export type RateDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; reason: "limited"; retryAfterSeconds: number }>
  | Readonly<{ allowed: false; reason: "unavailable" }>;
export interface AuthRateLimiter {
  consumeIp(ip: string): Promise<RateDecision>;
  consumeIdentity(verifiedTelegramId: string): Promise<RateDecision>;
}
