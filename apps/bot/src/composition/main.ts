import { startBot } from "./runtime.js";
import { createBotLogger } from "./logger.js";
const logger = createBotLogger();
try {
  const runtime = await startBot(process.env, logger);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 30000);
    deadline.unref();
    void runtime.close().then(
      () => clearTimeout(deadline),
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
  process.exitCode = 1;
}
