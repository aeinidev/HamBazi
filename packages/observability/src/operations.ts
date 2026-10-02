import { createTelemetryLogger, type DestinationStream, type Telemetry } from "./logger.js";
import { createMetrics, type ServiceRole } from "./metrics.js";
import { createSafeReporter, createSentryTransport } from "./reporting.js";
export function createOperationsTelemetry(
  service: ServiceRole,
  destination?: DestinationStream,
  dsn?: { reveal(): string },
) {
  const metrics = createMetrics(service);
  const reporter = dsn
    ? createSafeReporter({ service, metrics, send: createSentryTransport(dsn) })
    : undefined;
  const observer: Telemetry = {
    emit(event, fields) {
      metrics.emit(event, fields);
      reporter?.emit(event, fields);
    },
  };
  return Object.freeze({
    metrics,
    telemetry: createTelemetryLogger(destination, observer),
    close: async () => reporter?.close(),
  });
}
