import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { verticalDrag } from "../touch-scroll.js";

const api = "http://127.0.0.1:4184",
  roomId = "77777777-7777-4777-8777-777777777777",
  screenshots = process.env.KAHROBA_LOBBY_EVIDENCE ?? "../../test-results/kahroba-lobby-mvp";

async function fixture(
  page: Page,
  request: APIRequestContext,
  mode = "host",
  capacity = 2,
  withRoom = true,
) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["http://127.0.0.1:4183", api].includes(url.origin)) return route.continue();
    return route.abort("blockedbyclient");
  });
  const login = await request.post(`${api}/v1/auth/telegram-mini-app/registered-session-photo`, {
      data: {},
    }),
    token = (await login.json()).accessToken as string;
  await request.post(`${api}/__preview/lobby`, {
    headers: { authorization: `Bearer ${token}` },
    data: { mode, capacity },
  });
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, {
      __lobbyShareCalls: calls,
      Telegram: { WebApp: { openTelegramLink: (url: string) => calls.push(url) } },
    });
  });
  await page.goto(`/?lobby=1${withRoom ? `&room=${roomId}` : ""}`);
  await expect(page.getByRole("region", { name: "لابی کهربا" })).toBeVisible();
  if (withRoom && !["forbidden", "unauthenticated"].includes(mode))
    await expect(page.locator(".khl-room-code bdi")).toHaveText(roomId.slice(0, 8).toUpperCase());
  return token;
}
async function nativeCalls(page: Page) {
  return page.evaluate(
    () => (window as Window & { __lobbyShareCalls?: string[] }).__lobbyShareCalls ?? [],
  );
}

