import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { telegramSdkIntegrity, telegramSdkSourceUrl } from "../../src/platform/telegram-sdk.js";

// Exercise unmodified official SDK bytes, never a synthetic substitute.
// An offline provisioned file must pass the same production SRI digest.
export async function readTelegramSdk(): Promise<string> {
  try {
    let bytes: Uint8Array;
    if (process.env.TELEGRAM_SDK_FIXTURE_PATH) {
      bytes = await readFile(process.env.TELEGRAM_SDK_FIXTURE_PATH);
    } else {
      const response = await fetch(telegramSdkSourceUrl, {
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok || !response.body) throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 524288) {
          await reader.cancel();
          throw new Error();
        }
        chunks.push(next.value);
      }
      bytes = Buffer.concat(chunks);
    }
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
