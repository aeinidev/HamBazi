import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

test("phase two real Backend: OWNER login, pending isolation, one-time manager credential and session rotation", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60000);
  test.skip(
    !process.env.TEST_ADMIN_REAL_URL,
    "Only the owned disposable Backend harness may enable this test",
  );
  const origin = process.env.TEST_ADMIN_REAL_URL!;
  if (!/^https:\/\/127\.0\.0\.1:[0-9]+$/.test(origin)) throw new Error("LOCAL_BACKEND_REQUIRED");
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.route(origin + "/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/v1/admin/")) return route.continue();
    if (path !== "/" && !/^\/assets\/[A-Za-z0-9_.-]+$/.test(path)) return route.abort();
    return route.fulfill({
      status: 200,
      contentType:
        path === "/" ? "text/html" : path.endsWith(".css") ? "text/css" : "application/javascript",
      body: await readFile(
        new URL(
          "../../dist/client/" + (path === "/" ? "index.html" : path.slice(1)),
          import.meta.url,
        ),
      ),
    });
  });
  try {
    await page.goto(origin);
    await page.getByLabel("نام کاربری", { exact: true }).fill("phase_two_owner");
    await page.getByLabel("رمز عبور", { exact: true }).fill("PhaseTwoSyntheticPassword123");
    await page.getByRole("button", { name: "ورود به پنل", exact: true }).click();
    await expect(page.getByRole("heading", { name: "رمز امنیتی مالک", exact: true })).toBeVisible();
    expect((await context.request.get(origin + "/v1/admin/admins")).status()).toBe(401);
    await page.getByLabel("PIN شش‌رقمی", { exact: true }).fill("012345");
    await page.getByRole("button", { name: "تأیید و ورود", exact: true }).click();
    await page.getByRole("button", { name: "مدیران و نقش‌ها", exact: true }).click();
    expect(
      (
        await context.request.post(origin + "/v1/admin/operations", {
          headers: { origin },
          data: { schemaVersion: 1 },
        })
      ).status(),
    ).toBe(403);
    await page.getByLabel("نام کاربری مدیر جدید", { exact: true }).fill("browser_phase_two");
    await page.getByRole("button", { name: "ساخت مدیر با رمز تصادفی", exact: true }).click();
    await page.getByRole("button", { name: "ثبت درخواست تأیید", exact: true }).click();
    await page.getByLabel("رمز عبور فعلی", { exact: true }).fill("PhaseTwoSyntheticPassword123");
    await page.getByLabel("PIN فعلی", { exact: true }).fill("012345");
    await page.getByRole("checkbox").check();
    const oldCookie = (await context.cookies()).find(
      (c) => c.name === "__Host-hambazi-admin",
    )!.value;
    await page.getByRole("button", { name: "تأیید همین عملیات", exact: true }).click();
    await page.getByRole("button", { name: "اجرای همین درخواست", exact: true }).click();
    await expect(page.locator("output")).toHaveText(
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])[A-Za-z0-9]{12}$/,
    );
    const newCookie = (await context.cookies()).find(
      (c) => c.name === "__Host-hambazi-admin",
    )!.value;
    expect(newCookie).not.toBe(oldCookie);
    expect(
      (
        await context.request.get(origin + "/v1/admin/me/access", {
          headers: { cookie: "__Host-hambazi-admin=" + oldCookie },
        })
      ).status(),
    ).toBe(401);
    await page.getByRole("button", { name: "رمز را نگه‌داشتم؛ پنهان کن", exact: true }).click();
    await expect(page.locator("output")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
    await page.getByRole("button", { name: "بستن و تازه‌کردن فهرست", exact: true }).click();
    await page.getByRole("button", { name: "نقش سفارشی جدید", exact: true }).click();
    await page.getByLabel("نام نقش", { exact: true }).fill("Browser scoped role");
    await page.getByLabel("مجوز rooms.view قید 1", { exact: true }).selectOption("allow");
    const scope = page
      .locator("fieldset")
      .filter({ has: page.locator("legend bdi", { hasText: /^rooms\.view$/ }) })
      .last();
    await scope
      .getByRole("button", { name: "افزودن قید منع دیگر؛ محدوده را مشخص کنید", exact: true })
      .click();
    await scope.getByLabel("بازی‌ها؛ خالی یعنی همه", { exact: true }).nth(1).fill("kahroba");
    await page.getByRole("button", { name: "بازبینی تغییر دسترسی", exact: true }).click();
    await expect(page.getByText("نام نقش: Browser scoped role", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "ثبت درخواست تأیید", exact: true }).click();
    await page.getByLabel("رمز عبور فعلی", { exact: true }).fill("PhaseTwoSyntheticPassword123");
    await page.getByLabel("PIN فعلی", { exact: true }).fill("012345");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "تأیید همین عملیات", exact: true }).click();
    await page.getByRole("button", { name: "اجرای همین درخواست", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^انجام شد$/ })).toBeVisible();
    const directory = await (await context.request.get(origin + "/v1/admin/admins")).json();
    expect(
      directory.roles.find((r: { name: string }) => r.name === "Browser scoped role").grants,
    ).toEqual([
      { permission: "rooms.view", environment: "test", gameIds: null, deny: false },
      { permission: "rooms.view", environment: "test", gameIds: ["kahroba"], deny: true },
    ]);
    await page.getByRole("button", { name: "بستن و تازه‌کردن فهرست", exact: true }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Browser scoped role" }),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("phase2-directory-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath("phase2-directory-mobile.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