for (const width of [320, 375, 390, 768]) {
  test(`premium RTL lobby at ${width}px preserves real membership and the approved controls`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: width >= 600 ? 1024 : 844 });
    await fixture(page, request);
    await expect(page.getByRole("button", { name: "اشتراک‌گذاری", exact: true })).toBeEnabled();
    await expect(page.locator(".khl-start")).toBeDisabled();
    await expect(page.locator(".khl-lobby a, .khl-lobby input, .khl-lobby select")).toHaveCount(0);
    await expect(page.locator(".khl-player")).toHaveCount(2);
    await expect(page.locator(".khl-player:not(.khl-empty-player)")).toHaveCount(1);
    await expect(page.locator(".khl-player-info > strong")).toHaveText("مهدی");
    await expect(page.locator(".khl-room-meta")).toContainText("۱ از ۲ بازیکن");
    expect(await page.locator(".khl-lobby").evaluate((e) => getComputedStyle(e).direction)).toBe(
      "rtl",
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await page.locator(".khl-lobby").innerText()).not.toMatch(
      /K7B4|آرمان|نرگس|سعید|آماده است|۲۴ میلی/,
    );
    await expect.poll(() => page.evaluate(() => document.fonts.check("16px Vazirmatn"))).toBe(true);
    await expect
      .poll(() =>
        page
          .locator(".khl-lobby img")
          .evaluateAll((images) =>
            images.every(
              (img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--telegram-top", "18px");
      document.documentElement.style.setProperty("--telegram-bottom", "24px");
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
      path: resolve(screenshots, `${info.project.name}-lobby-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}

test("native Main Mini App sharing resolves a fresh server invitation; disabled controls send no commands", async ({
  page,
  request,
}) => {
  await fixture(page, request);
  const forbiddenMutations: string[] = [];
  page.on("request", (req) => {
    if (
      req.method() !== "GET" &&
      req.url().startsWith(api) &&
      !req.url().endsWith("/room-invites/resolve")
    )
      forbiddenMutations.push(new URL(req.url()).pathname);
  });
  await page.locator(".khl-lobby button:disabled").evaluateAll((buttons) => {
    for (const button of buttons) (button as HTMLButtonElement).click();
  });
  expect(await nativeCalls(page)).toEqual([]);
  const response = page.waitForResponse(
    (res) => res.url() === `${api}/v1/kahroba/rooms/${roomId}/invite`,
  );
  await page.getByRole("button", { name: "اشتراک‌گذاری", exact: true }).click();
  const issued = (await (await response).json()).invite;
  await expect.poll(async () => (await nativeCalls(page)).length).toBe(1);
  const target = new URL((await nativeCalls(page))[0]!);
  expect(target.origin + target.pathname).toBe("https://t.me/share/url");
  expect(target.searchParams.get("url")).toBe(issued.deepLink);
  expect(new URL(issued.deepLink).pathname).toBe("/Hambazidev_bot");
  expect(new URL(issued.deepLink).searchParams.get("startapp")).toBe(issued.startParam);
  await expect(page.locator(".khl-invite bdi")).toHaveText(issued.deepLink);
  expect(forbiddenMutations).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await page.reload();
  await expect(page.locator(".khl-invite")).toHaveCount(0);
});

for (const mode of ["guest", "expired", "forbidden", "unauthenticated"]) {
  test(`${mode} never exposes or shares an invitation`, async ({ page, request }) => {
    const inviteRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().endsWith("/invite")) inviteRequests.push(req.url());
    });
    await fixture(page, request, mode);
    await expect(page.locator(".khl-share:enabled")).toHaveCount(0);
    await expect(page.locator(".khl-start:enabled")).toHaveCount(0);
    await page
      .locator(".khl-share")
      .evaluateAll((buttons) => buttons.forEach((e) => (e as HTMLButtonElement).click()));
    expect(inviteRequests).toEqual([]);
    expect(await nativeCalls(page)).toEqual([]);
    await expect(page.locator(".khl-invite")).toHaveCount(0);
  });
}

test("missing room offers authenticated creation without fabricating a code or creating automatically", async ({
  page,
  request,
}) => {
  await fixture(page, request, "host", 2, false);
  await expect(page.locator(".khl-room-code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /ایجاد اتاق جدید/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /ایجاد اتاق جدید/ })).toBeEnabled();
  await expect(page.locator(".khl-player")).toHaveCount(0);
});

test("mismatched invitation is rejected before any native/browser share", async ({
  page,
  request,
}) => {
  await fixture(page, request);
  await page.route(`**/v1/kahroba/rooms/${roomId}/invite`, async (route) => {
    const original = await route.fetch(),
      body = await original.json();
    body.invite.roomId = "88888888-8888-4888-8888-888888888888";
    await route.fulfill({ response: original, json: body });
  });
  await page.getByRole("button", { name: "اشتراک‌گذاری", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("دعوت معتبری دریافت نشد");
  expect(await nativeCalls(page)).toEqual([]);
  await expect(page.locator(".khl-invite")).toHaveCount(0);
});

test("expired resolution and rapid double taps never deliver stale or duplicate invitations", async ({
  page,
  request,
}) => {
  const token = await fixture(page, request);
  await page.route("**/v1/kahroba/room-invites/resolve", (route) =>
    route.fulfill({
      status: 404,
      json: { ok: false, error: { code: "NOT_FOUND", retryable: false } },
    }),
  );
  await page.getByRole("button", { name: "اشتراک‌گذاری", exact: true }).evaluate((e) => {
    (e as HTMLButtonElement).click();
    (e as HTMLButtonElement).click();
  });
  await expect(page.getByRole("alert")).toContainText("دعوت معتبری دریافت نشد");
  expect(await nativeCalls(page)).toEqual([]);
  const stats = await request.get(`${api}/__preview/lobby-stats`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect((await stats.json()).lobbyInvites).toBe(1);
});

test("four real member records and long names remain bounded, accessible and keyboard operable", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page, request, "full", 4);
  await expect(page.locator(".khl-player:not(.khl-empty-player)")).toHaveCount(4);
  await expect(page.locator(".khl-member-id")).toHaveCount(0);
  await expect(page.locator(".khl-player-info > strong")).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page })
    .include(".khl-lobby")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole("button", { name: "اشتراک‌گذاری", exact: true }).focus();
  await expect(page.getByRole("button", { name: "اشتراک‌گذاری", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await nativeCalls(page)).length).toBe(1);
  await fixture(page, request, "long-name");
  await expect(page.locator(".khl-player-info > strong")).toContainText("نام بسیار بلند");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("browser clipboard fallback copies only the verified server link", async ({
  page,
  request,
}) => {
  await fixture(page, request);
  await page.evaluate(() => {
    delete window.Telegram;
    const copied: string[] = [];
    Object.assign(window, { __lobbyCopied: copied });
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (url: string) => {
          copied.push(url);
        },
      },
    });
  });
  await page.getByRole("button", { name: "اشتراک‌گذاری", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "پیوند دعوت کپی شد" })).toBeVisible();
  const link = await page.locator(".khl-invite bdi").innerText();
  expect(
    await page.evaluate(() => (window as Window & { __lobbyCopied?: string[] }).__lobbyCopied),
  ).toEqual([link]);
  expect(link.startsWith("https://t.me/Hambazidev_bot?startapp=room_")).toBe(true);
});

test("session expiry during invitation acquisition clears sharing and does not leak a link", async ({
  page,
  request,
}) => {
  await fixture(page, request);
  await page.route(`**/v1/kahroba/rooms/${roomId}/invite`, (route) =>
    route.fulfill({
      status: 401,
      json: { ok: false, error: { code: "UNAUTHENTICATED", retryable: false } },
    }),
  );
  await page.getByRole("button", { name: "اشتراک‌گذاری", exact: true }).click();
  await expect(
    page.getByText("برای دریافت اطلاعات اتاق و دعوت، ورود معتبر تلگرام لازم است."),
  ).toBeVisible();
  await expect(page.locator(".khl-start:enabled")).toHaveCount(0);
  await expect(page.locator(".khl-invite")).toHaveCount(0);
  expect(await nativeCalls(page)).toEqual([]);
});

for (const width of [320, 375, 390, 768]) {
  test(`reference composition at ${width}px preserves real three-member data and four slots`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: Math.ceil((width * 1672) / 941) });
    await fixture(page, request, "reference-layout", 4);
    await expect(page.locator(".khl-player:not(.khl-empty-player)")).toHaveCount(3);
    await expect(page.locator(".khl-empty-player")).toHaveCount(1);
    await expect(page.locator(".khl-player-info > strong")).toHaveCount(3);
    await expect(page.locator(".khl-start")).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => document.fonts.ready);
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
      path: resolve(screenshots, `${info.project.name}-reference-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}

for (const width of [320, 390, 768]) {
  test(`approved home composition at ${width}px has artwork and no online statistics`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await fixture(page, request, "host", 2, false);
    await expect(page.getByRole("button", { name: /ایجاد اتاق جدید/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /جستجوی اتاق/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: "اعلان‌ها", exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "پروفایل", exact: true })).toContainText("مهدی");
    await expect(page.getByAltText("کهربا؛ کارت‌ها و سنگ‌های قیمتی")).toBeVisible();
    const hero = page.getByAltText("کهربا؛ کارت‌ها و سنگ‌های قیمتی");
    await expect(hero).toHaveAttribute("src", /\/lobby-hero-[a-f0-9]{12}\.webp$/);
    await hero.evaluate((img) => (img as HTMLImageElement).decode());
    const background = await page
      .locator(".khl-lobby")
      .evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(background).toMatch(/\/lobby-palace-[a-f0-9]{12}\.webp/);
    await page.evaluate(async (css) => {
      const url = css.match(/url\("?([^")]+)"?\)/)?.[1];
      if (!url) throw new Error("LOBBY_BACKGROUND_MISSING");
      const image = new Image();
      image.src = url;
      await image.decode();
    }, background);
    expect(await page.locator(".khl-lobby").innerText()).not.toMatch(
      /بازیکنان آنلاین|آمار نمایشی|اسکن/,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const results = await new AxeBuilder({ page })
      .include(".khl-lobby")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
      path: resolve(screenshots, `${info.project.name}-palace-home-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}
for (const capacity of [2, 3, 4]) {
  test(`creates a real ${capacity}-seat request from the capacity selector`, async ({
    page,
    request,
  }) => {
    await fixture(page, request, "host", 2, false);
    await page.getByRole("button", { name: /ایجاد اتاق جدید/ }).click();
    await expect(page.getByRole("heading", { name: "ایجاد اتاق جدید" })).toBeVisible();
    await page
      .getByRole("button", {
        name: `${new Intl.NumberFormat("fa-IR").format(capacity)} نفره`,
        exact: true,
      })
      .click();
    const submitted = page.waitForRequest(
      (req) => req.url() === api + "/v1/kahroba/rooms" && req.method() === "POST",
    );
    await page.getByRole("button", { name: "ایجاد اتاق", exact: true }).click();
    expect((await submitted).postDataJSON()).toMatchObject({
      schemaVersion: 1,
      gameId: "kahroba",
      capacity,
    });
    await expect(page.locator(".khl-player")).toHaveCount(capacity);
    await expect(page.locator(".khl-player:not(.khl-empty-player)")).toHaveCount(1);
  });
}
test("settings persist only sound/motion preferences and the dialog restores focus", async ({
  page,
  request,
}) => {
  await fixture(page, request, "host", 2, false);
  const trigger = page.getByRole("button", { name: /تنظیمات/ });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "تنظیمات" })).toBeVisible();
  const motion = page.getByRole("switch", { name: "جلوه‌های حرکتی" });
  await expect(motion).toHaveAttribute("aria-checked", "true");
  await motion.click();
  await expect(motion).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.reload();
  await page.getByRole("button", { name: /تنظیمات/ }).click();
  await expect(page.getByRole("switch", { name: "جلوه‌های حرکتی" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([
    "kahroba-lobby-preferences-v1",
  ]);
});

async function simplePageFits(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth <= innerWidth + 1,
        vertical: document.documentElement.scrollHeight <= innerHeight + 1,
      })),
    )
    .toEqual({ horizontal: true, vertical: true });
  for (const button of await page.locator(".khl-lobby button:visible").all())
    await expect(button).toBeInViewport();
}
for (const size of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 720 },
]) {
  test(`simple Kahroba pages fit available space at ${size.width}x${size.height}`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize(size);
    await fixture(page, request, "host", 2, false);
    await page
      .getByAltText("کهربا؛ کارت‌ها و سنگ‌های قیمتی")
      .evaluate((img) => (img as HTMLImageElement).decode());
    await page.evaluate(() => document.fonts.ready);
    await simplePageFits(page);
    await page.screenshot({ path: info.outputPath("home.png") });
    for (const name of ["پروفایل", "اعلان‌ها", "تنظیمات", "راهنمای بازی"]) {
      await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("button", { name: "بستن", exact: true })).toBeInViewport();
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
      ).toBe(true);
      await page.getByRole("button", { name: "بستن", exact: true }).click();
    }
    await page.getByRole("button", { name: /ایجاد اتاق جدید/ }).click();
    await expect(page.locator(".khl-create-form")).toBeVisible();
    await simplePageFits(page);
    await page.screenshot({ path: info.outputPath("create.png") });
    await page.evaluate(() => {
      location.hash = "/restricted/kahroba/search/2";
    });
    await expect(page.getByRole("heading", { name: "جستجوی اتاق", exact: true })).toBeVisible();
    await simplePageFits(page);
    await page.screenshot({ path: info.outputPath("search.png") });
  });
}
test("native insets and additional room content remain accessible", async ({ page, request }) => {
  await fixture(page, request, "host", 4, false);
  await page.evaluate(() => {
    const s = document.documentElement.style;
    s.setProperty("--telegram-top", "103px");
    s.setProperty("--telegram-bottom", "34px");
    s.setProperty("--telegram-left", "12px");
    s.setProperty("--telegram-right", "12px");
  });
  await simplePageFits(page);
  await page.getByRole("button", { name: /ایجاد اتاق جدید/ }).click();
  await simplePageFits(page);
  await page.getByRole("button", { name: "۴ نفره", exact: true }).click();
  await page.getByRole("button", { name: "ایجاد اتاق", exact: true }).click();
  await expect(page.locator(".khl-player")).toHaveCount(4);
  await page.getByRole("button", { name: "اشتراک‌گذاری", exact: true }).click();
  await expect(page.locator(".khl-invite")).toBeVisible();
  await page.locator(".khl-invite").scrollIntoViewIfNeeded();
  await expect(page.locator(".khl-invite")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
test("public waiting room retains all seats and actions", async ({ page, request }, info) => {
  const ids = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  ];
  const token = await fixture(page, request, "host", 4, false);
  const me = await request.get(`${api}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
  ids[0] = (await me.json()).userId;
  await page.route(`**/v1/kahroba/matches/${roomId}/lobby`, (route) =>
    route.fulfill({
      json: {
        ok: true,
        value: {
          schemaVersion: 1,
          matchId: roomId,
          gameId: "kahroba",
          stateVersion: 1,
          status: "WAITING_FOR_PLAYERS",
          hostUserId: ids[0],
          players: ids.map((userId, seat) => ({ userId, seat, ready: false })),
        },
      },
    }),
  );
  await page.route(`**/v1/kahroba/matches/${roomId}/players`, (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        players: ids.map((userId, i) => ({ userId, displayName: `بازیکن ${i + 1}` })),
      },
    }),
  );
  await page.evaluate((id) => {
    location.hash = `/restricted/kahroba/public/${id}`;
  }, roomId);
  await expect(page.locator(".khl-player")).toHaveCount(4);
  await simplePageFits(page);
  await expect(page.getByRole("button", { name: "لغو اتاق", exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath("public-room.png") });
});

test("fitted lobby blocks elastic dragging while long help and overflowing content remain scrollable", async ({
  page,
  request,
}) => {
  await fixture(page, request, "host", 2, false);
  await expect(page.locator("html")).toHaveAttribute("data-fitted-page", "true");
  expect(await verticalDrag(page.locator(".khl-header"))).toBe(true);
  await page.getByRole("button", { name: /راهنمای بازی/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").evaluate((e) => {
    e.style.maxHeight = "180px";
  });
  const dialog = page.getByRole("dialog");
  expect(await verticalDrag(dialog, -60)).toBe(false);
  await dialog.evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  expect(await verticalDrag(dialog, -60)).toBe(true);
  expect(await verticalDrag(dialog, 60)).toBe(false);
  await page.getByRole("button", { name: "بستن", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await verticalDrag(page.locator(".khl-header"))).toBe(true);
  await page.getByRole("button", { name: /ایجاد اتاق جدید/ }).click();
  await expect(page.locator(".khl-create-form")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-fitted-page", "true");
  expect(await verticalDrag(page.locator(".khl-header"))).toBe(true);
  await page.locator(".khl-create-form").evaluate((e) => {
    const extra = document.createElement("p");
    extra.style.height = "900px";
    extra.textContent = "محتوای اضافه";
    e.append(extra);
  });
  await expect(page.locator("html")).not.toHaveAttribute("data-fitted-page", "true");
  expect(await verticalDrag(page.locator(".khl-header"))).toBe(false);
  await page
    .locator(".khl-create-form > p")
    .last()
    .evaluate((e) => e.remove());
  await expect(page.locator("html")).toHaveAttribute("data-fitted-page", "true");
  await page.locator(".kh-app").evaluate((e) => {
    const notice = document.createElement("p");
    notice.style.height = "900px";
    notice.textContent = "پیام اضافه خارج از قاب لابی";
    e.append(notice);
  });
  await expect(page.locator("html")).not.toHaveAttribute("data-fitted-page", "true");
  await page.goto("/");
  await expect(page.getByRole("region", { name: "میز کهربا" })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-fitted-page", "true");
  expect(await verticalDrag(page.locator(".kh-game"))).toBe(false);
});
