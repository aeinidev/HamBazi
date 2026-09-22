import { pino, type DestinationStream } from "pino";
export function createSafeLogger(destination?: DestinationStream) {
  const logger = pino({ base: null, timestamp: false }, destination);
  let profileReadFailOpen = 0;
  let profileWriteFailClosed = 0;
  return Object.freeze({
    profileRateUnavailable(requestId: string, kind: "read" | "write") {
      if (kind === "read") profileReadFailOpen++;
      else profileWriteFailClosed++;
      logger.warn({
        event: kind === "read" ? "profile.rate_read_fail_open" : "profile.rate_write_fail_closed",
        requestId,
        errorCode: "INTERNAL_ERROR",
      });
    },
    profileMetrics() {
      return Object.freeze({
        profile_rate_read_fail_open_total: profileReadFailOpen,
        profile_rate_write_fail_closed_total: profileWriteFailClosed,
      });
    },
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
                  : status === 409
                    ? "PROFILE_CONFLICT"
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
