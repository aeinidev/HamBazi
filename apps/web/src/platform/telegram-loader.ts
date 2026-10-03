import type { TelegramApp } from "./telegram.js";
import { protectTelegramStorage } from "./telegram-storage.js";
import { telegramSdkIntegrity, telegramSdkUrl } from "./telegram-sdk.js";

export async function loadTelegramSdk(): Promise<TelegramApp | undefined> {
  try {
    protectTelegramStorage();
    // Native/test/explicit local-preview bridges may already be present.
    if (window.Telegram?.WebApp) return window.Telegram.WebApp;
    return await new Promise<TelegramApp | undefined>((resolve) => {
      const script = document.createElement("script");
      script.src = telegramSdkUrl;
      script.integrity = telegramSdkIntegrity;
      script.crossOrigin = "anonymous";
      script.referrerPolicy = "no-referrer";
      let settled = false;
      const finish = (loaded: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (!loaded) script.remove();
        resolve(loaded ? window.Telegram?.WebApp : undefined);
      };
      const timer = setTimeout(() => finish(false), 10000);
      script.onload = () => finish(true);
      script.onerror = () => finish(false);
      try {
        document.head.appendChild(script);
      } catch {
        finish(false);
      }
    });
  } catch {
    // Guard/cleanup failure must never load the SDK or grant a launch credential.
    return undefined;
  }
}
