import type { TelegramApp } from "./telegram.js";
import { protectTelegramStorage } from "./telegram-storage.js";
import type { TelegramLoaderState } from "./telegram-diagnostics.js";
import { telegramSdkIntegrity, telegramSdkUrl } from "./telegram-sdk.js";

export async function loadTelegramSdk(
  report: (state: TelegramLoaderState) => void = () => {},
): Promise<TelegramApp | undefined> {
  try {
    protectTelegramStorage();
    // Native/test/explicit local-preview bridges may already be present.
    if (window.Telegram?.WebApp) {
      report("available");
      return window.Telegram.WebApp;
    }
    return await new Promise<TelegramApp | undefined>((resolve) => {
      const script = document.createElement("script");
      script.src = telegramSdkUrl;
      script.integrity = telegramSdkIntegrity;
      script.crossOrigin = "anonymous";
      script.referrerPolicy = "no-referrer";
      let settled = false;
      const finish = (state: Exclude<TelegramLoaderState, "privacy-guard-failed">) => {
        const loaded = state === "available";
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (!loaded) script.remove();
        report(state);
        resolve(loaded ? window.Telegram?.WebApp : undefined);
      };
      const timer = setTimeout(() => finish("sdk-timeout"), 10000);
      script.onload = () => finish("available");
      script.onerror = () => finish("sdk-error");
      try {
        document.head.appendChild(script);
      } catch {
        finish("sdk-error");
      }
    });
  } catch {
    // Guard/cleanup failure must never load the SDK or grant a launch credential.
    report("privacy-guard-failed");
    return undefined;
  }
}
