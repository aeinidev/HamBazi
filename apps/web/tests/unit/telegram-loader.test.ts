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
});

describe("bootstrap credential cleanup", () => {
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
    expect(app.offEvent).toHaveBeenCalledTimes(4);
  });
});
