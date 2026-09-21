export const RECEIPT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const FLOW_LIFETIME_MS = 15 * 60 * 1000;
export type BotReply =
  "CREATE_ACCOUNT" | "PROMPT_NAME" | "INVALID_NAME" | "MENU" | "CANCELLED" | "EXPIRED" | "DENIED";
export interface Receipt {
  id: string;
  botId: string;
  updateId: number;
  telegramUserId: string;
  messageId: number;
  replyToMessageId: number | null;
  schemaVersion: number;
  action: string;
  phase: string;
  version: number;
  receivedAt: number;
  expiresAt: number;
  leaseUntil: number;
  reply: string | null;
  flowId: string | null;
  promptVersion: number | null;
}
export interface OnboardingFlow {
  id: string;
  botId: string;
  telegramUserId: string;
  schemaVersion: number;
  version: number;
  state: string;
  createdAt: number;
  expiresAt: number;
  promptVersion: number;
  promptMessageId: number | null;
  admittedReceiptId: string | null;
}
export interface ReceiptClaim {
  id: string;
  botId: string;
  version: number;
}
export type Transition = {
  /** undefined leaves the flow unchanged; null removes the observed flow. */
  flow?: OnboardingFlow | null;
  phase: string;
  reply: BotReply | null;
  flowId: string | null;
  promptVersion: number | null;
};
export interface BotOnboardingRepository {
  claim(
    candidate: Receipt,
  ): Promise<
    { status: "CLAIMED"; receipt: Receipt } | { status: "RETRY" | "DONE" | "EXPIRED" | "INVALID" }
  >;
  /** Synchronous pure decision; called again on bounded optimistic conflicts. No external I/O. */
  transition(
    claim: ReceiptClaim,
    now: () => number,
    decide: (
      receipt: Receipt,
      flow: OnboardingFlow | undefined,
      at: number,
    ) => Transition | undefined,
  ): Promise<Receipt | undefined>;
  cleanup(now: number, limit: number): Promise<{ receipts: number; flows: number }>;
}
