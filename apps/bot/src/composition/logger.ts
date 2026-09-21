import { pino, type DestinationStream } from "pino";
export function createBotLogger(destination?: DestinationStream) {
  const logger = pino({ base: null, timestamp: false }, destination);
  return {
    completed(requestId: string, durationMs: number, status: number) {
      logger.info({
        event: "bot.webhook_completed",
        requestId,
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
      logger.info({ event });
    },
  };
}
export type BotLogger = ReturnType<typeof createBotLogger>;
