import { parseTelemetryConfig } from "@hambazi/config";
import { createOperationsTelemetry } from "@hambazi/observability";
import { startWorker } from "./runtime.js";
let observation = createOperationsTelemetry("worker");
let logger = observation.telemetry;
try {
  const config = parseTelemetryConfig(process.env, "worker");
  observation = createOperationsTelemetry("worker", undefined, config.sentryDsn);
  logger = observation.telemetry;
  const worker = await startWorker(
    process.env,
    (event, fields) => logger.emit(event, fields),
    undefined,
    observation.metrics,
    logger,
  );
  logger.emit("worker.started");
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), worker.drainTimeoutMs + 1000);
    deadline.unref();
    void worker.close().then(
      async () => {
        clearTimeout(deadline);
        await observation.close();
        logger.emit("worker.stopped");
      },
      () => {
        logger.emit("worker.failed");
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
} catch {
  logger.emit("worker.failed");
  await observation.close();
  process.exitCode = 1;
}
