import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, setup, launch, nativeEvent, matchId } from "./fixture.js";

test.use({ hasTouch: true });
for (const size of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  test(`paused lobby: artwork, Persian labels, keyboard and touch at ${size.width}`, async ({
    page,
    request,
  }, info) => {
    const state = await setup(page, request);
    state.coupPaused = true;
    await page.setViewportSize(size);
    await launch(page);
    const coup = page.getByRole("button", { name: "کودتا، موقتاً غیرفعال" });
    await expect(coup).toBeDisabled();
    for (const name of ["حکم", "کهربا", "شطرنج", "دومینو", "منچ"])
      await expect(page.getByRole("button", { name: `${name}، به‌زودی` })).toBeDisabled();
    await expect(page.locator(".home-card-arrow")).toHaveCount(0);
    await expect(page.locator(".home-card-badge .icon-lock")).toHaveCount(8);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.querySelectorAll<HTMLImageElement>(".home-screen img")].map((img) =>
          img.decode(),
        ),
      );
    });
    const styles = await page.locator(".home-game-card").evaluateAll((cards) =>
      cards.map((card) => ({
        filter: getComputedStyle(card.querySelector("img")!).filter,
        opacity: getComputedStyle(card).opacity,
        titleColor: getComputedStyle(card.querySelector(".home-card-title")!).color,
      })),
    );
    expect(
      styles.every(
        (style) =>
          style.filter.includes("grayscale(1)") &&
          style.filter.includes("brightness(0.72)") &&
          style.opacity === "1",
      ),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: size.width, height: 844 });
    await page.screenshot({
      path: info.outputPath(`lobby-disabled-${size.width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize(size);
    await coup.scrollIntoViewIfNeeded();
    const bounds = (await coup.boundingBox())!;
    await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await coup.evaluate((button: HTMLButtonElement) => button.click());
    await expect(page).toHaveURL(/#\/games$/);
    const settings = page.getByRole("button", { name: "تنظیمات", exact: true });
    await settings.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("region", { name: "فهرست بازی‌ها" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "بازی‌ها", exact: true })).toBeFocused();
    expect(state.starts).toEqual([]);
    expect(state.events).toEqual([]);
    await page.getByRole("link", { name: "پروفایل" }).tap();
    await expect(page.getByRole("heading", { name: "پروفایل" })).toBeVisible();
    await page.getByRole("link", { name: "بازی‌ها", exact: true }).tap();
    await expect(coup).toBeDisabled();
  });
}

test("pause preserves recovery, reconnect, legal play and historical direct views", async ({
  page,
  request,
}) => {
  const state = await setup(page, request);
  state.coupPaused = true;
  state.current = matchId;
  await launch(page, "/games/coup/play");
  await expect(page.getByLabel("میز کودتا")).toBeVisible();
  expect(state.starts).toEqual([]);
  await state.sockets.at(-1)!.close({ code: 1011, reason: "synthetic reconnect" });
  await expect.poll(() => state.sockets.length).toBe(2);
  await expect(page.getByLabel("میز کودتا")).toBeVisible();
  await page
    .getByRole("button", { name: /^درآمد/ })
    .first()
    .click();
  await expect(page.getByText(/برنده شد|بازی تمام شد/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "شروع بازی با ربات" })).toHaveCount(0);
  await nativeEvent(page, "back_button_pressed");
  await expect(page).toHaveURL(/#\/games$/);
  state.current = null;
  await page.evaluate((id) => {
    location.hash = `/match/${id}`;
  }, matchId);
  await expect(page.getByText(/برنده شد|بازی تمام شد/).first()).toBeVisible();
  expect(state.starts).toEqual([]);
  expect(state.events).toContain("game:command");
});

test("direct entry and empty recovery cannot create new matches during pause", async ({
  page,
  request,
}) => {
  const state = await setup(page, request);
  state.coupPaused = true;
  await launch(page, "/games/coup");
  await expect(page.getByRole("heading", { name: "کودتا — موقتاً غیرفعال" })).toBeVisible();
  await expect(page.getByRole("button", { name: "شروع بازی", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "ادامهٔ بازی موجود" }).click();
  await expect.poll(() => state.events.includes("personal:current")).toBe(true);
  await expect(page.getByRole("button", { name: "شروع بازی با ربات" })).toHaveCount(0);
  expect(state.starts).toEqual([]);
});

test("missing server availability fails closed; available Coup keeps colorful artwork", async ({
  page,
  request,
}) => {
  const state = await setup(page, request);
  state.availabilityMissing = true;
  await launch(page);
  await expect(page.getByRole("button", { name: "کودتا، در حال بررسی" })).toBeDisabled();
  await expect(page.locator(".home-game-unavailable")).toHaveCount(8);
  expect(state.starts).toEqual([]);
  state.availabilityMissing = false;
  await launch(page);
  const coup = page.getByRole("button", { name: "کودتا، فعال" });
  await expect(coup).toBeEnabled();
  expect(await coup.locator("img").evaluate((img) => getComputedStyle(img).filter)).toBe("none");
  await expect(page.getByRole("button", { name: "کهربا، به‌زودی" })).toBeDisabled();
});
