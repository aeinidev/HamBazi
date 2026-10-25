import { expect } from "@playwright/test";
import { test, setup, nativeEvent } from "./fixture.js";

test.use({ hasTouch: false });

for (const platform of ["tdesktop", "macos"]) {
  test(`${platform} stays windowed with portrait content and contained controls`, async ({
    page,
    request,
  }, info) => {
    await setup(page, request);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      const requests: string[] = [];
      Object.assign(window, {
        desktopPresentationRequests: requests,
        TelegramWebviewProxy: {
          postEvent(name: string) {
            if (["web_app_expand", "web_app_request_fullscreen"].includes(name))
              requests.push(name);
          },
        },
      });
    });
    const query = new URLSearchParams({
      tgWebAppData: "test=synthetic&auth_date=1791612000",
      tgWebAppVersion: "8.0",
      tgWebAppPlatform: platform,
    });
    await page.goto(`https://staging.hambazi.top/?${query}`);
    await expect(page.locator(".hambazi-loading")).toBeVisible();
    expect((await page.locator(".hambazi-loading").boundingBox())!.width).toBe(430);
    await expect(page.locator(".home-game-grid")).toBeVisible();
    for (const size of [
      { width: 1280, height: 800 },
      { width: 960, height: 720 },
      { width: 430, height: 740 },
    ]) {
      await page.setViewportSize(size);
      await nativeEvent(page, "viewport_changed", { height: size.height, is_state_stable: true });
      const frame = await page.locator("#root").boundingBox();
      expect(frame!.width).toBe(430);
      expect(frame!.x).toBe((size.width - 430) / 2);
      const dock = await page.locator(".home-bottom-nav").boundingBox();
      expect(dock!.x).toBeGreaterThanOrEqual(frame!.x);
      expect(dock!.x + dock!.width).toBeLessThanOrEqual(frame!.x + frame!.width);
      await expect(page.locator("html")).toHaveAttribute("data-fitted-page", "true");
      const grid = page.locator(".home-game-grid");
      await grid.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      expect(await page.evaluate(() => scrollY)).toBe(0);
      expect(await page.locator(".home-bottom-nav").boundingBox()).toEqual(dock);
      await page.screenshot({ path: info.outputPath(`desktop-${platform}-${size.width}.png`) });
    }
    for (const path of ["/settings", "/profile"]) {
      await page.evaluate((path) => {
        location.hash = path;
      }, path);
      await expect(
        page.getByRole("button", { name: "ذخیرهٔ تغییرات", exact: true }),
      ).toBeInViewport();
    }
    await nativeEvent(page, "activated");
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { desktopPresentationRequests: string[] })
            .desktopPresentationRequests,
      ),
    ).toEqual([]);
  });
}

test("desktop browser welcome stays inside the portrait frame", async ({ page, request }, info) => {
  await setup(page, request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("https://staging.hambazi.top/");
  await expect(page.getByRole("heading", { name: "یک قدم تا دنیای هم‌بازی" })).toBeVisible();
  const frame = await page.locator("#root").boundingBox();
  expect(frame!.width).toBe(430);
  const link = page.getByRole("link", { name: "باز کردن ربات هم‌بازی" });
  await expect(link).toBeInViewport();
  const bounds = await link.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(frame!.x);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(frame!.x + frame!.width);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(800);
  await page.screenshot({ path: info.outputPath("desktop-welcome.png") });
});
