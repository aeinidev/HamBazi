import { pino, type DestinationStream } from "pino";
import { ERROR_CODES } from "@hambazi/shared";
import { currentCorrelation, ownValue, safeId, safeTraceparent } from "./correlation.js";
import { metricOperations } from "./vocabulary.js";

export const telemetryEvents = Object.freeze([
  "api.started",
  "api.stopped",
  "api.failed",
  "bot.started",
  "bot.stopped",
  "bot.failed",
  "bot.webhook_completed",
  "http.completed",
  "database.completed",
  "socket.completed",
  "realtime.delivery_completed",
  "realtime.delivery_failed",
  "catalog.rate_read_fail_open",
  "profile.rate_read_fail_open",
  "profile.rate_write_fail_closed",
  "worker.started",
  "worker.stopped",
  "worker.failed",
  "worker.job_completed",
  "worker.job_failed",
  "worker.queue_unavailable",
  "worker.outbox_published",
  "worker.outbox_retry",
  "worker.outbox_failed",
  "worker.outbox_unavailable",
  "worker.domain_completed",
  "worker.domain_failed",
  "worker.statistics_maintenance_completed",
  "worker.statistics_maintenance_failed",
] as const);
export type TelemetryEvent = (typeof telemetryEvents)[number];
export interface Telemetry {
  emit(event: TelemetryEvent, fields?: unknown): void;
}
export function reportTelemetry(
  telemetry: Telemetry,
  event: TelemetryEvent,
  fields?: unknown,
): void {
  try {
    telemetry.emit(event, fields);
  } catch {
    // Also protect the application when a custom observer/transport fails.
  }
}
const warnings = new Set<TelemetryEvent>([
  "api.failed",
  "bot.failed",
  "worker.failed",
  "realtime.delivery_failed",
  "catalog.rate_read_fail_open",
  "profile.rate_read_fail_open",
  "profile.rate_write_fail_closed",
  "worker.job_failed",
  "worker.queue_unavailable",
  "worker.outbox_retry",
  "worker.outbox_failed",
  "worker.outbox_unavailable",
  "worker.domain_failed",
  "worker.statistics_maintenance_failed",
]);

/** This projection is the ONLY object given to Pino. No raw object, error, message or binding API. */
export function telemetryFields(input: unknown): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const key of ["requestId", "userId", "roomId", "matchId", "actionId"]) {
    const value = safeId(ownValue(input, key));
    if (value) result[key] = value;
  }
  const stateVersion = ownValue(input, "stateVersion");
  if (
    typeof stateVersion === "number" &&
    Number.isInteger(stateVersion) &&
    stateVersion >= 0 &&
    stateVersion <= 2147483647
  )
    result.stateVersion = stateVersion;
  const durationMs = ownValue(input, "durationMs");
  if (
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs >= 0 &&
    durationMs <= Number.MAX_SAFE_INTEGER
  )
    result.durationMs = Math.round(durationMs);
  const code = ownValue(input, "errorCode");
  if (typeof code === "string" && ERROR_CODES.some((known) => known === code))
    result.errorCode = code;
  const operation = ownValue(input, "operation");
  if (metricOperations.some((known) => known === operation)) result.operation = operation as string;
  const traceparent = safeTraceparent(ownValue(input, "traceparent"));
  if (traceparent) {
    result.traceId = traceparent.slice(3, 35);
    result.spanId = traceparent.slice(36, 52);
  }
  return result;
}
export function createTelemetryLogger(
  destination?: DestinationStream,
  observer?: Telemetry,
): Telemetry {
  const logger = pino({ base: null, timestamp: false }, destination);
  return Object.freeze({
    emit(event: TelemetryEvent, fields?: unknown) {
      // Runtime callers cannot inject an event/message through a cast or an external adapter.
      if (!telemetryEvents.some((known) => known === event)) return;
      try {
        const record = {
          ...telemetryFields(currentCorrelation()),
          ...telemetryFields(fields),
          event,
        };
        reportTelemetry(observer ?? { emit() {} }, event, record);
        if (warnings.has(event)) logger.warn(record);
        else logger.info(record);
      } catch {
        // Telemetry failure never changes an accepted command, publication, or receipt.
      }
    },
  });
}
export type { DestinationStream } from "pino";
