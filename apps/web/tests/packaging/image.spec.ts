import { expect, test } from "@playwright/test";
import { readTelegramSdk } from "../browser/telegram-sdk.js";
import { telegramSdkUrl } from "../../src/platform/telegram-sdk.js";

let sdk: string;
declare global {
  interface Window {
    __packagingPrivacySafe: () => boolean;
  }
}
test.beforeAll(async () => {
  sdk = await readTelegramSdk();
});
test.beforeEach(async ({ page }) => {
  await page.route(telegramSdkUrl, (route) =>
    route.fulfill({
      body: sdk,
      contentType: "application/javascript",
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
});

test("actual static image serves the built app and blocks inline script execution", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  expect(response?.headers()["content-security-policy"]).toContain("default-src 'none'");
  await expect(
    page.getByText("Open HamBazi from Telegram to sign in and play with friends."),
  ).toBeVisible();
  const safe = await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "document.documentElement.dataset.inlineCanary = 'executed'";
    document.head.append(script);
    return (
      document.documentElement.dataset.inlineCanary === undefined &&
      localStorage.length === 0 &&
      sessionStorage.length === 0
    );
  });
  expect(safe).toBe(true);
});

test("actual static image cleans synthetic Telegram launch data before SDK caching", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    Object.assign(window, {
      __packagingPrivacySafe: () =>
        !location.href.includes("tgWebAppData") &&
        [sessionStorage, localStorage].every(
          (area) => get.call(area, "__telegram__initParams") === null,
        ),
    });
  });
  const launch = new URLSearchParams({
    tgWebAppData: "auth_date=1791060000&query_id=synthetic_packaging",
    tgWebAppVersion: "9.0",
    tgWebAppPlatform: "web",
  });
  await page.goto(`/#${launch}`);
  await expect(
    page.getByRole("button", { name: "Continue with Telegram", exact: true }),
  ).toBeVisible();
  const safe = await page.evaluate(() => window.__packagingPrivacySafe());
  expect(safe).toBe(true);
});
