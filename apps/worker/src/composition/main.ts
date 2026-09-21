import { pino } from "pino";
import { startWorker } from "./runtime.js";
const logger = pino({ base: null, timestamp: false });
try {
  const worker = await startWorker(process.env, (event) => logger.info({ event }));
  logger.info({ event: "worker.started" });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 15000);
    deadline.unref();
    void worker.close().then(
      () => {
        clearTimeout(deadline);
        logger.info({ event: "worker.stopped" });
      },
      () => {
        logger.info({ event: "worker.failed" });
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
} catch {
  logger.info({ event: "worker.failed" });
  process.exitCode = 1;
}
