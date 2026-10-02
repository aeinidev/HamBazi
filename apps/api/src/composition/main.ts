import { parseTelemetryConfig } from "@hambazi/config";
import { createSafeLogger } from "./safe-logger.js";
import { startApi } from "./runtime.js";
let logger = createSafeLogger();
try {
  const config = parseTelemetryConfig(process.env, "api");
  logger = createSafeLogger(undefined, config.sentryDsn);
  const api = await startApi(process.env, logger);
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), api.drainTimeoutMs + 1000);
    deadline.unref();
    void api.close().then(
      async () => {
        clearTimeout(deadline);
        await logger.close();
      },
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
  await logger.close();
  process.exitCode = 1;
}
