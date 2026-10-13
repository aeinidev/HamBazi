import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const origin = "http://127.0.0.1:4184";
let credential = "";
async function fixture(page: Page, request: APIRequestContext, name = "initial", capacity = 4) {
  const response = await request.post(
    `${origin}/v1/auth/telegram-mini-app/registered-session-photo`,
    { data: {} },
  );
  credential = (await response.json()).accessToken;
  await request.post(`${origin}/__preview/case`, {
    headers: { authorization: `Bearer ${credential}` },
    data: { case: name, capacity },
  });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "میز کهربا" })).toBeVisible();
  if (name !== "failure") await expect(page.locator(".kh-market-cards")).toHaveCount(3);
}
async function control(request: APIRequestContext, path: string) {
  return request.post(`${origin}/__preview/${path}`, {
    headers: { authorization: `Bearer ${credential}` },
    data: {},
  });
}
async function stats(request: APIRequestContext) {
  return (
    await request.get(`${origin}/__preview/stats`, {
      headers: { authorization: `Bearer ${credential}` },
    })
  ).json() as Promise<{
    commands: { actionId: string; expectedVersion: number; type: string }[];
    version: number;
    seq: number;
  }>;
}
async function screenshot(page: Page, name: string, project: string) {
  const directory = resolve("../../test-results/kahroba-k3/screenshots");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: resolve(directory, `${project}-${name}.png`),
    fullPage: (await page.getByRole("dialog").count()) === 0,
    animations: "disabled",
  });
}
for (const [width, height] of [
  [320, 568],
  [375, 667],
  [390, 844],
  [360, 740],
  [768, 1024],
]) {
  test(`table composition, costs, RTL and safe area at ${width}x${height}`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width: width!, height: height! });
    await fixture(page, request, "affordable");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--telegram-top", "18px");
      document.documentElement.style.setProperty("--telegram-bottom", "24px");
    });
    await expect(page.locator(".kh-market-cards .kh-card")).toHaveCount(12);
    expect(await page.locator(".kh-game").evaluate((e) => getComputedStyle(e).direction)).toBe(
      "rtl",
    );
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    for (const row of await page.locator(".kh-market-cards").all()) {
      const bounds = await row.locator(".kh-card").evaluateAll((es) =>
        es.map((e) => ({
          x: e.getBoundingClientRect().x,
          y: e.getBoundingClientRect().y,
          w: e.getBoundingClientRect().width,
          h: e.getBoundingClientRect().height,
        })),
      );
      expect(bounds).toHaveLength(4);
      expect(new Set(bounds.map((b) => Math.round(b.y))).size).toBe(1);
      expect(bounds.every((b) => b.w >= 44 && b.h >= 44)).toBe(true);
    }
    for (const n of await page.locator(".kh-card .kh-num").all()) {
      expect(await n.innerText()).toMatch(/^[0-9]+$/);
      expect(
        await n.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
      ).toBeGreaterThanOrEqual(13);
    }
    await expect(page.getByText("Match session", { exact: true })).toHaveCount(0);
    await expect(page.locator(".kh-username")).toHaveText("mehdi");
    const assistantCard = await page.locator(".kh-assistant .kh-card").boundingBox();
    expect(assistantCard!.width).toBeGreaterThanOrEqual(width! >= 600 ? 100 : 60);
    await expect(page.locator(".kh-noble-cost .kh-bonus")).not.toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.fonts.check("16px Vazirmatn"))).toBe(true);
    await expect
      .poll(() =>
        page
          .locator(".kh-game img")
          .evaluateAll((images) =>
            images.every(
              (image) =>
                image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await screenshot(page, `affordable-${width}x${height}`, info.project.name);
    await page.locator(".kh-market-cards .kh-card").first().tap();
    await expect(page.getByRole("dialog", { name: "جزئیات کارت" })).toBeVisible();
    await page.getByRole("button", { name: "بستن", exact: true }).click();
  });
}
for (const capacity of [2, 3]) {
  test(`${capacity} players render the correct opponent and noble counts`, async ({
    page,
    request,
  }) => {
    await fixture(page, request, "initial", capacity);
    await expect(page.locator(".kh-players article")).toHaveCount(capacity - 1);
    await expect(page.locator(".kh-nobles .kh-noble")).toHaveCount(capacity + 1);
    await expect(page.locator(".kh-market-cards .kh-card")).toHaveCount(12);
  });
}
for (const [width, height] of [
  [320, 568],
  [375, 667],
  [390, 844],
])
  test(`card details and explicit colored/gold payment at ${width}x${height}`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width: width!, height: height! });
    await fixture(page, request, "affordable");
    await page.getByRole("button", { name: "کارت قابل خرید بعدی" }).click();
    await page.getByRole("button", { name: "کارت قابل خرید قبلی" }).click();
    await page.getByRole("button", { name: "✓ انتخاب خرید" }).click();
    await page.getByRole("button", { name: "خرید این کارت", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "تأیید خرید کارت" })).toBeVisible();
    const fields = page.getByRole("spinbutton");
    await expect(fields).toHaveCount(6);
    const colored = page.getByRole("spinbutton", {
      name: /^پرداخت (الماس|یاقوت آبی|زمرد|یاقوت سرخ|اونیکس)$/,
    });
    for (const input of await colored.all()) {
      const value = Number(await input.inputValue());
      if (value > 0) {
        await input.fill(String(value - 1));
        const gold = page.getByRole("spinbutton", { name: "پرداخت طلا" });
        await gold.fill(String(Number(await gold.inputValue()) + 1));
        break;
      }
    }
    await expect(page.getByRole("button", { name: "تأیید اقدام" })).toBeEnabled();
    await screenshot(page, `payment-sheet-${width}`, info.project.name);
    await page.getByRole("button", { name: "تأیید اقدام" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(async () => (await stats(request)).commands.at(-1)?.type).toBe("BUY_CARD");
    await expect(page.locator(".kh-self-status")).toHaveText("نوبت حریف");
  });
