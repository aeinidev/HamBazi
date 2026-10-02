export {
  createCorrelation,
  currentCorrelation,
  safeTraceparent,
  withCorrelation,
} from "./correlation.js";
export type { Correlation } from "./correlation.js";
export {
  createTelemetryLogger,
  reportTelemetry,
  telemetryEvents,
  telemetryFields,
} from "./logger.js";
export type { DestinationStream, Telemetry, TelemetryEvent } from "./logger.js";
