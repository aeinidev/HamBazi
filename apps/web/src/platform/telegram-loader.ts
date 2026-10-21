import { readTelegramLaunch, type TelegramApp } from "./telegram.js";
import { protectTelegramStorage } from "./telegram-storage.js";
import type { TelegramLoaderState } from "./telegram-diagnostics.js";
import { telegramSdkIntegrity, telegramSdkUrl } from "./telegram-sdk.js";

export async function loadTelegramSdk(
  report: (state: TelegramLoaderState) => void = () => {},
): Promise<TelegramApp | undefined> {
  try {
    protectTelegramStorage();
    const awaitingLaunch = (app: TelegramApp) => {
      const launch = readTelegramLaunch(app);
      return !launch.initData && launch.startParam !== undefined;
    };
    // Native/test/explicit local-preview bridges may already be present.
    if (window.Telegram?.WebApp && !awaitingLaunch(window.Telegram.WebApp)) {
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
      let probeTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (state: Exclude<TelegramLoaderState, "privacy-guard-failed">) => {
        const loaded = state === "available";
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(probeTimer);
        script.onload = null;
        script.onerror = null;
        if (!loaded) script.remove();
        report(state);
        resolve(loaded ? window.Telegram?.WebApp : undefined);
      };
      const timer = setTimeout(() => finish("sdk-timeout"), 10000);
      const probe = () => {
        if (settled) return;
        if (window.Telegram?.WebApp && !awaitingLaunch(window.Telegram.WebApp)) finish("available");
        else probeTimer = setTimeout(probe, 50);
      };
      script.onload = probe;
      script.onerror = () => finish("sdk-error");
      if (window.Telegram?.WebApp) {
        probe();
        return;
      }
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
