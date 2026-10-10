import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { setup, launch, nativeEvent, matchId } from "./fixture.js";
const views = JSON.parse(
  readFileSync(new URL("./anarchist-views.json", import.meta.url), "utf8"),
) as Record<string, Record<string, unknown>>;
async function table(
  page: Parameters<typeof launch>[0],
  request: Parameters<typeof setup>[1],
  count = 2,
  coins = 5,
) {
  const state = await setup(page, request);
  state.current = matchId;
  state.customView = structuredClone(views[`${count}-${coins}`]!);
  state.customView.deadlineAt = Date.now() + 30000;
  await launch(page, "/games/coup/play");
  await expect(page.getByLabel("میز کودتا")).toBeVisible();
  return state;
}
for (const count of [2, 3, 4, 5, 6])
  test(`responsive actual public ${count}-seat projection, supplied art and safe controls`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await table(page, request, count);
    await nativeEvent(page, "safe_area_changed", { top: 47, bottom: 34, left: 0, right: 0 });
    await nativeEvent(page, "content_safe_area_changed", { top: 56, bottom: 0, left: 0, right: 0 });
    await nativeEvent(page, "viewport_changed", {
      height: 667,
      is_state_stable: true,
      is_expanded: true,
    });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".table-seat")).toHaveCount(count - 1);
    await expect(page.locator(".local-influences .influence-card")).toHaveCount(2);
    await expect(page.locator(".local-coins")).toHaveCount(1);
    if (count >= 5) {
      await expect(page.locator(".opponents-top .table-seat")).toHaveCount(count - 3);
      await expect(page.locator(".with-sides .table-seat")).toHaveCount(2);
    }
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      width: innerWidth,
      bottom: document.querySelector(".more-actions")!.getBoundingClientRect().bottom,
      limit: innerHeight - 34,
      fonts: [...document.fonts].some(
        (f) => f.family === "HamBazi Display" && f.status === "loaded",
      ),
      cards: [...document.querySelectorAll<HTMLImageElement>(".local-influences img")].every(
        (i) => i.complete && i.naturalWidth > 0,
      ),
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width);
    expect(metrics.bottom).toBeLessThanOrEqual(metrics.limit);
    expect(metrics.fonts && metrics.cards).toBe(true);
    const a = await page.locator(".anarchist-shortcut").boundingBox(),
      b = await page.locator(".local-influences .influence-card").first().boundingBox();
    expect(a!.height / b!.height).toBeCloseTo(0.6, 1);
    await page.screenshot({ path: info.outputPath(`table-${count}.png`), fullPage: true });
  });
test("small 320x568 viewport keeps primary and secondary action access above safe bottom", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await table(page, request, 6);
  await nativeEvent(page, "safe_area_changed", { top: 20, bottom: 25, left: 0, right: 0 });
  const box = await page.locator(".more-actions").boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(543);
  await page.getByRole("button", { name: /سایر اقدام‌ها/ }).click();
  await expect(page.getByRole("dialog", { name: "سایر اقدام‌ها" })).toBeVisible();
  for (const text of ["سرقت", "آدمکشی", "تعویض"])
    await expect(
      page.getByRole("dialog").getByRole("button", { name: new RegExp("^" + text) }),
    ).toBeEnabled();
});
for (const coins of [4, 5, 7, 10])
  test(`Anarchist and Coup affordability/legality at ${coins} coins`, async ({ page, request }) => {
    await table(page, request, 2, coins);
    const a = page.getByRole("button", { name: "آنارشیست، پرداخت ۵ سکه" }),
      coup = page.getByRole("button", { name: /^کودتا/ });
    if (coins >= 5 && coins < 10) await expect(a).toBeEnabled();
    else await expect(a).toBeDisabled();
    if (coins >= 7) await expect(coup).toBeEnabled();
    else await expect(coup).toBeDisabled();
    await expect(page.locator(".shared-anarchist")).toHaveClass(
      coins < 5 ? /locked/ : /affordable/,
    );
  });
