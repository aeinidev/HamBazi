import { test } from "./fixture.js";
import { expect, type Page } from "@playwright/test";
import { setup, nativeEvent, matchId } from "./fixture.js";

declare global {
  interface Window {
    __presentationEvents: { name: string; allowVerticalSwipe?: boolean }[];
  }
}
test.use({ hasTouch: true });

async function captureNativeRequests(page: Page) {
  await page.addInitScript(() => {
    window.__presentationEvents = [];
    Object.assign(window, {
      TelegramWebviewProxy: {
        postEvent(name: string, payload: string) {
          if (name === "web_app_request_fullscreen") window.__presentationEvents.push({ name });
          if (name === "web_app_setup_swipe_behavior")
            window.__presentationEvents.push({
              name,
              allowVerticalSwipe: JSON.parse(payload).allow_vertical_swipe,
            });
        },
      },
    });
  });
}
async function launchVersion(page: Page, version: string) {
  const query = new URLSearchParams({
    tgWebAppData: "test=synthetic&auth_date=1791612000",
    tgWebAppVersion: version,
    tgWebAppPlatform: "ios",
  });
  await page.goto(`https://staging.hambazi.top/?${query}#${query}`);
  await expect(page.getByRole("heading", { name: "بازی‌ها", exact: true })).toBeVisible();
}

for (const [version, requests] of [
  ["7.6", []],
  ["7.7", [{ name: "web_app_setup_swipe_behavior", allowVerticalSwipe: false }]],
  [
    "8.0",
    [
      { name: "web_app_setup_swipe_behavior", allowVerticalSwipe: false },
      { name: "web_app_request_fullscreen" },
    ],
  ],
] as const)
  test(`native launch capabilities on ${version}`, async ({ page, request }) => {
    await setup(page, request);
    await captureNativeRequests(page);
    await launchVersion(page, version);
    expect(await page.evaluate(() => window.__presentationEvents)).toEqual(requests);
    await page.getByRole("button", { name: "کودتا، فعال" }).tap();
    await expect(page.getByRole("heading", { name: "کودتا", exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__presentationEvents)).toEqual(requests);
  });

test("fullscreen exit/failure preserves scrolling, touch, safe areas and navigation on all personal screens", async ({
  page,
  request,
}) => {
  const state = await setup(page, request);
  state.current = matchId;
  await captureNativeRequests(page);
  await launchVersion(page, "8.0");
  const original = await page.evaluate(() => window.__presentationEvents);
  await nativeEvent(page, "fullscreen_changed", { is_fullscreen: true });
  await nativeEvent(page, "safe_area_changed", { top: 47, bottom: 34, left: 0, right: 0 });
  await nativeEvent(page, "content_safe_area_changed", { top: 56, bottom: 0, left: 12, right: 12 });
  const safeArea = async () => {
    const metrics = await page.locator(".midnight-shell").evaluate((shell) => {
      const css = getComputedStyle(shell);
      return {
        top: parseFloat(css.paddingTop),
        bottom:
          parseFloat(css.paddingBottom) +
          parseFloat(getComputedStyle(shell.querySelector("main")!).paddingBottom),
        headerTop: shell.querySelector("header")!.getBoundingClientRect().top + scrollY,
      };
    });
    expect(metrics.top).toBeGreaterThanOrEqual(103);
    expect(metrics.bottom).toBeGreaterThanOrEqual(34);
    expect(metrics.headerTop).toBeGreaterThanOrEqual(103);
  };
  await safeArea();
  await page.getByRole("button", { name: "کودتا، فعال" }).tap();
  await safeArea();
  await page.getByRole("button", { name: "آموزش بازی", exact: true }).tap();
  await safeArea();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  expect(
    await page.locator("main").evaluate((main) => {
      const move = new Event("touchmove", { bubbles: true, cancelable: true });
      main.dispatchEvent(move);
      return move.defaultPrevented;
    }),
  ).toBe(false);
  await nativeEvent(page, "fullscreen_changed", { is_fullscreen: false });
  await nativeEvent(page, "fullscreen_failed", { error: "UNSUPPORTED" });
  await nativeEvent(page, "activated");
  await nativeEvent(page, "viewport_changed", { height: 667, is_state_stable: true });
  await nativeEvent(page, "back_button_pressed");
  await expect(page).toHaveURL(/#\/games\/coup$/);
  await page.getByRole("button", { name: "شروع بازی", exact: true }).tap();
  await expect(page.getByLabel("میز کودتا")).toBeVisible();
  await safeArea();
  await nativeEvent(page, "back_button_pressed");
  await nativeEvent(page, "back_button_pressed");
  await page.getByRole("button", { name: "تنظیمات", exact: true }).tap();
  await expect(page.getByLabel("نام نمایشی")).toBeVisible();
  await page.getByLabel("نام نمایشی").fill("Synthetic editable name");
  await safeArea();
  expect(await page.evaluate(() => window.__presentationEvents)).toEqual(original);
  expect(state.starts).toEqual([]);
});
