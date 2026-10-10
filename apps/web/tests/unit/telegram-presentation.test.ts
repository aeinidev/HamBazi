import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapTelegram, type TelegramApp } from "../../src/platform/telegram.js";

function fixture(version = 8) {
  const callbacks = new Map<string, () => void>();
  const setProperty = vi.fn();
  vi.stubGlobal("window", {
    location: { href: "https://app.example/#/games/coup/tutorial" },
    history: { replaceState: vi.fn() },
  });
  vi.stubGlobal("document", {
    documentElement: { dataset: {}, style: { setProperty } },
  });
  const app: TelegramApp = {
    initData: "synthetic-memory-only",
    isFullscreen: false,
    isVersionAtLeast: (minimum) => version >= Number(minimum),
    ready: vi.fn(),
    expand: vi.fn(),
    requestFullscreen: vi.fn(),
    disableVerticalSwipes: vi.fn(),
    onEvent: (event, callback) => callbacks.set(event, callback),
    offEvent: (event) => callbacks.delete(event),
  };
  return { app, callbacks, setProperty };
}

afterEach(() => vi.unstubAllGlobals());

describe("Telegram launch presentation", () => {
  it("requests native fullscreen once, preserves auth/route and respects intentional exit", () => {
    const { app, callbacks } = fixture();
    const first = bootstrapTelegram(app);
    expect(app.disableVerticalSwipes).toHaveBeenCalledOnce();
    expect(app.requestFullscreen).toHaveBeenCalledOnce();
    expect(first.initData).toBe("synthetic-memory-only");
    expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/#/games/coup/tutorial");
    app.isFullscreen = true;
    callbacks.get("fullscreenChanged")!();
    app.isFullscreen = false;
    callbacks.get("fullscreenChanged")!();
    callbacks.get("viewportChanged")!();
    first.dispose();
    const second = bootstrapTelegram(app);
    expect(app.requestFullscreen).toHaveBeenCalledOnce();
    expect(app.disableVerticalSwipes).toHaveBeenCalledOnce();
    second.dispose();
    expect(callbacks.size).toBe(0);
  });

  it.each([
    [7.6, 0, 0],
    [7.7, 1, 0],
    [8, 1, 1],
  ])("version %s requests only supported capabilities", (version, swipes, fullscreen) => {
    const { app } = fixture(version);
    bootstrapTelegram(app).dispose();
    expect(app.disableVerticalSwipes).toHaveBeenCalledTimes(swipes);
    expect(app.requestFullscreen).toHaveBeenCalledTimes(fullscreen);
  });

  it("does not re-enter fullscreen when launched already fullscreen", () => {
    const { app } = fixture();
    app.isFullscreen = true;
    bootstrapTelegram(app).dispose();
    app.isFullscreen = false;
    bootstrapTelegram(app).dispose();
    expect(app.requestFullscreen).not.toHaveBeenCalled();
    expect(app.disableVerticalSwipes).toHaveBeenCalledOnce();
  });

  it("keeps missing APIs and independent native exceptions out of the auth path", () => {
    const { app } = fixture();
    app.disableVerticalSwipes = vi.fn(() => {
      throw new Error("unsupported native bridge");
    });
    app.requestFullscreen = vi.fn(() => {
      throw new Error("native fullscreen refused");
    });
    expect(bootstrapTelegram(app).initData).toBe("synthetic-memory-only");
    expect(app.requestFullscreen).toHaveBeenCalledOnce();
    bootstrapTelegram(app).dispose();
    expect(app.requestFullscreen).toHaveBeenCalledOnce();
    const missing = fixture().app;
    delete missing.isVersionAtLeast;
    delete missing.requestFullscreen;
    delete missing.disableVerticalSwipes;
    expect(bootstrapTelegram(missing).initData).toBe("synthetic-memory-only");
    expect(bootstrapTelegram(undefined).initData).toBe("");
  });

  it("updates every safe-area edge during fullscreen and removes event handlers on dispose", () => {
    const { app, callbacks, setProperty } = fixture();
    const runtime = bootstrapTelegram(app);
    app.safeAreaInset = { top: 47, bottom: 34, left: 0, right: 0 };
    app.contentSafeAreaInset = { top: 56, bottom: 0, left: 12, right: 12 };
    callbacks.get("safeAreaChanged")!();
    callbacks.get("contentSafeAreaChanged")!();
    expect(setProperty).toHaveBeenCalledWith("--telegram-top", "103px");
    expect(setProperty).toHaveBeenCalledWith("--telegram-bottom", "34px");
    expect(setProperty).toHaveBeenCalledWith("--telegram-left", "12px");
    expect(setProperty).toHaveBeenCalledWith("--telegram-right", "12px");
    runtime.dispose();
    expect(callbacks.size).toBe(0);
  });
});