test("target confirmation uses exact legal server command, preserves one pending request, and repeat tap is bounded", async ({
  page,
  request,
}) => {
  const state = await table(page, request, 6, 5);
  state.enforceSinglePending = true;
  await page.getByRole("button", { name: "آنارشیست، پرداخت ۵ سکه" }).click();
  const dialog = page.getByRole("dialog", { name: "انتخاب هدف آنارشیست" });
  await expect(dialog.getByRole("button", { name: "تأیید هدف و اقدام" })).toBeDisabled();
  await dialog.getByRole("button", { name: "بازیکن ۳", exact: true }).click();
  await dialog
    .getByRole("button", { name: "تأیید هدف و اقدام" })
    .evaluate((b: HTMLButtonElement) => {
      b.click();
      b.click();
    });
  await expect.poll(() => state.sentCommands.length).toBe(1);
  expect(state.sentCommands[0]!.command).toEqual({
    type: "DECLARE_ANARCHIST",
    targetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  });
  expect(state.maximumPending).toBe(1);
  expect(state.rateRejections).toBe(0);
});
test("private role details have exact Persian labels and internal scroll", async ({
  page,
  request,
}) => {
  await table(page, request);
  const detail = page.locator(".card-detail").first();
  const label = await detail.getAttribute("aria-label");
  await detail.click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName(label!);
  await expect(page.getByRole("dialog").locator("img")).toHaveCount(1);
  await page.getByRole("button", { name: "بستن پنجره" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("actual deadline counts down without changing on poll or role-detail navigation", async ({
  page,
  request,
}) => {
  const state = await table(page, request);
  const deadline = Number(state.customView!.deadlineAt);
  await page.waitForTimeout(1100);
  const before = await page.getByRole("timer").innerText();
  await page.locator(".card-detail").first().click();
  await page.getByRole("button", { name: "بستن پنجره" }).click();
  expect(Number(state.customView!.deadlineAt)).toBe(deadline);
  expect((await page.getByRole("timer").innerText()).slice(0, 2)).toBe(before.slice(0, 2));
});
test("legitimate public defense reveals only Contessa for two seconds and repeated snapshot does not restart", async ({
  page,
  request,
}) => {
  const state = await setup(page, request);
  state.current = matchId;
  state.customView = structuredClone(views["2-5"]!);
  state.customView.deadlineAt = Date.now() + 30000;
  state.customView.lastDefense = {
    revision: 1,
    occurredAt: Date.now(),
    targetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0",
  };
  await launch(page, "/games/coup/play");
  await expect(page.locator(".defense-reveal")).toBeVisible();
  await expect(page.locator(".defense-reveal")).toContainText("دفاع شاه‌دخت");
  await expect(page.locator(".defense-reveal")).toHaveCount(0, { timeout: 3500 });
  await page.waitForTimeout(2100);
  await expect(page.locator(".defense-reveal")).toHaveCount(0);
});

test("long public Persian names remain bounded and affordable shared action stays disabled on another turn", async ({
  page,
  request,
}) => {
  const state = await setup(page, request);
  state.current = matchId;
  state.customView = structuredClone(views["6-7"]!);
  const players = state.customView.players as { id: string; displayName?: string }[];
  for (const p of players) p.displayName = "بازیکن آزمایشی با نام فارسی بسیار طولانی";
  state.customView.turnPlayerId = players[1]!.id;
  state.customView.legalCommands = [];
  state.customView.deadlineAt = Date.now() + 30000;
  await page.setViewportSize({ width: 320, height: 568 });
  await launch(page, "/games/coup/play");
  await expect(page.getByLabel("میز کودتا")).toBeVisible();
  await expect(page.getByRole("button", { name: "آنارشیست، پرداخت ۵ سکه" })).toBeDisabled();
  await expect(page.locator(".shared-anarchist")).toHaveClass(/affordable/);
  const bounded = await page
    .locator(".seat-name")
    .evaluateAll((elements) =>
      elements.every(
        (e) =>
          e.getBoundingClientRect().width <= 88 && getComputedStyle(e).textOverflow === "ellipsis",
      ),
    );
  expect(bounded).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
