import { Api } from "grammy";
import { parseBotRuntimeConfig, parseOwnerAdmissionConfig } from "@hambazi/config";
import { createFileOwnerAdmission } from "@hambazi/api/auth";
import { configureMiniAppMenu } from "../menu.js";
try {
  const config = parseBotRuntimeConfig(process.env);
  const ownerConfig = parseOwnerAdmissionConfig(process.env);
  if (!ownerConfig) throw new Error("Verified owner required");
  const ownerChatId = await createFileOwnerAdmission(ownerConfig.file).telegramId();
  if (!ownerChatId) throw new Error("Verified owner required");
  const api = new Api(config.botToken.reveal(), {
    sensitiveLogs: false,
    canUseWebhookReply: () => false,
    baseFetchConfig: { redirect: "error" },
  });
  const result = await configureMiniAppMenu(
    api,
    { username: config.botUsername, miniAppUrl: config.miniAppUrl, ownerChatId },
    AbortSignal.timeout(15000),
  );
  process.stdout.write(JSON.stringify(result) + "\n");
} catch {
  process.stderr.write("Bot menu configuration failed\n");
  process.exitCode = 1;
}
