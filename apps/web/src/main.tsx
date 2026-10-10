import "./platform/browser-validation.js";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { createRuntime } from "./platform/runtime.js";
import { bootstrapTelegram } from "./platform/telegram.js";
import { loadTelegramSdk } from "./platform/telegram-loader.js";
import {
  hasTelegramLaunchData,
  type TelegramLoaderState,
} from "./platform/telegram-diagnostics.js";
import "./styles.css";
import "./ui/midnight.css";
const launchDataPresent = hasTelegramLaunchData(window.location.href);
let sdkState: TelegramLoaderState = "sdk-error";
let disposed = false;
let dispose = () => {
  disposed = true;
};
void loadTelegramSdk((state) => {
  sdkState = state;
}).then((app) => {
  const telegram = bootstrapTelegram(app);
  if (disposed) {
    telegram.dispose();
    return;
  }
  const localPreview =
    import.meta.env.DEV &&
    document.querySelector('meta[name="hambazi-local-preview"][content="synthetic"]') !== null;
  const runtime = createRuntime(
    import.meta.env.VITE_API_ORIGIN || window.location.origin,
    telegram.initData,
    fetch,
    undefined,
    import.meta.env.PROD &&
      window.location.origin === "https://staging.hambazi.top" &&
      import.meta.env.VITE_API_ORIGIN === "https://api-staging.hambazi.top"
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
  );
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <App
      runtime={runtime}
      telegram={telegram.app}
      localPreview={localPreview}
      directCoupPreviewMatchId={
        localPreview
          ? document.querySelector<HTMLMetaElement>('meta[name="hambazi-coup-preview-match"]')
              ?.content
          : undefined
      }
    />,
  );
  dispose = () => {
    disposed = true;
    root.unmount();
    runtime.dispose();
    telegram.dispose();
  };
});
if (import.meta.hot) import.meta.hot.dispose(() => dispose());
