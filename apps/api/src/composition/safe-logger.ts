import { pino, type DestinationStream } from "pino";
export function createSafeLogger(destination?: DestinationStream) {
  const logger = pino({ base: null, timestamp: false }, destination);
  return Object.freeze({
    completed(requestId: string, durationMs: number, status: number) {
      const code =
        status === 401
          ? "UNAUTHENTICATED"
          : status === 403
            ? "FORBIDDEN"
            : status === 404
              ? "NOT_FOUND"
              : status === 429
                ? "RATE_LIMITED"
                : status >= 500
                  ? "INTERNAL_ERROR"
                  : status >= 400
                    ? "INVALID_INPUT"
                    : undefined;
      logger.info({
        event: "http.completed",
        requestId,
        durationMs: Math.max(0, Math.round(durationMs)),
        ...(code ? { errorCode: code } : {}),
      });
    },
    lifecycle(event: "api.started" | "api.stopped" | "api.failed") {
      logger.info({ event });
    },
  });
}
export type SafeLogger = ReturnType<typeof createSafeLogger>;
