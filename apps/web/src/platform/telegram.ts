export interface TelegramApp {
  initData: string;
  initDataUnsafe?: { start_param?: unknown };
  colorScheme?: string;
  viewportStableHeight?: number;
  isFullscreen?: boolean;
  isVersionAtLeast?(version: string): boolean;
  requestFullscreen?(): void;
  disableVerticalSwipes?(): void;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  close?(): void;
  openTelegramLink?(url: string): void;
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
/** Capture this launch before URL cleanup. Hints never authenticate or authorize a room. */
export function readTelegramLaunch(app: TelegramApp | undefined) {
  if (!app) return { initData: "", startParam: undefined };
  const url = new URL(window.location.href),
    fragment = new URLSearchParams(url.hash.startsWith("#/") ? "" : url.hash.slice(1));
  const single = (params: URLSearchParams, key: string) => {
    const values = params.getAll(key);
    // Ambiguous/empty current launch fields must not restore a cached SDK value.
    return values.length > 1 ? "" : values[0];
  };
  const currentData = single(fragment, "tgWebAppData") ?? single(url.searchParams, "tgWebAppData"),
    initData = currentData ?? app.initData,
    currentStart = single(new URLSearchParams(currentData), "start_param"),
    urlStart =
      single(fragment, "tgWebAppStartParam") ?? single(url.searchParams, "tgWebAppStartParam"),
    hint =
      currentStart ??
      urlStart ??
      (currentData === undefined
        ? (single(new URLSearchParams(app.initData), "start_param") ??
          app.initDataUnsafe?.start_param)
        : undefined);
  return {
    initData,
    startParam:
      typeof hint === "string" && /^[A-Za-z0-9_-]{1,512}(?![\s\S])/.test(hint) ? hint : undefined,
  };
}
const presentationRequested = new WeakSet<TelegramApp>();

function requestLaunchPresentation(app: TelegramApp | undefined) {
  if (!app || presentationRequested.has(app)) return;
  // One attempt per bridge/document, including failures and an already-fullscreen launch.
  // Native exit, activation, viewport changes and route changes never retry it.
  presentationRequested.add(app);
  try {
    if (app.isVersionAtLeast?.("7.7")) app.disableVerticalSwipes?.();
  } catch {
    // Optional native behavior must not interrupt authentication or scrolling.
  }
  try {
    if (!app.isFullscreen && app.isVersionAtLeast?.("8.0")) app.requestFullscreen?.();
  } catch {
    // Older clients and native request failures keep the expanded app usable.
  }
}
declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramApp };
  }
}
export function bootstrapTelegram(app: TelegramApp | undefined) {
  const launch = readTelegramLaunch(app);
  // SDK has consumed launch parameters; keep credentials out of browser history/referrers.
  const url = new URL(window.location.href);
  for (const key of [...url.searchParams.keys()])
    if (key.startsWith("tgWebApp")) url.searchParams.delete(key);
  if (!url.hash.startsWith("#/")) url.hash = "";
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
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
  const events = [
    "themeChanged",
    "viewportChanged",
    "safeAreaChanged",
    "contentSafeAreaChanged",
    "fullscreenChanged",
  ];
  for (const event of events) app?.onEvent(event, update);
  app?.ready();
  app?.expand();
  requestLaunchPresentation(app);
  return {
    app,
    ...launch,
    dispose: () => {
      for (const event of events) app?.offEvent(event, update);
    },
  };
}
