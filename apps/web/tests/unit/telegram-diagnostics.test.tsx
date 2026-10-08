import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../../src/app.js";
import { createRuntime } from "../../src/platform/runtime.js";
import {
  diagnosticErrorCode,
  hasTelegramLaunchData,
} from "../../src/platform/telegram-diagnostics.js";
import { verifyTelegramSdkAsset } from "../../security/telegram-sdk-asset.js";
const canary = "SYNTHETIC_PRIVATE_LAUNCH";
const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());
describe("temporary private-safe Telegram diagnostics", () => {
  it("detects fragment, query and path-fragment launches without returning their values", () => {
    for (const suffix of [
      `#tgWebAppData=${canary}`,
      `?tgWebAppData=${canary}`,
      `#/games?tgWebAppData=${canary}`,
    ])
      expect(hasTelegramLaunchData(`https://staging.hambazi.top/${suffix}`)).toBe(true);
    expect(hasTelegramLaunchData("https://staging.hambazi.top/#/games")).toBe(false);
    expect(hasTelegramLaunchData("invalid")).toBe(false);
  });
  it("never returns arbitrary server/browser messages as diagnostic codes", () => {
    expect(diagnosticErrorCode(canary)).toBe("INTERNAL_ERROR");
    expect(diagnosticErrorCode(new Error(canary))).toBe("INTERNAL_ERROR");
    expect(diagnosticErrorCode("FORBIDDEN")).toBe("FORBIDDEN");
  });
  it("keeps safe auth-denial state private after temporary diagnostic UI removal", async () => {
    vi.stubGlobal("window", { location: { hash: "" } });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: { code: canary } }), { status: 403 }),
      );
    const runtime = createRuntime(
      "https://api-staging.hambazi.top",
      canary,
      fetcher,
      vi.fn(),
      "owner-auth",
      { sdkPresent: true, launchDataPresent: true, initialization: "ready" },
    );
    const pending = runtime.login(id);
    expect(runtime.store.getState().telegramDiagnostics?.authentication).toBe("pending");
    await expect(pending).rejects.toThrow(canary);
    expect(runtime.store.getState().telegramDiagnostics).toMatchObject({
      authentication: "failed",
      errorCode: "INTERNAL_ERROR",
    });
    expect(runtime.store.getState().session).toBeNull();
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).initData === canary).toBe(true);
    vi.spyOn(runtime.store, "getInitialState").mockImplementation(runtime.store.getState);
    const ui = renderToStaticMarkup(<App runtime={runtime} />);
    expect(ui).not.toContain("Telegram startup check");
    expect(ui).not.toContain("Authentication: failed");
    expect(ui).not.toContain(canary);
    expect(JSON.stringify(runtime.store.getState())).not.toContain(canary);
    runtime.dispose();
  });
  it("verifies unmodified reviewed SDK bytes and rejects a changed local asset", async () => {
    const bytes = await readFile(
      new URL("../../public/telegram-sdk/telegram-web-app-3f223aba4f0ede97.js", import.meta.url),
    );
    expect(() => verifyTelegramSdkAsset(bytes)).not.toThrow();
    const changed = Buffer.from(bytes);
    changed[0] = changed[0]! ^ 1;
    expect(() => verifyTelegramSdkAsset(changed)).toThrow("INVALID_REVIEWED_TELEGRAM_SDK_ASSET");
    expect(() => verifyTelegramSdkAsset(new Uint8Array())).toThrow();
  });
});
