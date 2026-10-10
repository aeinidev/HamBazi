import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { setup, launch, nativeEvent, fixtureOrigin, matchId } from "./fixture.js";

for (const viewerIndex of [0, 1])
  test(`registered identity ${viewerIndex}: static navigation never starts a game`, async ({
    page,
    request,
  }) => {
    const state = await setup(page, request, viewerIndex);
    await launch(page);
    await expect(page.getByRole("heading", { name: "بازی‌ها", exact: true })).toBeVisible();
    const coup = page.getByRole("button", { name: "کودتا، فعال" });
    await expect(coup).toBeEnabled();
    for (const name of ["حکم، به‌زودی", "منچ، به‌زودی"]) {
      const button = page.getByRole("button", { name });
      await expect(button).toBeDisabled();
      await button.evaluate((el: HTMLButtonElement) => el.click());
      await expect(page).toHaveURL(/#\/games$/);
    }
    await coup.click();
    await expect(page.getByRole("heading", { name: "کودتا", exact: true })).toBeVisible();
    await expect(page.locator(".coup-entry-options button")).toHaveCount(2);
    await page.getByRole("button", { name: "آموزش بازی", exact: true }).click();
    await expect(page.getByRole("heading", { name: "آموزش بازی کودتا" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "آنارشیست · اقدام مشترک" })).toBeVisible();
    await nativeEvent(page, "back_button_pressed");
    await expect(page).toHaveURL(/#\/games\/coup$/);
    await nativeEvent(page, "back_button_pressed");
    await expect(page).toHaveURL(/#\/games$/);
    expect(state.sockets).toHaveLength(0);
    expect(state.events).toEqual([]);
    expect(state.http).toEqual(["POST /v1/auth/telegram-mini-app/registered-session"]);
  });

test("unregistered direct routes remain gated without profile creation or gameplay", async ({
  page,
  request,
}) => {
  const state = await setup(page, request);
  await request.post(`${fixtureOrigin}/__test/state`, { data: { registrationRequired: true } });
  await launch(page, "/games/coup/play");
  await expect(page.getByRole("button", { name: "بازگشت به ربات" })).toBeVisible();
  for (const path of ["/games", "/games/coup", "/games/coup/tutorial", "/settings"]) {
    await page.evaluate((path) => {
      location.hash = path;
    }, path);
    await expect(page.getByRole("button", { name: "بازگشت به ربات" })).toBeVisible();
    await expect(
      page.locator(".midnight-catalog,.coup-entry-options,.midnight-tutorial,.midnight-settings"),
    ).toHaveCount(0);
  }
  expect(state.sockets).toHaveLength(0);
  expect(state.http).toEqual(["POST /v1/auth/telegram-mini-app/registered-session"]);
});

test("start is explicit, duplicate taps are bounded, back/reentry/reconnect resume the same match", async ({
  page,
  request,
}) => {
  const state = await setup(page, request);
  await launch(page);
  await page.getByRole("button", { name: "کودتا، فعال" }).click();
  await page
    .getByRole("button", { name: "شروع بازی", exact: true })
    .evaluate((el: HTMLButtonElement) => {
      el.click();
      el.click();
    });
  await expect(page.getByLabel("میز کودتا")).toBeVisible();
  expect(state.starts).toHaveLength(1);
  expect(state.current).toBe(matchId);
  await nativeEvent(page, "back_button_pressed");
  await expect(page).toHaveURL(/#\/games\/coup$/);
  await page.getByRole("button", { name: "شروع بازی", exact: true }).click();
  await expect(page.getByLabel("میز کودتا")).toBeVisible();
  await state.sockets.at(-1)!.close({ code: 1011, reason: "synthetic reconnect" });
  await expect.poll(() => state.sockets.length).toBe(2);
  await expect(page.getByLabel("میز کودتا")).toBeVisible();
  expect(state.starts).toHaveLength(1);
  expect(state.events).not.toContain("personal:close");
});

for (const fail of ["before", "after"] as const)
  test(`ambiguous start retry ${fail} commit preserves identity and never creates a second match`, async ({
    page,
    request,
  }) => {
    const state = await setup(page, request);
    state.failStart = fail;
    await launch(page);
    await page.getByRole("button", { name: "کودتا، فعال" }).click();
    await page.getByRole("button", { name: "شروع بازی", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("ارتباط قطع شد");
    await page.getByRole("button", { name: "تلاش دوباره" }).click();
    await expect(page.getByLabel("میز کودتا")).toBeVisible();
    expect(new Set(state.starts).size).toBe(1);
    expect(state.starts.length).toBe(fail === "before" ? 2 : 1);
  });

test("an existing personal match is resumed and its terminal view remains usable", async ({
  page,
  request,
}) => {
  const state = await setup(page, request);
  state.current = matchId;
  await launch(page);
  await page.getByRole("button", { name: "کودتا، فعال" }).click();
  await page.getByRole("button", { name: "شروع بازی", exact: true }).click();
  await expect(page.getByLabel("میز کودتا")).toBeVisible();
  const action = page.getByRole("button", { name: /^درآمد/ }).first();
  await action.click();
  await expect(page.getByText(/برنده شد|بازی تمام شد/).first()).toBeVisible();
  expect(state.starts).toEqual([]);
  expect(state.events).toContain("game:command");
});

test("a move during a slow poll does not trip the personal gateway pending guard", async ({
  page,
  request,
}) => {
  const state = await setup(page, request);
  state.enforceSinglePending = true;
  state.current = matchId;
  await launch(page);
  await page.getByRole("button", { name: "کودتا، فعال" }).click();
  await page.getByRole("button", { name: "شروع بازی", exact: true }).click();
  await expect(page.getByLabel("میز کودتا")).toBeVisible();
  state.holdNextCatchup = true;
  await expect.poll(() => state.releaseCatchup !== null).toBe(true);
  await page
    .getByRole("button", { name: /^درآمد/ })
    .first()
    .click();
  // The poll stays pending while the user submits a real table intent.
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(state.events.filter((event) => event === "game:command")).toHaveLength(0);
  state.releaseCatchup!();
  await expect(page.getByText(/برنده شد|بازی تمام شد/).first()).toBeVisible();
  expect(state.events.filter((event) => event === "game:command")).toHaveLength(1);
  expect(state.rateRejections).toBe(0);
  expect(state.maximumPending).toBe(1);
});

test("failed current lookup cannot fall through to match creation", async ({ page, request }) => {
  const state = await setup(page, request);
  state.failCurrent = true;
  await launch(page);
  await page.getByRole("button", { name: "کودتا، فعال" }).click();
  await page.getByRole("button", { name: "شروع بازی", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("ارتباط قطع شد");
  expect(state.starts).toEqual([]);
  await page.getByRole("button", { name: "تلاش دوباره" }).click();
  await expect(page.getByLabel("میز کودتا")).toBeVisible();
  expect(state.starts).toHaveLength(1);
});

test("settings uses the existing profile patch flow without public product requests", async ({
  page,
  request,
}) => {
  const state = await setup(page, request);
  await launch(page);
  await page.getByRole("button", { name: "تنظیمات", exact: true }).click();
  await expect(page.getByRole("heading", { name: "حساب و تنظیمات" })).toBeVisible();
  await page.getByLabel("نام نمایشی").fill("بازیکن آزمایشی");
  await page.getByRole("button", { name: "ذخیرهٔ تغییرات" }).click();
  await expect.poll(() => state.http.filter((x) => x === "PATCH /v1/me").length).toBe(1);
  await nativeEvent(page, "back_button_pressed");
  await expect(page).toHaveURL(/#\/games$/);
  expect(state.sockets).toHaveLength(0);
  expect(state.http.every((x) => /\/v1\/(auth|me)(\/|$)/.test(x))).toBe(true);
});

for (const size of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
])
  test(`font, RTL, touch targets, safe area and scroll at ${size.width}`, async ({
    page,
    request,
  }, info) => {
    await setup(page, request);
    await page.setViewportSize(size);
    await launch(page);
    await expect(page.getByRole("heading", { name: "بازی‌ها", exact: true })).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    expect(
      await page.evaluate(() =>
        [...document.fonts].some((f) => f.family === "HamBazi Display" && f.status === "loaded"),
      ),
    ).toBe(true);
    await nativeEvent(page, "safe_area_changed", { top: 20, bottom: 25, left: 0, right: 0 });
    expect(
      await page.evaluate(() =>
        parseFloat(getComputedStyle(document.querySelector(".midnight-shell")!).paddingBottom),
      ),
    ).toBeGreaterThanOrEqual(25);
    for (const screen of ["lobby", "entry", "tutorial"]) {
      if (screen === "entry") await page.getByRole("button", { name: "کودتا، فعال" }).click();
      if (screen === "tutorial")
        await page.getByRole("button", { name: "آموزش بازی", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      const bounds = await page
        .locator("button:enabled")
        .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().height));
      expect(bounds.every((height) => height >= 44)).toBe(true);
      await page.screenshot({
        path: info.outputPath(`${screen}-${size.width}.png`),
        fullPage: true,
      });
    }
  });

test("font download failure keeps live Persian controls readable", async ({ page, request }) => {
  await setup(page, request);
  await page.route("**/HamBaziDisplay-Regular.ttf", (route) => route.abort());
  await page.setViewportSize({ width: 320, height: 568 });
  await launch(page);
  await expect(page.getByRole("heading", { name: "بازی‌ها", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "کودتا، فعال" }).click();
  await expect(page.getByRole("button", { name: "شروع بازی", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("keyboard navigation and enlarged text retain reachable controls", async ({
  page,
  request,
}, info) => {
  await setup(page, request);
  await page.setViewportSize({ width: 320, height: 568 });
  await launch(page);
  await expect(page.getByRole("heading", { name: "بازی‌ها", exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });
  const coup = page.getByRole("button", { name: "کودتا، فعال" });
  await coup.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "کودتا", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const tutorial = page.getByRole("button", { name: "آموزش بازی", exact: true });
  await tutorial.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "آموزش بازی کودتا" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("tutorial-enlarged.png"), fullPage: true });
});
