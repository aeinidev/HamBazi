import { createTelemetryLogger } from "@hambazi/observability";
import { startWorker } from "./runtime.js";
const logger = createTelemetryLogger();
try {
  const worker = await startWorker(process.env, (event, fields) => logger.emit(event, fields));
  logger.emit("worker.started");
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), worker.drainTimeoutMs + 1000);
    deadline.unref();
    void worker.close().then(
      () => {
        clearTimeout(deadline);
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
  process.exitCode = 1;
}
