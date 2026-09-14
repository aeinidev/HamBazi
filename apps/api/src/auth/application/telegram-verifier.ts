import type { ErrorEnvelope } from "@hambazi/contracts";
import type { TelegramIdentity } from "../domain/telegram-identity.js";

export type TelegramVerificationResult =
  { readonly ok: true; readonly identity: TelegramIdentity } | ErrorEnvelope<"UNAUTHENTICATED">;

export interface TelegramVerifier {
  /** Synchronous, with caller-injected server time in milliseconds. Does not issue a session. */
  verify(initData: unknown, nowMs: number): TelegramVerificationResult;
}
