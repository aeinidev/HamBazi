import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { telegramSdkIntegrity, telegramSdkUrl } from "../../src/platform/telegram-sdk.js";

// Exercise unmodified official SDK bytes, never a synthetic substitute.
// An offline provisioned file must pass the same production SRI digest.
export async function readTelegramSdk(): Promise<string> {
  try {
    const bytes = await readFile(
      process.env.TELEGRAM_SDK_FIXTURE_PATH ??
        new URL("../../public" + telegramSdkUrl, import.meta.url),
    );
    if (
      bytes.length > 524288 ||
      `sha384-${createHash("sha384").update(bytes).digest("base64")}` !== telegramSdkIntegrity
    )
      throw new Error();
    return new TextDecoder().decode(bytes);
  } catch {
    throw new Error(
      "Pinned official Telegram SDK fixture unavailable or changed; provision TELEGRAM_SDK_FIXTURE_PATH with the reviewed bytes",
    );
  }
}
