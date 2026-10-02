import { createOperationsTelemetry, type DestinationStream } from "@hambazi/observability";
export function createBotLogger(destination?: DestinationStream, dsn?: { reveal(): string }) {
  const observation = createOperationsTelemetry("bot", destination, dsn);
  const { telemetry, metrics } = observation;
  return {
    metrics,
    close: observation.close,
    completed(requestId: string, durationMs: number, status: number) {
      telemetry.emit("bot.webhook_completed", {
        requestId,
        operation: "webhook",
        durationMs: Math.max(0, Math.round(durationMs)),
        ...(status >= 400
          ? {
              errorCode:
                status === 401
                  ? "UNAUTHENTICATED"
                  : status === 403
                    ? "FORBIDDEN"
                    : status === 429
                      ? "RATE_LIMITED"
                      : status >= 500
                        ? "INTERNAL_ERROR"
                        : "INVALID_INPUT",
            }
          : {}),
      });
    },
    lifecycle(event: "bot.started" | "bot.stopped" | "bot.failed") {
      telemetry.emit(event);
    },
  };
}
export type BotLogger = ReturnType<typeof createBotLogger>;
