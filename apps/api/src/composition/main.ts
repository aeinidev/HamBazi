import { createSafeLogger } from "./safe-logger.js";
import { startApi } from "./runtime.js";
const logger = createSafeLogger();
try {
  const api = await startApi(process.env, logger);
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), api.drainTimeoutMs + 1000);
    deadline.unref();
    void api.close().then(
      () => clearTimeout(deadline),
      () => {
        logger.lifecycle("api.failed");
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
} catch {
  logger.lifecycle("api.failed");
  process.exitCode = 1;
}
