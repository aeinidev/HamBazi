import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const csrf = "a".repeat(43),
  password = "SyntheticBrowserPassword123";
async function mock(page: Page, owner = true) {
  await page.addInitScript(() => {
    const state = window as Window & { adminCspViolations: string[] };
    state.adminCspViolations = [];
    window.addEventListener("securitypolicyviolation", (event) =>
      state.adminCspViolations.push(event.violatedDirective),
    );
  });
  const state = {
    signed: false,
    pending: false,
    permissions: owner
      ? [
          "overview.view",
          "users.view",
          "games.view",
          "rooms.view",
          "matches.view",
          "monitoring.view",
          "audit.view",
        ]
      : ["users.view"],
    version: 1,
    failures: 0,
    locked: false,
  };
  await page.route("**/v1/admin/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.slice("/v1/admin/".length);
    const body = req.method() === "POST" ? req.postDataJSON() : null;
    const error = (status = 401) =>
      route.fulfill({
        status,
        json: {
          ok: false,
          error: {
            code: status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN",
            message: "Authentication failed",
            retryable: false,
          },
        },
      });
    const reply = (json: unknown) => route.fulfill({ status: 200, json });
    if (path === "auth/login") {
      if (body.password !== password || state.locked) return error();
      state.pending = owner;
      state.signed = !owner;
      return reply({
        schemaVersion: 1,
        next: owner ? "PIN_REQUIRED" : "SIGNED_IN",
        csrfToken: csrf,
      });
    }
    if (path === "auth/pin") {
      if (!state.pending || state.locked) return error();
      if (body.pin !== "012345") {
        state.failures++;
        state.locked = state.failures >= 3;
        return error();
      }
      state.pending = false;
      state.signed = true;
      return reply({ schemaVersion: 1, next: "SIGNED_IN", csrfToken: csrf });
    }
    if (!state.signed) return error();
    if (path === "me/access")
      return reply({
        schemaVersion: 1,
        isOwner: owner,
        authorizationVersion: state.version,
        policyRevision: 1,
        permissions: state.permissions,
        csrfToken: csrf,
      });
    if (path === "auth/logout" || path === "auth/pin/change" || path === "auth/password/change") {
      state.signed = false;
      return reply({ schemaVersion: 1, ok: true });
    }
    if (path === "overview" || path === "monitoring/summary")
      return reply({
        schemaVersion: 1,
        asOf: "2026-10-25T09:00:00.000Z",
        metrics: [{ key: "matches_active", value: "7", valid: true, source: "matches" }],
      });
    if (path === "audit-events")
      return reply({ schemaVersion: 1, asOf: "2026-10-25T09:00:00.000Z", items: [] });
    return reply({
      schemaVersion: 1,
      asOf: "2026-10-25T09:00:00.000Z",
      items: [
        {
          id: "4c8c326f-b74a-4c76-b102-dc70e591c706",
          label: "<img src=x onerror=alert(1)>",
          status: "ACTIVE",
          gameId: null,
          version: null,
        },
      ],
      nextCursor: null,
    });
  });
  return state;
}
async function login(page: Page) {
  await page.getByLabel("نام کاربری", { exact: true }).fill("synthetic_owner");
  await page.getByLabel("رمز عبور", { exact: true }).fill(password);
  await page.getByRole("button", { name: "ورود به پنل" }).click();
}
test("shared RTL login opens PIN only after a valid owner password; safe dashboard and logout", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/");
  await expect(page.getByLabel("PIN شش‌رقمی", { exact: true })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByLabel("نام کاربری", { exact: true }).fill("synthetic_owner");
  await page.getByLabel("رمز عبور", { exact: true }).fill("IncorrectSyntheticPassword");
  await page.getByRole("button", { name: "ورود به پنل" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("PIN شش‌رقمی", { exact: true })).toHaveCount(0);
  await login(page);
  await expect(page.getByRole("heading", { name: "رمز امنیتی مالک" })).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await page.getByLabel("PIN شش‌رقمی", { exact: true }).fill("012345");
  await page.getByRole("button", { name: "تأیید و ورود" }).click();
  await expect(page.getByText("مالک اصلی · OWNER")).toBeVisible();
  await expect(page.getByText("مسابقات فعال", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as Window & { adminCspViolations: string[] }).adminCspViolations,
    ),
  ).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: "test-results/admin-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "کاربران", exact: true }).click();
  await expect(page.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
  await expect(page.locator("td img")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => Object.keys(localStorage).length + Object.keys(sessionStorage).length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "خروج امن" }).click();
  await expect(page.getByRole("heading", { name: "به هم‌بازی خوش آمدید" })).toBeVisible();
});
test("ordinary admin enters directly and revoked permissions disappear within five seconds", async ({
  page,
}) => {
  const state = await mock(page, false);
  await page.goto("/");
  await login(page);
  await expect(page.getByText("مدیر پلتفرم", { exact: true })).toBeVisible();
  await expect(page.getByLabel("PIN شش‌رقمی", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "اتاق‌ها", exact: true })).toHaveCount(0);
  state.permissions = [];
  state.version++;
  await expect(page.getByText("بخشی برای این حساب فعال نشده است.")).toBeVisible({ timeout: 6000 });
  await expect(page.getByText("<img src=x onerror=alert(1)>")).toHaveCount(0);
});
test("mobile login is accessible, has no public recovery/signup, and never overflows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "به هم‌بازی خوش آمدید" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("link")).toHaveCount(0);
  await page.screenshot({ path: "test-results/admin-mobile.png", fullPage: true });
});
test("three owner PIN failures remain locked and password retry does not reopen PIN", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/");
  await login(page);
  for (let n = 0; n < 3; n++) {
    await page.getByLabel("PIN شش‌رقمی", { exact: true }).fill("999999");
    await page.getByRole("button", { name: "تأیید و ورود" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
  }
  await page.getByRole("button", { name: "بازگشت به ورود" }).click();
  await login(page);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("PIN شش‌رقمی", { exact: true })).toHaveCount(0);
});
for (const kind of ["password", "pin"] as const) {
  test(`OWNER ${kind} change confirms input, clears credentials and returns to login`, async ({
    page,
  }) => {
    const state = await mock(page);
    await page.goto("/");
    await login(page);
    await page.getByLabel("PIN شش‌رقمی", { exact: true }).fill("012345");
    await page.getByRole("button", { name: "تأیید و ورود", exact: true }).click();
    await page.getByRole("button", { name: "امنیت حساب مالک", exact: true }).click();
    if (kind === "pin") await page.getByRole("button", { name: "تغییر PIN", exact: true }).click();
    await page.getByLabel("رمز عبور فعلی", { exact: true }).fill(password);
    await page.getByLabel("PIN فعلی", { exact: true }).fill("012345");
    const label = kind === "pin" ? "PIN جدید" : "رمز عبور جدید",
      next = kind === "pin" ? "654321" : "SyntheticBrowserReplacement456";
    await page.getByLabel(label, { exact: true }).fill(next);
    await page
      .getByLabel("تکرار " + label, { exact: true })
      .fill(kind === "pin" ? "123456" : "MismatchedSyntheticPassword");
    await page.getByRole("button", { name: "تأیید تغییر و بستن نشست‌ها" }).click();
    await expect(page.getByRole("alert")).toHaveText("مقدار جدید و تکرار آن یکسان نیستند.");
    expect(state.signed).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByLabel("تکرار " + label, { exact: true }).fill(next);
    const submitted = page.waitForRequest((r) => r.url().endsWith(`/auth/${kind}/change`));
    await page.getByRole("button", { name: "تأیید تغییر و بستن نشست‌ها" }).click();
    expect((await submitted).postDataJSON()[kind === "pin" ? "newPin" : "newPassword"]).toBe(next);
    await expect(page.getByRole("heading", { name: "به هم‌بازی خوش آمدید" })).toBeVisible();
    expect(state.signed).toBe(false);
    await expect(page.getByLabel("رمز عبور", { exact: true })).toHaveValue("");
    expect(
      await page.evaluate(
        () => Object.keys(localStorage).length + Object.keys(sessionStorage).length,
      ),
    ).toBe(0);
  });
}
