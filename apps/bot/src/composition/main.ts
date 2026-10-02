import { startBot } from "./runtime.js";
import { parseTelemetryConfig } from "@hambazi/config";
import { createBotLogger } from "./logger.js";
let logger = createBotLogger();
try {
  const config = parseTelemetryConfig(process.env, "bot");
  logger = createBotLogger(undefined, config.sentryDsn);
  const runtime = await startBot(process.env, logger);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), runtime.drainTimeoutMs + 1000);
    deadline.unref();
    void runtime.close().then(
      async () => {
        clearTimeout(deadline);
        await logger.close();
      },
      () => {
        logger.lifecycle("bot.failed");
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
} catch {
  logger.lifecycle("bot.failed");
  await logger.close();
  process.exitCode = 1;
}
