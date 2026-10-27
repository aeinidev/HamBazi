import { test, setup, launch, nativeEvent } from "./fixture.js";
import { expect, type Page } from "@playwright/test";

async function fits(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth <= innerWidth + 1,
        vertical: document.documentElement.scrollHeight <= innerHeight + 1,
      })),
    )
    .toEqual({ horizontal: true, vertical: true });
  const bounds = await page
    .locator("main button, main input, main select, .home-bottom-nav")
    .evaluateAll((es) =>
      // Cards deliberately scroll inside their own grid; reachability is tested below.
      es
        .filter((e) => !e.closest(".home-game-grid"))
        .map((e) => {
          const r = e.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        }),
    );
  for (const b of bounds) {
    expect(b.top).toBeGreaterThanOrEqual(0);
    expect(b.bottom).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
}
for (const size of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 720 },
]) {
  test(`simple personal pages use the available space at ${size.width}x${size.height}`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize(size);
    await setup(page, request);
    await launch(page);
    for (const path of ["/games", "/settings", "/profile", "/games/coup"]) {
      await page.evaluate((path) => {
        location.hash = path;
      }, path);
      await expect(page.locator(".midnight-shell")).toHaveAttribute(
        "data-screen",
        {
          "/games": "home",
          "/settings": "settings",
          "/profile": "profile",
          "/games/coup": "entry",
        }[path]!,
      );
      await page.evaluate(() => document.fonts.ready);
      await fits(page);
      if (path === "/games") {
        const last = page.locator(".home-game-card").last();
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport();
        const card = (await last.boundingBox())!;
        expect(card.y + card.height).toBeLessThanOrEqual(
          (await page.locator(".home-bottom-nav").boundingBox())!.y,
        );
        const art = await page.locator(".home-banner").evaluate((e) => {
          const r = e.getBoundingClientRect();
          return {
            top: r.top,
            bottom: r.bottom,
            copy: [...e.querySelectorAll(".home-banner-copy > *")].map((c) => {
              const b = c.getBoundingClientRect();
              return { top: b.top, bottom: b.bottom, height: b.height };
            }),
          };
        });
        for (const c of art.copy) {
          expect(c.height).toBeGreaterThan(0);
          expect(c.top).toBeGreaterThanOrEqual(art.top);
          expect(c.bottom).toBeLessThanOrEqual(art.bottom);
        }
      }
      await page.screenshot({ path: info.outputPath(`${path.split("/").at(-1)}.png`) });
    }
  });
}
test("native insets fit simple pages and long content can still scroll", async ({
  page,
  request,
}) => {
  await setup(page, request);
  await launch(page);
  await nativeEvent(page, "safe_area_changed", { top: 47, bottom: 34, left: 0, right: 0 });
  await nativeEvent(page, "content_safe_area_changed", { top: 56, bottom: 0, left: 12, right: 12 });
  for (const path of ["/games", "/settings", "/profile"]) {
    await page.evaluate((path) => {
      location.hash = path;
    }, path);
    await expect(page.locator(".midnight-shell")).toHaveAttribute(
      "data-screen",
      path === "/games" ? "home" : path.slice(1),
    );
    await fits(page);
  }
  await page.evaluate(() => {
    location.hash = "/games/coup/tutorial";
  });
  await expect(page.locator(".midnight-tutorial section")).toHaveCount(7);
  await page.getByRole("heading", { name: "زمان و ادامهٔ بازی" }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.evaluate(() => {
    location.hash = "/games";
  });
  await expect(page.locator(".home-game-grid")).toBeVisible();
  await page.evaluate(() => {
    const grid = document.querySelector(".home-game-grid")!;
    for (let i = 0; i < 12; i++) grid.append(grid.firstElementChild!.cloneNode(true));
  });
  const last = page.locator(".home-game-card").last();
  await last.scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(await page.locator(".home-game-grid").evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator("html")).toHaveAttribute("data-fitted-page", "true");
  expect((await last.boundingBox())!.y + (await last.boundingBox())!.height).toBeLessThanOrEqual(
    (await page.locator(".home-bottom-nav").boundingBox())!.y,
  );
});
test("enlarged text and keyboard-sized viewports keep profile controls reachable", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await setup(page, request);
  await launch(page, "/profile");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "28px";
  });
  const save = page.getByRole("button", { name: "ذخیرهٔ تغییرات" });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.setViewportSize({ width: 320, height: 360 });
  await page.getByLabel("نام نمایشی").focus();
  await expect(page.getByLabel("نام نمایشی")).toBeInViewport();
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
});
