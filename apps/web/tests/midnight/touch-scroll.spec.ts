import { test, setup, launch, nativeEvent } from "./fixture.js";
import { expect } from "@playwright/test";
import { verticalDrag } from "../touch-scroll.js";

test("short personal pages reject vertical dragging without affecting taps, editing or pinch", async ({
  page,
  request,
}) => {
  await setup(page, request);
  await launch(page);
  for (const path of ["/games", "/settings", "/profile", "/games/coup"]) {
    await page.evaluate((path) => {
      location.hash = path;
    }, path);
    await expect(page.locator("html")).toHaveAttribute("data-fitted-page", "true");
    const target = page.locator("main");
    expect(await verticalDrag(target)).toBe(true);
    expect(await verticalDrag(target, -80)).toBe(true);
    expect(await verticalDrag(target, 80, 2)).toBe(false);
    expect(await verticalDrag(target, 0, 1, 80)).toBe(false);
    await page.mouse.wheel(0, 300);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    if (path === "/settings" || path === "/profile") {
      const name = page.getByLabel("نام نمایشی");
      expect(await verticalDrag(name)).toBe(false);
      await name.fill("نام قابل ویرایش");
      await expect(name).toHaveValue("نام قابل ویرایش");
    }
  }
  await page.getByRole("button", { name: "آموزش بازی", exact: true }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-fitted-page", "true");
  expect(await verticalDrag(page.locator("main"))).toBe(false);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
});
test("content outside the game list and smaller viewports release the lock", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await setup(page, request);
  await launch(page);
  await expect(page.locator("html")).toHaveAttribute("data-fitted-page", "true");
  await page.evaluate(() => {
    const node = document.createElement("div");
    node.dataset.extra = "true";
    node.style.minHeight = "900px";
    document.querySelector(".home-screen")!.append(node);
  });
  await expect(page.locator("html")).not.toHaveAttribute("data-fitted-page", "true");
  expect(await verticalDrag(page.locator("main"))).toBe(false);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.evaluate(() => document.querySelectorAll("[data-extra]").forEach((e) => e.remove()));
  await expect(page.locator("html")).toHaveAttribute("data-fitted-page", "true");
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.evaluate(() => {
    location.hash = "/profile";
  });
  await expect(page.getByLabel("نام نمایشی")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-fitted-page", "true");
  await page.setViewportSize({ width: 320, height: 360 });
  await expect(page.locator("html")).not.toHaveAttribute("data-fitted-page", "true");
  await page.getByRole("button", { name: "ذخیرهٔ تغییرات" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "ذخیرهٔ تغییرات" })).toBeInViewport();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.locator("html")).toHaveAttribute("data-fitted-page", "true");
});

for (const size of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 720 },
]) {
  test(`only the game list scrolls as the catalog grows at ${size.width}x${size.height}`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize(size);
    await setup(page, request);
    await launch(page);
    if (size.width === 320) {
      await nativeEvent(page, "safe_area_changed", { top: 47, bottom: 34, left: 0, right: 0 });
      await nativeEvent(page, "content_safe_area_changed", {
        top: 56,
        bottom: 0,
        left: 12,
        right: 12,
      });
    }
    await page.evaluate(() => document.fonts.ready);
    const grid = page.getByRole("region", { name: "فهرست بازی‌ها" });
    await expect(page.locator("html")).toHaveAttribute("data-fitted-page", "true");
    const fixedBounds = () =>
      page
        .locator(
          ".home-header, .home-banner, .home-section-heading, .home-bottom-nav, .home-game-grid, .home-game-card:first-child",
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const { x, y, width, height } = node.getBoundingClientRect();
            return { x, y, width, height };
          }),
        );
    const before = await fixedBounds();
    await grid.evaluate((grid) => {
      for (let i = 0; i < 18; i++) grid.append(grid.firstElementChild!.cloneNode(true));
    });
    await expect.poll(fixedBounds).toEqual(before);
    await expect(page.locator("html")).toHaveAttribute("data-fitted-page", "true");
    expect(await verticalDrag(grid, 80)).toBe(true);
    expect(await verticalDrag(grid, -80)).toBe(false);
    await grid.hover();
    await page.mouse.wheel(0, 180);
    await expect.poll(() => grid.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    expect(await verticalDrag(page.locator(".home-banner"), -80)).toBe(true);
    await grid.focus();
    for (let i = 0; i < 20; i++) await page.keyboard.press("PageDown");
    await expect
      .poll(() => grid.evaluate((e) => Math.abs(e.scrollHeight - e.clientHeight - e.scrollTop)))
      .toBeLessThanOrEqual(1);
    const last = page.locator(".home-game-card").last();
    const listBounds = (await grid.boundingBox())!;
    const lastBounds = (await last.boundingBox())!;
    expect(lastBounds.y).toBeGreaterThanOrEqual(listBounds.y - 1);
    expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(
      listBounds.y + listBounds.height + 1,
    );
    expect(listBounds.y + listBounds.height).toBeLessThanOrEqual(
      (await page.locator(".home-bottom-nav").boundingBox())!.y,
    );
    expect(await verticalDrag(grid, -80)).toBe(true);
    expect(await verticalDrag(grid, 80)).toBe(false);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await grid.evaluate((e) => {
      e.scrollTop = 0;
    });
    expect(await fixedBounds()).toEqual(before);
    await page.screenshot({ path: info.outputPath("scrollable-games.png") });
  });
}
