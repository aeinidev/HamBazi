import { test } from "./fixture.js";
import { expect } from "@playwright/test";
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
    expect(state.http[0]).toBe("POST /v1/auth/telegram-mini-app/registered-session-photo");
    expect(state.http.slice(1).sort()).toEqual(
      [
        "GET /v1/games/availability",
        "GET /v1/me",
        ...(process.env.VITE_KAHROBA_RUNTIME === "true" ? ["GET /v1/kahroba/capabilities"] : []),
      ].sort(),
    );
  });

test("home shows eight catalog cards and keeps future actions inert across direct routes", async ({
  page,
  request,
}) => {
  const state = await setup(page, request);
  await launch(page);
  await expect(page.locator(".home-game-card")).toHaveCount(8);
  await expect(page.getByRole("button", { name: "کودتا، فعال" })).toBeEnabled();
  for (const name of ["حکم", "کهربا", "شطرنج", "دومینو", "منچ", "اونو", "نبرد کشتی‌ها"])
    await expect(page.getByRole("button", { name: `${name}، به‌زودی` })).toBeDisabled();
  for (const name of [
    "همه را ببینید، به‌زودی",
    "دوستان، به‌زودی",
    "برترین‌ها، به‌زودی",
    "چت، به‌زودی",
    "اعلان‌ها، به‌زودی",
  ])
    await expect(page.getByRole("button", { name })).toBeDisabled();
  const fixedTop = await page
    .locator(".home-section-heading")
    .evaluate((el) => el.getBoundingClientRect().top);
  for (const id of ["uno", "battleship"]) {
    const card = page.locator(`.home-game-${id}`);
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeInViewport();
    await expect
      .poll(() =>
        card
          .locator("img")
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
    await card.evaluate((el: HTMLButtonElement) => el.click());
    await expect(page).toHaveURL(/#\/games$/);
  }
  expect(await page.locator(".home-game-grid").evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(
    await page.locator(".home-section-heading").evaluate((el) => el.getBoundingClientRect().top),
  ).toBe(fixedTop);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const calls = [...state.http];
  for (const path of [
    "/games/hokm",
    "/games/kahroba",
    "/games/chess",
    "/games/domino",
    "/games/ludo",
    "/friends",
    "/leaderboard/coup",
  ]) {
    await page.evaluate((value) => {
      location.hash = value;
    }, path);
    await expect(page.getByRole("heading", { name: "به‌زودی" })).toBeVisible();
    await expect(page.locator(".coup-entry-options,.midnight-personal-game")).toHaveCount(0);
  }
  expect(state.http).toEqual(calls);
  expect(state.events).toEqual([]);
  expect(state.starts).toEqual([]);
  await page.getByRole("link", { name: "بازگشت به خانه" }).click();
  await page.getByRole("link", { name: "پروفایل" }).click();
  await expect(page).toHaveURL(/#\/profile$/);
  await expect(page.getByRole("heading", { name: "پروفایل" })).toBeVisible();
  await page.getByRole("link", { name: "بازی‌ها", exact: true }).click();
  await expect(page).toHaveURL(/#\/games$/);
});

test("home renders the authenticated photo and saved name", async ({ page, request }) => {
  await setup(page, request);
  await request.post(`${fixtureOrigin}/__test/state`, {
    data: { displayName: "نام آزمایشی", photoUrl: "https://t.me/i/userpic/320/synthetic.jpg" },
  });
  await page.route("https://t.me/i/userpic/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==",
        "base64",
      ),
    }),
  );
  await launch(page);
  await expect(page.locator(".home-identity")).toContainText("نام آزمایشی");
  await expect(page.locator(".home-identity img")).toHaveAttribute("src", /t\.me\/i\/userpic/);
  await expect
    .poll(() =>
      page.locator(".home-identity img").evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1);
  await expect(page.locator(".home-identity .fallback-avatar")).toHaveCount(0);
});

test("available Kahroba appears in the settled shared lobby without a separate private entry", async ({
  page,
  request,
}) => {
  const state = await setup(page, request);
  await page.route("https://api-staging.hambazi.top/v1/games/availability", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        games: [],
        lobbyAvailability: [{ id: "kahroba", state: "AVAILABLE" }],
      },
      headers: { "access-control-allow-origin": "https://staging.hambazi.top" },
    }),
  );
  await launch(page);
  await expect(page.getByRole("button", { name: "کهربا، فعال", exact: true })).toBeEnabled();
  await expect(page.locator(".home-game-card")).toHaveCount(8);
  await expect(page.locator(".home-identity")).toBeVisible();
  await expect(page.getByText("ورود خصوصی کهربا", { exact: true })).toHaveCount(0);
  expect(state.starts).toEqual([]);
  expect(state.sockets).toHaveLength(0);
});