test("token selection is provisional and exact returns complete one atomic turn", async ({
  page,
  request,
}, info) => {
  await fixture(page, request, "returns");
  const before = await stats(request);
  await page.getByRole("button", { name: "گرفتن ژتون", exact: true }).click();
  await page.locator(".kh-collection-choice").first().click();
  expect((await stats(request)).version).toBe(before.version);
  await page.getByRole("button", { name: "ادامه و تأیید ژتون‌ها" }).click();
  await expect(page.getByRole("heading", { name: /بازگرداندن/ })).toBeVisible();
  await screenshot(page, "return-sheet", info.project.name);
  const returnInputs = page.getByRole("spinbutton");
  const firstValue = Number(await returnInputs.first().inputValue());
  await returnInputs.first().fill("0");
  if (firstValue > 0)
    await expect(page.getByRole("button", { name: "تأیید اقدام" })).toBeDisabled();
  await returnInputs.first().fill(String(firstValue));
  await page.getByRole("button", { name: "تأیید اقدام" }).click();
  await expect.poll(async () => (await stats(request)).version).toBe(before.version + 1);
  expect((await stats(request)).commands).toHaveLength(1);
});
test("face-up and blind reservations reveal only the owner private hand", async ({
  page,
  request,
}) => {
  await fixture(page, request);
  await page.locator(".kh-market-cards .kh-card").first().click();
  await page.getByRole("button", { name: "رزرو این کارت" }).click();
  await page.getByRole("button", { name: "تأیید اقدام" }).click();
  await page.getByRole("button", { name: /کارت‌های رزرو/ }).click();
  await expect(
    page.getByRole("dialog", { name: "کارت‌های رزرو شما" }).locator(".kh-card"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "بستن", exact: true }).click();
  await fixture(page, request);
  await page.getByRole("button", { name: "رزرو کارت", exact: true }).click();
  await page.locator(".kh-decks .kh-cardback").first().click();
  await page.getByRole("button", { name: "تأیید اقدام" }).click();
  await expect.poll(async () => (await stats(request)).commands.at(-1)?.type).toBe("RESERVE_CARD");
  await fixture(page, request, "spectator");
  await expect(page.getByRole("button", { name: /کارت‌های رزرو/ })).toHaveCount(0);
  await expect(page.locator(".kh-actionbar")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toMatch(/kahroba-card-/);
});
test("multiple noble eligibility requires an explicit choice", async ({ page, request }, info) => {
  await fixture(page, request, "nobles");
  await page.getByRole("button", { name: "گرفتن ژتون", exact: true }).click();
  await page.locator(".kh-collection-choice").first().click();
  await page.getByRole("button", { name: "ادامه و تأیید ژتون‌ها" }).click();
  await expect(page.getByRole("heading", { name: "انتخاب اشراف" })).toBeVisible();
  await expect(page.getByRole("button", { name: "تأیید اقدام" })).toBeDisabled();
  await page.getByRole("radio").first().check();
  await screenshot(page, "noble-choice", info.project.name);
  await page.getByRole("button", { name: "تأیید اقدام" }).click();
  await expect.poll(async () => (await stats(request)).commands).toHaveLength(1);
});
test("an ambiguous command retry retains its action identity and version", async ({
  page,
  request,
}) => {
  await fixture(page, request);
  await control(request, "ambiguous");
  await page.getByRole("button", { name: "رزرو کارت", exact: true }).click();
  await page.locator(".kh-decks .kh-cardback").first().click();
  await page.getByRole("button", { name: "تأیید اقدام" }).click();
  await expect(page.getByRole("button", { name: "تلاش دوباره" })).toBeVisible();
  const first = await stats(request);
  await page.getByRole("button", { name: "تلاش دوباره" }).click();
  await expect.poll(async () => (await stats(request)).commands.length).toBe(2);
  const final = await stats(request);
  expect(final.commands[0]!.actionId).toBe(final.commands[1]!.actionId);
  expect(final.commands[0]!.expectedVersion).toBe(final.commands[1]!.expectedVersion);
  expect(final.version).toBe(first.version);
});
test("disconnect discards private controls and resync restores the authoritative view", async ({
  page,
  request,
}) => {
  await fixture(page, request, "reserved");
  await control(request, "disconnect");
  await expect
    .poll(async () => page.locator(".kh-market-cards").count(), { timeout: 3000 })
    .toBe(0);
  await expect(page.getByText("در حال اتصال و همگام‌سازی…", { exact: false })).toBeVisible();
  await expect(page.locator(".kh-market-cards")).toHaveCount(3, { timeout: 10000 });
  await page.getByRole("button", { name: /کارت‌های رزرو/ }).click();
  await expect(page.getByRole("dialog").locator(".kh-card")).toHaveCount(1);
});
for (const name of ["sole", "shared"])
  test(`${name} result retains rank, prestige and every winner`, async ({
    page,
    request,
  }, info) => {
    await fixture(page, request, name);
    const sheet = page.getByRole("dialog", {
      name: name === "shared" ? "پیروزی مشترک" : "نتیجهٔ کهربا",
    });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator("tbody tr.winner")).toHaveCount(name === "shared" ? 2 : 1);
    await expect(sheet.getByRole("columnheader", { name: "کارت خریداری‌شده" })).toBeVisible();
    await screenshot(page, `${name}-victory`, info.project.name);
  });
