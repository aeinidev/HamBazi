import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { createRuntime } from "./platform/runtime.js";
import { bootstrapTelegram } from "./platform/telegram.js";
import "./styles.css";
const telegram = bootstrapTelegram();
const localPreview =
  import.meta.env.DEV &&
  document.querySelector('meta[name="hambazi-local-preview"][content="synthetic"]') !== null;
const runtime = createRuntime(
  import.meta.env.VITE_API_ORIGIN || window.location.origin,
  telegram.initData,
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
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    root.unmount();
    runtime.dispose();
    telegram.dispose();
  });
