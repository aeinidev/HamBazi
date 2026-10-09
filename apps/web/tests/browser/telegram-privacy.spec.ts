import { test, expect, type Page } from "@playwright/test";
import { readTelegramSdk } from "./telegram-sdk.js";
import { telegramSdkIntegrity, telegramSdkUrl } from "../../src/platform/telegram-sdk.js";

const canary = "SYNTHETIC_17A3_PRIVACY_CANARY";
const initData = new URLSearchParams({
  query_id: canary,
  user: JSON.stringify({ id: 123456, first_name: "Test" }),
  auth_date: "1",
  hash: "synthetic",
  start_param: `room_${"A".repeat(43)}`,
}).toString();
const launchHash = new URLSearchParams({
  tgWebAppData: initData,
  tgWebAppVersion: "9.0",
  tgWebAppPlatform: "web",
  tgWebAppThemeParams: JSON.stringify({ bg_color: "#ffffff", text_color: "#000000" }),
}).toString();
const fixture = "http://127.0.0.1:4174";
let sdk: string;
test.beforeAll(async () => {
  sdk = await readTelegramSdk();
});
test.beforeEach(async ({ request }) => {
  await request.post(`${fixture}/__test/reset`);
});

declare global {
  interface Window {
    __telegramPrivacyProbe: () => {
      credentialWritten: boolean;
      physicalCachePresent: boolean;
      unrelatedPreserved: boolean;
    };
  }
}

