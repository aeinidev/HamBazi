import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, setup } from "./fixture.js";

test("browser visitors see a usable Telegram entry without authenticating", async ({
  page,
  request,
}, info) => {
  const state = await setup(page, request);
  await page.goto("https://staging.hambazi.top/");
  await expect(page.getByRole("heading", { name: "یک قدم تا دنیای هم‌بازی" })).toBeVisible();
  const link = page.getByRole("link", { name: "باز کردن ربات هم‌بازی" });
  await expect(link).toHaveAttribute("href", "https://t.me/Hambazidev_bot");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.locator(".home-header,.midnight-header,.hambazi-loading")).toHaveCount(0);
  for (const size of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 320 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await page.evaluate(() => document.fonts.ready);
    await page
      .locator(".telegram-welcome-art img")
      .evaluate((el) => (el as HTMLImageElement).decode());
    await expect(link).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      size.width,
    );
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      size.height + 1,
    );
    await page.screenshot({ path: info.outputPath(`telegram-welcome-${size.width}.png`) });
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await link.focus();
  await expect(link).toBeFocused();
  expect(state.http).toEqual([]);
  expect(state.sockets).toEqual([]);
});
