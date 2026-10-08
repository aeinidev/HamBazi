export interface TelegramApp {
  initData: string;
  colorScheme?: string;
  viewportStableHeight?: number;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  ready(): void;
  expand(): void;
  onEvent(name: string, callback: () => void): void;
  offEvent(name: string, callback: () => void): void;
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
  };
}
declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramApp };
  }
}
export function bootstrapTelegram(app: TelegramApp | undefined) {
  const queryInitData = app
    ? new URL(window.location.href).searchParams.get("tgWebAppData") || ""
    : "";
  // SDK has consumed launch parameters; keep credentials out of browser history/referrers.
  const url = new URL(window.location.href);
  for (const key of [...url.searchParams.keys()])
    if (key.startsWith("tgWebApp")) url.searchParams.delete(key);
  if (!url.hash.startsWith("#/")) url.hash = "";
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  // The SDK consumes fragments. Some launch surfaces preserve data in the query.
  // Treat it only as an untrusted, memory-only credential for server validation,
  // and never grant this fallback when loading/privacy protection failed.
  const initData = app ? app.initData || queryInitData : "";
  const update = () => {
    const root = document.documentElement;
    root.dataset.telegramTheme = app?.colorScheme === "dark" ? "dark" : "light";
    if (app?.viewportStableHeight)
      root.style.setProperty("--telegram-height", `${app.viewportStableHeight}px`);
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const inset =
        Math.max(0, app?.safeAreaInset?.[side] ?? 0) +
        Math.max(0, app?.contentSafeAreaInset?.[side] ?? 0);
      root.style.setProperty(`--telegram-${side}`, `${inset}px`);
    }
  };
  update();
  const events = ["themeChanged", "viewportChanged", "safeAreaChanged", "contentSafeAreaChanged"];
  for (const event of events) app?.onEvent(event, update);
  app?.ready();
  app?.expand();
  return {
    app,
    initData,
    dispose: () => {
      for (const event of events) app?.offEvent(event, update);
    },
  };
}
