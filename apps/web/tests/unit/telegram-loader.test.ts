import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTelegramSdk } from "../../src/platform/telegram-loader.js";
import { telegramSdkIntegrity, telegramSdkUrl } from "../../src/platform/telegram-sdk.js";
import { bootstrapTelegram, type TelegramApp } from "../../src/platform/telegram.js";

const app: TelegramApp = {
  initData: "SYNTHETIC_PRIVATE",
  ready: vi.fn(),
  expand: vi.fn(),
  onEvent: vi.fn(),
  offEvent: vi.fn(),
};

function fixture() {
  class TestStorage {
    getItem() {
      return null;
    }
    setItem() {}
    removeItem() {}
  }
  const script = {
    src: "",
    integrity: "",
    crossOrigin: "",
    referrerPolicy: "",
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
    remove: vi.fn(),
  };
  const host: {
    Storage: typeof TestStorage;
    sessionStorage: TestStorage;
    localStorage: TestStorage;
    Telegram?: { WebApp: TelegramApp };
    location: { href: string };
    history: { replaceState: ReturnType<typeof vi.fn> };
  } = {
    Storage: TestStorage,
    sessionStorage: new TestStorage(),
    localStorage: new TestStorage(),
    location: {
      href: "https://app.example/?tgWebAppData=SYNTHETIC_PRIVATE&lang=en#/match/opaque-id",
    },
    history: { replaceState: vi.fn() },
  };
  const appendChild = vi.fn();
  vi.stubGlobal("window", host);
  vi.stubGlobal("document", {
    createElement: () => script,
    head: { appendChild },
    documentElement: { dataset: {}, style: { setProperty: vi.fn() } },
  });
  return { host, script, appendChild };
}
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("guarded SDK loading", () => {
  it("loads only reviewed HTTPS bytes after the privacy guard is installed", async () => {
    const f = fixture();
    const result = loadTelegramSdk();
    expect(f.appendChild).toHaveBeenCalledOnce();
    expect(Object.getOwnPropertyDescriptor(f.host.Storage.prototype, "setItem")?.writable).toBe(
      false,
    );
    expect(f.script).toMatchObject({
      src: telegramSdkUrl,
      integrity: telegramSdkIntegrity,
      crossOrigin: "anonymous",
      referrerPolicy: "no-referrer",
    });
    f.host.Telegram = { WebApp: app };
    f.script.onload!();
    expect(await result).toBe(app);
  });

  it("guards an existing bridge before returning it", async () => {
    const f = fixture();
    f.host.Telegram = { WebApp: app };
    expect(await loadTelegramSdk()).toBe(app);
    expect(f.appendChild).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(f.host.Storage.prototype, "getItem")?.writable).toBe(
      false,
    );
  });

  it("does not trust an existing bridge when the guard cannot be installed", async () => {
    const f = fixture();
    f.host.Telegram = { WebApp: app };
    Object.freeze(f.host.Storage.prototype);
    expect(await loadTelegramSdk()).toBeUndefined();
    expect(f.appendChild).not.toHaveBeenCalled();
  });

  it("fails closed when accessible legacy cleanup fails", async () => {
    const f = fixture();
    f.host.Storage.prototype.removeItem = () => {
      throw new Error("SYNTHETIC_PRIVATE");
    };
    expect(await loadTelegramSdk()).toBeUndefined();
    expect(f.appendChild).not.toHaveBeenCalled();
  });

  it("discards SDK load errors without leaking the browser error or granting launch", async () => {
    const f = fixture();
    const report = vi.fn();
    const result = loadTelegramSdk(report);
    f.script.onerror!();
    expect(await result).toBeUndefined();
    expect(f.script.remove).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith("sdk-error");
  });

  it("bounds loading and ignores late completion", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const result = loadTelegramSdk();
    const lateLoad = f.script.onload!;
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toBeUndefined();
    f.host.Telegram = { WebApp: app };
    lateLoad();
    expect(await result).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its deadline when script insertion fails", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.appendChild.mockImplementation(() => {
      throw new Error("SYNTHETIC_PRIVATE");
    });
    expect(await loadTelegramSdk()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for delayed bridge initialization after the reviewed script loads", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const result = loadTelegramSdk();
    f.script.onload!();
    await vi.advanceTimersByTimeAsync(150);
    f.host.Telegram = { WebApp: app };
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBe(app);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for delayed initData when an invitation arrives before SDK initialization", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.host.location.href = `https://app.example/?tgWebAppStartParam=room_${"A".repeat(43)}`;
    const delayed = { ...app, initData: "" };
    f.host.Telegram = { WebApp: delayed };
    const result = loadTelegramSdk();
    let settled = false;
    void result.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(150);
    expect(settled).toBe(false);
    delayed.initData = "SYNTHETIC_PRIVATE";
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBe(delayed);
    expect(f.appendChild).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds missing invitation credentials and ignores a late initialized bridge", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.host.location.href = `https://app.example/?tgWebAppStartParam=room_${"A".repeat(43)}`;
    const delayed = { ...app, initData: "" };
    f.host.Telegram = { WebApp: delayed };
    const report = vi.fn();
    const result = loadTelegramSdk(report);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toBeUndefined();
    delayed.initData = "SYNTHETIC_PRIVATE";
    await vi.advanceTimersByTimeAsync(100);
    expect(report).toHaveBeenCalledExactlyOnceWith("sdk-timeout");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("bootstrap credential cleanup", () => {
  it.each(["query", "fragment"])(
    "preserves the separate %s invitation launch hint before privacy cleanup",
    (surface) => {
      const f = fixture(),
        startParam = `room_${"A".repeat(43)}`,
        fields = new URLSearchParams({
          tgWebAppData: "SYNTHETIC_SIGNED_CREDENTIAL_WITHOUT_START_PARAM",
          tgWebAppStartParam: startParam,
        });
      f.host.location.href =
        surface === "query"
          ? `https://app.example/?lang=fa&${fields}#/restricted/kahroba`
          : `https://app.example/?lang=fa#${fields}`;
      const result = bootstrapTelegram({ ...app, initData: "" });
      expect(result.startParam).toBe(startParam);
      expect(result.initData).toBe("SYNTHETIC_SIGNED_CREDENTIAL_WITHOUT_START_PARAM");
      expect(f.host.history.replaceState).toHaveBeenCalledWith(
        null,
        "",
        surface === "query" ? "/?lang=fa#/restricted/kahroba" : "/?lang=fa",
      );
      result.dispose();
    },
  );

  it("prefers current launch credentials over a cached SDK and preserves signed bytes exactly", () => {
    const f = fixture(),
      startParam = `room_${"E".repeat(43)}`,
      initData = `query_id=SYNTHETIC%2BQUERY&start_param=${startParam}&hash=SYNTHETIC`;
    f.host.location.href = `https://app.example/?${new URLSearchParams({ tgWebAppData: initData, tgWebAppStartParam: `room_${"A".repeat(43)}` })}`;
    const result = bootstrapTelegram({
      ...app,
      initData: `start_param=room_${"I".repeat(43)}`,
    });
    expect(result.initData).toBe(initData);
    expect(result.startParam).toBe(startParam);
    result.dispose();
  });

  it("uses a current URL hint ahead of a cached SDK hint without editing authentication data", () => {
    const f = fixture(),
      startParam = `room_${"E".repeat(43)}`,
      initData = `start_param=room_${"A".repeat(43)}&hash=SYNTHETIC`;
    f.host.location.href = `https://app.example/?tgWebAppStartParam=${startParam}`;
    const result = bootstrapTelegram({ ...app, initData });
    expect(result.initData).toBe(initData);
    expect(result.startParam).toBe(startParam);
    result.dispose();
  });

  it("treats SDK unsafe start_param only as a routing hint and never as credentials", () => {
    const f = fixture(),
      startParam = `room_${"A".repeat(43)}`;
    f.host.location.href = "https://app.example/";
    const result = bootstrapTelegram({
      ...app,
      initData: "",
      initDataUnsafe: { start_param: startParam },
    });
    expect(result.startParam).toBe(startParam);
    expect(result.initData).toBe("");
    result.dispose();
  });

  it("rejects ambiguous current hints instead of using a cached room", () => {
    const f = fixture();
    f.host.location.href = `https://app.example/?tgWebAppStartParam=room_${"A".repeat(43)}&tgWebAppStartParam=room_${"E".repeat(43)}`;
    const result = bootstrapTelegram({ ...app, initData: `start_param=room_${"I".repeat(43)}` });
    expect(result.startParam).toBeUndefined();
    result.dispose();
  });

  it.each(["room_bad%0A", "room_bad\n", "x".repeat(513), ""])(
    "rejects malformed launch hints instead of restoring a cached invitation (%s)",
    (hint) => {
      const f = fixture();
      f.host.location.href = `https://app.example/?${new URLSearchParams({ tgWebAppStartParam: hint })}`;
      const result = bootstrapTelegram({ ...app, initData: `start_param=room_${"A".repeat(43)}` });
      expect(result.startParam).toBeUndefined();
      result.dispose();
    },
  );

  it("discards launch hints as well as credentials when the privacy boundary failed", () => {
    const f = fixture();
    f.host.location.href = `https://app.example/?tgWebAppStartParam=room_${"A".repeat(43)}&tgWebAppData=SYNTHETIC_PRIVATE`;
    const result = bootstrapTelegram(undefined);
    expect(result.initData).toBe("");
    expect(result.startParam).toBeUndefined();
  });

  it("preserves query-only launch data in memory after a guarded SDK load", () => {
    const f = fixture();
    const queryApp = { ...app, initData: "" };
    const result = bootstrapTelegram(queryApp);
    expect(result.initData).toBe("SYNTHETIC_PRIVATE");
    expect(f.host.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/?lang=en#/match/opaque-id",
    );
    expect(queryApp.initData).toBe("");
  });
  it("cleans launch query/hash on failure without falling back to a rejected global bridge", () => {
    const f = fixture();
    f.host.Telegram = { WebApp: app };
    f.host.location.href =
      "https://app.example/?tgWebAppData=SYNTHETIC_PRIVATE#tgWebAppData=SYNTHETIC_PRIVATE";
    const result = bootstrapTelegram(undefined);
    expect(result.initData).toBe("");
    expect(result.app).toBeUndefined();
    expect(f.host.history.replaceState).toHaveBeenCalledWith(null, "", "/");
    expect(app.ready).not.toHaveBeenCalled();
  });

  it("preserves safe direct routes and memory-only initData while cleaning launch fields", () => {
    const f = fixture();
    const result = bootstrapTelegram(app);
    expect(result.initData).toBe("SYNTHETIC_PRIVATE");
    expect(f.host.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/?lang=en#/match/opaque-id",
    );
    expect(app.ready).toHaveBeenCalledOnce();
    expect(app.expand).toHaveBeenCalledOnce();
    result.dispose();
    expect(app.offEvent).toHaveBeenCalledTimes(5);
  });
});
