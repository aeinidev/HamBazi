import { createHash } from "node:crypto";
import { telegramSdkIntegrity } from "../src/platform/telegram-sdk.js";

export function verifyTelegramSdkAsset(bytes: Uint8Array): void {
  if (
    bytes.length === 0 ||
    bytes.length > 524288 ||
    `sha384-${createHash("sha384").update(bytes).digest("base64")}` !== telegramSdkIntegrity
  )
    throw new Error("INVALID_REVIEWED_TELEGRAM_SDK_ASSET");
}