async function prepare(page: Page, legacy = false) {
  await page.route(telegramSdkUrl, (route) =>
    route.fulfill({
      body: sdk,
      contentType: "application/javascript",
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
  await page.addInitScript(
    ({ canary, legacy }) => {
      const originalGet = Storage.prototype.getItem;
      const originalSet = Storage.prototype.setItem;
      if (legacy) {
        for (const area of [sessionStorage, localStorage]) {
          originalSet.call(
            area,
            "__telegram__initParams",
            JSON.stringify({ tgWebAppData: canary }),
          );
          originalSet.call(area, "nonsecret-preference", "keep");
        }
      }
      let credentialWritten = false;
      Storage.prototype.setItem = function (key, value) {
        if (String(value).includes(canary) || String(value).includes("synthetic-access"))
          credentialWritten = true;
        return originalSet.call(this, key, value);
      };
      window.__telegramPrivacyProbe = () => ({
        credentialWritten,
        physicalCachePresent: [sessionStorage, localStorage].some(
          (area) => originalGet.call(area, "__telegram__initParams") !== null,
        ),
        unrelatedPreserved:
          !legacy ||
          [sessionStorage, localStorage].every(
            (area) => originalGet.call(area, "nonsecret-preference") === "keep",
          ),
      });
    },
    { canary, legacy },
  );
}

async function privateStorage(page: Page) {
  expect(await page.evaluate(() => window.__telegramPrivacyProbe())).toEqual({
    credentialWritten: false,
    physicalCachePresent: false,
    unrelatedPreserved: true,
  });
}

test("official SDK control proves the unguarded launch cache retains credentials", async ({
  page,
}) => {
  await prepare(page);
  await page.route("**/__sdk-control", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<script src="${telegramSdkUrl}" integrity="${telegramSdkIntegrity}" crossorigin="anonymous"></script>`,
    }),
  );
  await page.goto(`/__sdk-control#${launchHash}`);
  expect(await page.evaluate(() => window.__telegramPrivacyProbe().credentialWritten)).toBe(true);
  expect(await page.evaluate(() => window.__telegramPrivacyProbe().physicalCachePresent)).toBe(
    true,
  );
});

test("real SDK launch never writes credentials and preserves invite, theme and viewport", async ({
  page,
}) => {
  await prepare(page);
  let privateConsole = false;
  page.on("console", (message) => {
    privateConsole ||= message.text().includes(canary);
  });
  await page.goto(`/?tgWebAppData=${encodeURIComponent(initData)}#${launchHash}`);
  await expect(
    page.getByRole("button", { name: "Continue with Telegram", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => location.href.includes("tgWebAppData"))).toBe(false);
  expect(await page.evaluate((raw) => window.Telegram?.WebApp?.initData === raw, initData)).toBe(
    true,
  );
  await privateStorage(page);
  await page.evaluate(() => {
    const bridge = window.Telegram as unknown as {
      WebView: { receiveEvent(type: string, data: unknown): void };
    };
    bridge.WebView.receiveEvent("theme_changed", {
      theme_params: { bg_color: "#000000", text_color: "#ffffff" },
    });
    bridge.WebView.receiveEvent("viewport_changed", {
      height: 720,
      is_state_stable: true,
      is_expanded: true,
    });
    bridge.WebView.receiveEvent("safe_area_changed", { top: 12, bottom: 8, left: 0, right: 0 });
  });
  await expect(page.locator("html")).toHaveAttribute("data-telegram-theme", "dark");
  expect(
    await page.evaluate(() => document.documentElement.style.getPropertyValue("--telegram-height")),
  ).toBe("720px");
  expect(
    await page.evaluate(() => document.documentElement.style.getPropertyValue("--telegram-top")),
  ).toBe("12px");
  const issued = page.waitForRequest((request) =>
    request.url().endsWith("/v1/auth/telegram-mini-app/registered-session"),
  );
  await page.getByRole("button", { name: "Continue with Telegram", exact: true }).click();
  expect((await issued).postDataJSON().initData === initData).toBe(true);
  await expect(page.getByRole("heading", { name: "You’re invited", exact: true })).toBeVisible();
  await privateStorage(page);
  expect(privateConsole).toBe(false);
});

test("accessible legacy caches are deleted without restoring identity on a clean launch", async ({
  page,
}) => {
  await prepare(page, true);
  await page.goto("/");
  await expect(
    page.getByText("Open HamBazi from Telegram to sign in and play with friends."),
  ).toBeVisible();
  expect(await page.evaluate(() => window.Telegram?.WebApp?.initData === "")).toBe(true);
  await privateStorage(page);
});

test("a clean reload drops the real SDK credential and requires a fresh Telegram launch", async ({
  page,
}) => {
  await prepare(page);
  await page.goto(`/#${launchHash}`);
  await expect(
    page.getByRole("button", { name: "Continue with Telegram", exact: true }),
  ).toBeVisible();
  await privateStorage(page);
  await page.reload();
  await expect(
    page.getByText("Open HamBazi from Telegram to sign in and play with friends."),
  ).toBeVisible();
  expect(await page.evaluate(() => window.Telegram?.WebApp?.initData === "")).toBe(true);
  await privateStorage(page);
});

for (const failedLogout of [false, true]) {
  test(`real SDK logout clears the session and cannot resurrect it (${failedLogout ? "failed" : "successful"} revocation request)`, async ({
    page,
  }) => {
    await prepare(page);
    await page.goto(`/#${launchHash}`);
    await page.getByRole("button", { name: "Continue with Telegram", exact: true }).click();
    await expect(page.getByRole("link", { name: "Profile", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Profile", exact: true }).click();
    if (failedLogout) await page.route("**/v1/auth/logout", (route) => route.abort());
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByText("Open HamBazi from Telegram to sign in and play with friends."),
    ).toBeVisible();
    await expect(page.getByText("test_12345")).toHaveCount(0);
    await privateStorage(page);
    await page.reload();
    await expect(
      page.getByText("Open HamBazi from Telegram to sign in and play with friends."),
    ).toBeVisible();
    expect(await page.evaluate(() => window.Telegram?.WebApp?.initData === "")).toBe(true);
    await privateStorage(page);
  });
}

test("an unmodifiable privacy boundary prevents the SDK from loading", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => Object.freeze(Storage.prototype));
  let sdkRequests = 0;
  page.on("request", (request) => {
    if (request.url() === new URL(telegramSdkUrl, fixture.replace(":4174", ":4173")).href)
      sdkRequests++;
  });
  await page.goto(`/#${launchHash}`);
  await expect(
    page.getByText("Open HamBazi from Telegram to sign in and play with friends."),
  ).toBeVisible();
  expect(sdkRequests).toBe(0);
  expect(await page.evaluate(() => window.Telegram?.WebApp === undefined)).toBe(true);
  expect(await page.evaluate(() => location.href.includes("tgWebAppData"))).toBe(false);
  await privateStorage(page);
});

test("real SDK launch works when browser storage is unavailable", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    for (const name of ["sessionStorage", "localStorage"])
      Object.defineProperty(window, name, {
        get() {
          throw new DOMException("Storage unavailable", "SecurityError");
        },
      });
  });
  await page.goto(`/#${launchHash}`);
  await expect(
    page.getByRole("button", { name: "Continue with Telegram", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate((raw) => window.Telegram?.WebApp?.initData === raw, initData)).toBe(
    true,
  );
  expect(await page.evaluate(() => location.href.includes("tgWebAppData"))).toBe(false);
});

test("changed SDK bytes fail integrity before any launch-cache code executes", async ({ page }) => {
  await prepare(page);
  await page.route(telegramSdkUrl, (route) =>
    route.fulfill({
      body: sdk + "\n/* changed upstream bytes */",
      contentType: "application/javascript",
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
  await page.goto(`/#${launchHash}`);
  await expect(
    page.getByText("Open HamBazi from Telegram to sign in and play with friends."),
  ).toBeVisible();
  expect(await page.evaluate(() => window.Telegram?.WebApp === undefined)).toBe(true);
  expect(await page.evaluate(() => location.href.includes("tgWebAppData"))).toBe(false);
  await privateStorage(page);
});

test("SDK delivery failure removes launch parameters and grants no session", async ({ page }) => {
  await prepare(page);
  await page.route(telegramSdkUrl, (route) => route.abort());
  await page.goto(`/#${launchHash}`);
  await expect(
    page.getByText("Open HamBazi from Telegram to sign in and play with friends."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Telegram", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => location.href.includes("tgWebAppData"))).toBe(false);
  await privateStorage(page);
});

test("query-only native launch uses the bundled SDK with external SDK network blocked", async ({
  page,
}) => {
  await prepare(page);
  await page.unroute(telegramSdkUrl);
  await page.route("https://telegram.org/**", (route) => route.abort());
  let externalSdkRequested = false;
  let privateConsole = false;
  page.on("request", (request) => {
    externalSdkRequested ||= request.url().startsWith("https://telegram.org/");
  });
  page.on("console", (message) => {
    privateConsole ||= message.text().includes(canary);
  });
  await page.goto(`/?tgWebAppData=${encodeURIComponent(initData)}`);
  await expect(
    page.getByRole("button", { name: "Continue with Telegram", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => typeof window.Telegram?.WebApp?.ready === "function")).toBe(
    true,
  );
  expect(await page.evaluate(() => location.href.includes("tgWebAppData"))).toBe(false);
  const issued = page.waitForRequest((request) =>
    request.url().endsWith("/v1/auth/telegram-mini-app/registered-session"),
  );
  await page.getByRole("button", { name: "Continue with Telegram", exact: true }).click();
  expect((await issued).postDataJSON().initData === initData).toBe(true);
  await expect(page.getByRole("heading", { name: "You’re invited", exact: true })).toBeVisible();
  await privateStorage(page);
  expect(externalSdkRequested).toBe(false);
  expect(privateConsole).toBe(false);
});