test("mobile RTL grid and fixed navigation leave the last card reachable", async ({
  page,
  request,
}) => {
  await setup(page, request);
  await page.setViewportSize({ width: 320, height: 568 });
  await launch(page);
  await expect(page.locator(".home-game-coup")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        const card = document.querySelector<HTMLElement>(".home-game-coup")!;
        const nav = document.querySelector<HTMLElement>(".home-bottom-nav")!;
        return Math.round(card.getBoundingClientRect().bottom - nav.getBoundingClientRect().top);
      }),
    )
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>(".home-game-grid")!;
      return {
        direction: getComputedStyle(grid).direction,
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
      };
    }),
  ).toEqual({ direction: "rtl", columns: 2, noHorizontalOverflow: true });
});

test("unregistered direct routes remain gated without profile creation or gameplay", async ({
  page,
  request,
}) => {
  const state = await setup(page, request);
  await request.post(`${fixtureOrigin}/__test/state`, { data: { registrationRequired: true } });
  await launch(page, "/games/coup/play");
  await expect(page.getByRole("button", { name: "ثبت نام و ادامه" })).toBeVisible();
  for (const path of ["/games", "/games/coup", "/games/coup/tutorial", "/settings"]) {
    await page.evaluate((path) => {
      location.hash = path;
    }, path);
    await expect(page.getByRole("button", { name: "ثبت نام و ادامه" })).toBeVisible();
    await expect(
      page.locator(".midnight-catalog,.coup-entry-options,.midnight-tutorial,.midnight-settings"),
    ).toHaveCount(0);
  }
  expect(state.sockets).toHaveLength(0);
  expect(state.http).toEqual(["POST /v1/auth/telegram-mini-app/registered-session-photo"]);
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

test("settings patches the profile and makes only declared read requests", async ({
  page,
  request,
}) => {
  const state = await setup(page, request);
  await launch(page);
  await page.getByRole("button", { name: "تنظیمات", exact: true }).click();
  await expect(page.getByRole("heading", { name: "حساب و تنظیمات" })).toBeVisible();
  await page.getByLabel("نام نمایشی").fill("بازیکن آزمایشی");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/me") && response.request().method() === "PATCH" && response.ok(),
  );
  await page.getByRole("button", { name: "ذخیرهٔ تغییرات" }).click();
  await saved;
  await expect.poll(() => state.http.filter((x) => x === "PATCH /v1/me").length).toBe(1);
  await nativeEvent(page, "back_button_pressed");
  await expect(page).toHaveURL(/#\/games$/);
  expect(state.sockets).toHaveLength(0);
  expect(
    state.http.every(
      (x) =>
        /\/v1\/(auth|me|games)(\/|$)/.test(x) ||
        (process.env.VITE_KAHROBA_RUNTIME === "true" && x === "GET /v1/kahroba/capabilities"),
    ),
  ).toBe(true);
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
    await request.post(`${fixtureOrigin}/__test/state`, { data: { displayName: "الکس" } });
    await page.setViewportSize(size);
    await launch(page);
    await expect(page.getByRole("heading", { name: "بازی‌ها", exact: true })).toBeVisible();
    await expect(page.locator(".home-identity")).toContainText("الکس");
    await expect(page.locator(".home-identity .fallback-avatar")).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    expect(
      await page.evaluate(() =>
        [...document.fonts].some((f) => f.family === "Vazirmatn" && f.status === "loaded"),
      ),
    ).toBe(true);
    await nativeEvent(page, "safe_area_changed", { top: 20, bottom: 25, left: 0, right: 0 });
    expect(
      await page.evaluate(() =>
        parseFloat(
          getComputedStyle(document.querySelector(".midnight-shell > main")!).paddingBottom,
        ),
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
      if (screen === "lobby") {
        await page.screenshot({ path: info.outputPath(`home-top-${size.width}.png`) });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect(page.getByRole("button", { name: "کودتا، فعال" })).toBeInViewport();
        await page.screenshot({ path: info.outputPath(`home-bottom-${size.width}.png`) });
      }
    }
  });

test("font download failure keeps live Persian controls readable", async ({ page, request }) => {
  await setup(page, request);
  await page.route("**/HamBaziDisplay-Regular.ttf", (route) => route.abort());
  await page.route("**/Vazirmatn-*.woff2", (route) => route.abort());
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
