import "../platform/browser-validation.js";
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { z } from "zod";
import { RuntimeContext, useSession, useRuntime } from "../ui/shared.js";
import { createRuntime } from "../platform/runtime.js";
import { bootstrapTelegram } from "../platform/telegram.js";
import { KahrobaSession, KahrobaLobby, publicKahrobaSnapshot } from "../games/kahroba/index.js";
import { KahrobaSearch, KahrobaPublicLobby } from "../games/kahroba/index.js";
import "../styles.css";
const guarded =
  import.meta.env.DEV &&
  location.hostname === "127.0.0.1" &&
  location.port === "4183" &&
  document.querySelector('meta[name="hambazi-kahroba-local-preview"][content="synthetic"]');
if (!guarded) throw new Error("Isolated Kahroba preview guard failed");
const runtime = createRuntime(
  "http://127.0.0.1:4184",
  "kahroba-synthetic-only",
  fetch,
  undefined,
  "full",
  undefined,
  publicKahrobaSnapshot,
);
const telegram = bootstrapTelegram({
  initData: "",
  colorScheme: "dark",
  viewportStableHeight: window.innerHeight,
  ready() {},
  expand() {},
  onEvent() {},
  offEvent() {},
});
const metaSchema = z.object({
  schemaVersion: z.literal(1),
  names: z.record(z.uuid(), z.string().max(128)),
  cases: z.array(z.string()),
  caseName: z.string(),
});
const ack = z.object({ schemaVersion: z.literal(1), ok: z.literal(true) });
function Preview() {
  const [route, setRoute] = useState(location.hash.slice(1));
  useEffect(() => {
    const change = () => setRoute(location.hash.slice(1));
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const session = useSession((s) => s.session),
    r = useRuntime(),
    [meta, setMeta] = useState<z.infer<typeof metaSchema> | null>(null),
    [failure, setFailure] = useState(false);
  useEffect(() => {
    void r
      .login(crypto.randomUUID())
      .then(() => r.http("/__preview/meta", metaSchema, undefined, "GET"))
      .then(setMeta)
      .catch(() => setFailure(true));
  }, [r]);
  if (new URLSearchParams(location.search).get("lobby") === "1")
    return (
      <main className="kh-app" dir="rtl">
        {route.startsWith("/restricted/kahroba/search/") ? (
          <KahrobaSearch initialCapacity={Number(route.split("/")[4])} />
        ) : route.startsWith("/restricted/kahroba/public/") ? (
          <KahrobaPublicLobby id={route.split("/")[4]!} />
        ) : (
          <KahrobaLobby
            key={route}
            roomId={
              route.startsWith("/restricted/kahroba/room/")
                ? route.split("/")[4]
                : (new URLSearchParams(location.search).get("room") ?? undefined)
            }
          />
        )}
      </main>
    );
  return (
    <>
      <div
        className="kh-preview-toolbar"
        style={{
          color: "#ccdff0",
          fontFamily: "Vazirmatn",
          fontSize: 12,
          padding: 6,
          textAlign: "center",
          background: "#061125",
        }}
      >
        <details>
          <summary>پیش‌نمایش محلی · هویت و بازی آزمایشی</summary>
          {meta && (
            <select
              aria-label="حالت پیش‌نمایش"
              value={meta.caseName}
              onChange={(e) => {
                const name = e.target.value;
                void r.http("/__preview/case", ack, { case: name }).then(() => {
                  setMeta({ ...meta, caseName: name });
                  void r.realtime().sync();
                });
              }}
            >
              {meta.cases.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </details>
      </div>
      <main className="kh-app">
        {failure ? (
          <p role="alert">پیش‌نمایش در دسترس نیست.</p>
        ) : session && meta ? (
          <KahrobaSession
            id="55555555-5555-4555-8555-555555555555"
            names={meta.names}
            onBack={() => (location.hash = "/preview/kahroba")}
          />
        ) : (
          <p role="status">در حال دریافت میز…</p>
        )}
      </main>
    </>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(
  <RuntimeContext.Provider value={runtime}>
    <QueryClientProvider client={runtime.query}>
      <Preview />
    </QueryClientProvider>
  </RuntimeContext.Provider>,
);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    root.unmount();
    runtime.dispose();
    telegram.dispose();
  });
