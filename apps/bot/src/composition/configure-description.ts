import { createTelegramApi } from "../telegram-api.js";
import { parseBotRuntimeConfig, parseOwnerAdmissionConfig } from "@hambazi/config";
import { createFileOwnerAdmission } from "@hambazi/api/auth";
import { configureBotDescription } from "../description.js";
try {
  const config = parseBotRuntimeConfig(process.env);
  const ownerConfig = parseOwnerAdmissionConfig(process.env);
  if (!ownerConfig || !(await createFileOwnerAdmission(ownerConfig.file).telegramId()))
    throw new Error("Verified owner required");
  const api = createTelegramApi({
    token: config.botToken,
    timeoutMs: config.sendTimeoutMs,
    ...(config.telegramProxy ? { telegramProxy: config.telegramProxy } : {}),
  });
  const result = await configureBotDescription(api, config.botUsername, AbortSignal.timeout(15000));
  process.stdout.write(JSON.stringify(result) + "\n");
} catch {
  process.stderr.write("Bot description configuration failed\n");
  process.exitCode = 1;
}
