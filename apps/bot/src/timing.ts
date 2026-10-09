import { reportTelemetry, type Telemetry } from "@hambazi/observability";
export type BotStage =
  | "bot_ingress"
  | "bot_admit"
  | "bot_sender_admit"
  | "bot_process"
  | "bot_support_send"
  | "bot_support_ack"
  | "bot_reply_send"
  | "bot_reply_ack";
export function createBotTiming(telemetry?: Telemetry) {
  function record(
    operation: BotStage | "bot_profile" | "bot_support" | "bot_other",
    durationMs: number,
    success: boolean,
    handler = false,
  ) {
    if (telemetry)
      reportTelemetry(telemetry, handler ? "bot.handler_completed" : "bot.stage_completed", {
        operation,
        durationMs,
        ...(success ? {} : { errorCode: "INTERNAL_ERROR" }),
      });
  }
  return {
    record,
    async measure<T>(operation: BotStage, run: () => Promise<T>): Promise<T> {
      const started = performance.now();
      let success = false;
      try {
        const result = await run();
        success = true;
        return result;
      } finally {
        record(operation, performance.now() - started, success);
      }
    },
  };
}
export type BotTiming = ReturnType<typeof createBotTiming>;
/** Only an elapsed age is emitted, after admission. Never retain the update/date. */
export function messageAge(input: unknown, receivedAt: number): number | undefined {
  const own = (o: unknown, key: string) =>
    o && typeof o === "object"
      ? (Object.getOwnPropertyDescriptor(o, key)?.value as unknown)
      : undefined;
  const date = own(own(input, "message"), "date");
  if (typeof date !== "number" || !Number.isSafeInteger(date) || date < 0) return;
  const age = receivedAt - date * 1000;
  return Number.isSafeInteger(age) && age >= 0 ? age : undefined;
}
