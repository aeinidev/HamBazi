import "./platform/browser-validation.js";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { createRuntime, type Runtime } from "./platform/runtime.js";
import { createKahrobaRealtime, publicKahrobaSnapshot } from "./games/kahroba/index.js";
import { createRealtime } from "./platform/realtime.js";
import { publicSnapshot } from "./games/index.js";
import { bootstrapTelegram, type TelegramApp } from "./platform/telegram.js";
import { loadTelegramSdk } from "./platform/telegram-loader.js";
import {
  hasTelegramLaunchData,
  type TelegramLoaderState,
} from "./platform/telegram-diagnostics.js";
import "./styles.css";
import "./ui/midnight.css";
let sdkState: TelegramLoaderState = "sdk-error";
let disposed = false;
let generation = 0;
let mounted:
  | {
      root: ReturnType<typeof createRoot>;
      runtime: Runtime;
      telegram: ReturnType<typeof bootstrapTelegram>;
      sdkInitData: string | undefined;
    }
  | undefined;
function launchFields() {
  const url = new URL(window.location.href),
    hash = new URLSearchParams(url.hash.startsWith("#/") ? "" : url.hash.slice(1)),
    credential = url.searchParams.has("tgWebAppData") || hash.has("tgWebAppData"),
    hint = url.searchParams.has("tgWebAppStartParam") || hash.has("tgWebAppStartParam");
  return { credential, hint };
}
function renderApp(
  root: ReturnType<typeof createRoot>,
  runtime: Runtime,
  telegram: ReturnType<typeof bootstrapTelegram>,
) {
  root.render(
    <App
      runtime={runtime}
      kahrobaStartParam={telegram.startParam}
      telegram={telegram.app}
      localPreview={
        import.meta.env.DEV &&
        document.querySelector('meta[name="hambazi-local-preview"][content="synthetic"]') !== null
      }
      kahrobaEnabled={
        import.meta.env.VITE_KAHROBA_RUNTIME === "true" &&
        ((import.meta.env.DEV && window.location.hostname === "127.0.0.1") ||
          (import.meta.env.PROD &&
            window.location.origin === "https://staging.hambazi.top" &&
            import.meta.env.VITE_API_ORIGIN === "https://api-staging.hambazi.top"))
      }
      directCoupPreviewMatchId={
        import.meta.env.DEV &&
        document.querySelector('meta[name="hambazi-local-preview"][content="synthetic"]') !== null
          ? document.querySelector<HTMLMetaElement>('meta[name="hambazi-coup-preview-match"]')
              ?.content
          : undefined
      }
    />,
  );
}
function mount(app: TelegramApp | undefined) {
  const launchDataPresent = hasTelegramLaunchData(window.location.href),
    fields = launchFields(),
    previous = mounted;
  const telegram = bootstrapTelegram(app);
  previous?.telegram.dispose();
  // A hint-only re-entry may use the same live session. New credentials must
  // discard the old account and pass the real verifier, even in a cached WebView.
  if (
    previous &&
    !fields.credential &&
    previous.telegram.app === app &&
    previous.sdkInitData === app?.initData
  ) {
    previous.telegram = telegram;
    renderApp(previous.root, previous.runtime, telegram);
    return;
  }
  previous?.root.unmount();
  previous?.runtime.dispose();
  previous?.telegram.app?.offEvent("activated", activated);
  const runtime = createRuntime(
    import.meta.env.VITE_API_ORIGIN || window.location.origin,
    telegram.initData,
    fetch,
    import.meta.env.DEV &&
      window.location.hostname === "127.0.0.1" &&
      import.meta.env.VITE_KAHROBA_RUNTIME === "true"
      ? createKahrobaRealtime
      : createRealtime,
    (import.meta.env.DEV &&
      window.location.hostname === "127.0.0.1" &&
      import.meta.env.VITE_KAHROBA_RUNTIME === "true") ||
      (import.meta.env.PROD &&
        window.location.origin === "https://staging.hambazi.top" &&
        import.meta.env.VITE_API_ORIGIN === "https://api-staging.hambazi.top")
      ? "owner-auth"
      : "full",
    {
      sdkPresent: !!app,
      launchDataPresent: launchDataPresent || telegram.initData.length > 0,
      initialization: app
        ? telegram.initData.length > 0
          ? "ready"
          : "missing-launch"
        : sdkState === "available"
          ? "sdk-error"
          : sdkState,
    },
    import.meta.env.DEV &&
      window.location.hostname === "127.0.0.1" &&
      import.meta.env.VITE_KAHROBA_RUNTIME === "true"
      ? publicKahrobaSnapshot
      : publicSnapshot,
  );
  const root = createRoot(document.getElementById("root")!);
  mounted = { root, runtime, telegram, sdkInitData: app?.initData };
  app?.onEvent("activated", activated);
  renderApp(root, runtime, telegram);
}
async function start() {
  const epoch = ++generation;
  const app = await loadTelegramSdk((state) => {
    sdkState = state;
  });
  if (!disposed && epoch === generation) mount(app);
}
function relaunch() {
  const fields = launchFields();
  if (
    !fields.credential &&
    fields.hint &&
    mounted?.telegram.app &&
    mounted.runtime.store.getState().session
  ) {
    generation++;
    mount(mounted.telegram.app);
  } else if (fields.credential || fields.hint) void start();
}
function activated() {
  const fields = launchFields();
  if (fields.credential || fields.hint) relaunch();
  else if (mounted?.telegram.app?.initData !== mounted?.sdkInitData) void start();
}
window.addEventListener("hashchange", relaunch);
window.addEventListener("popstate", relaunch);
void start();
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    disposed = true;
    generation++;
    window.removeEventListener("hashchange", relaunch);
    window.removeEventListener("popstate", relaunch);
    mounted?.root.unmount();
    mounted?.runtime.dispose();
    mounted?.telegram.dispose();
    mounted?.telegram.app?.offEvent("activated", activated);
    mounted = undefined;
  });
