import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

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
  test(`premium RTL lobby at ${width}px has real membership and only Share enabled`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: width >= 600 ? 1024 : 844 });
    await fixture(page, request);
    await expect(page.getByRole("button", { name: "اشتراک‌گذاری", exact: true })).toBeEnabled();
    await expect(page.locator(".khl-lobby button:enabled")).toHaveCount(1);
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
    await expect(page.getByRole("button", { name: "اشتراک‌گذاری", exact: true })).toBeDisabled();
    await expect(page.locator(".khl-lobby button:enabled")).toHaveCount(0);
    await page
      .getByRole("button", { name: "اشتراک‌گذاری", exact: true })
      .evaluate((e) => (e as HTMLButtonElement).click());
    expect(inviteRequests).toEqual([]);
    expect(await nativeCalls(page)).toEqual([]);
    await expect(page.locator(".khl-invite")).toHaveCount(0);
  });
}

test("missing room reports the prerequisite and never fabricates a code or creates a room", async ({
  page,
  request,
}) => {
  await fixture(page, request, "host", 2, false);
  await expect(page.locator(".khl-room-code bdi")).toHaveText("هنوز انتخاب نشده");
  await expect(page.getByText(/اتاق معتبری انتخاب نشده/)).toBeVisible();
  await expect(page.locator(".khl-lobby button:enabled")).toHaveCount(0);
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
  await page.keyboard.press("Tab");
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
  await expect(page.locator(".khl-lobby button:enabled")).toHaveCount(0);
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
    await expect(page.locator(".khl-lobby button:enabled")).toHaveCount(1);
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