test("opponent, insufficient, depleted, malformed and keyboard/reduced-motion/text states", async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page, request, "opponent");
  for (const button of await page.locator(".kh-actionbar button").all())
    await expect(button).toBeDisabled();
  await fixture(page, request, "initial");
  await expect(page.getByRole("button", { name: "خرید کارت", exact: true })).toBeDisabled();
  await page.locator(".kh-market-cards .kh-card").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Tab");
  expect(await page.getByRole("dialog").evaluate((el) => el.contains(document.activeElement))).toBe(
    true,
  );
  expect(await page.locator(".kh-sheet").evaluate((e) => getComputedStyle(e).animationName)).toBe(
    "none",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => (document.documentElement.style.fontSize = "32px"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await screenshot(page, "enlarged-text-320", info.project.name);
  await page.locator(".kh-market-cards .kh-card").first().tap();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole("button", { name: "بستن", exact: true }).click();
  await fixture(page, request, "empty");
  await expect(page.locator(".kh-empty")).toHaveCount(4);
  await fixture(page, request, "failure");
  await expect(page.getByRole("alert")).toContainText("سازگار نیست");
  await expect(page.locator(".kh-actionbar")).toHaveCount(0);
});
test("accessibility and touch targets", async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await fixture(page, request, "affordable");
  const results = await new AxeBuilder({ page }).include(".kh-game").analyze();
  expect(results.violations).toEqual([]);
  await page.locator(".kh-market-cards .kh-card").first().tap();
  await expect(page.getByRole("dialog")).toBeVisible();
});
