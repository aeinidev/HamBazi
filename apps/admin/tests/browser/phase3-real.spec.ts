import { test, expect, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
test("phase three real users: search, confidential restriction, approval, revocation and safe UI", async ({
  browser,
}, testInfo) => {
  test.setTimeout(100000);
  test.skip(
    !process.env.TEST_ADMIN_PHASE3_URL,
    "Only the owned disposable Backend harness may enable this test",
  );
  const origin = process.env.TEST_ADMIN_PHASE3_URL!;
  if (!/^https:\/\/127\.0\.0\.1:[0-9]+$/.test(origin)) throw new Error("LOCAL_BACKEND_REQUIRED");
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  let detailReads = 0;
  const serve = async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (/\/users\/[a-f0-9-]+\/(profile|history|restrictions)$/.test(path)) detailReads++;
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
  };
  await context.route(origin + "/**", serve);
  const ordinaryContext = await browser.newContext({ ignoreHTTPSErrors: true });
  await ordinaryContext.route(origin + "/**", serve);

  const password = process.env.TEST_ADMIN_PHASE3_PASSWORD!,
    pin = process.env.TEST_ADMIN_PHASE3_PIN!;
  async function approve(onSuccess?: () => Promise<void>) {
    await page.getByRole("button", { name: "ثبت درخواست تأیید", exact: true }).click();
    await page.getByLabel("رمز عبور فعلی", { exact: true }).fill(password);
    await page.getByLabel("PIN فعلی", { exact: true }).fill(pin);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "تأیید همین عملیات", exact: true }).click();
    await page.getByRole("button", { name: "اجرای همین درخواست", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^انجام شد$/ })).toBeVisible();
    await onSuccess?.();
    await page.getByRole("button", { name: "بستن و تازه‌کردن فهرست", exact: true }).click();
  }
  try {
    await page.goto(origin);
    await page
      .getByLabel("نام کاربری", { exact: true })
      .fill(process.env.TEST_ADMIN_PHASE3_USERNAME!);
    await page.getByLabel("رمز عبور", { exact: true }).fill(password);
    await page.getByRole("button", { name: "ورود به پنل", exact: true }).click();
    expect((await context.request.get(origin + "/v1/admin/users")).status()).toBe(401);
    await page.getByLabel("PIN شش‌رقمی", { exact: true }).fill(pin);
    await page.getByRole("button", { name: "تأیید و ورود", exact: true }).click();
    await page.getByRole("button", { name: "کاربران", exact: true }).click();
    await page.getByLabel("جستجوی کاربر", { exact: true }).fill("phase_three_user");
    await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
    const row = page.locator("tbody tr");
    await expect(row).toHaveCount(1);
    await row.getByRole("button").click();
    await expect(page.getByRole("heading", { name: "پروفایل کاربر", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "سوابق بازی", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "تاریخچهٔ محرومیت", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("combobox", { name: "مدت محرومیت", exact: true })).toBeVisible();
    const loadedReads = detailReads;
    await page.waitForResponse(
      (r) => r.url().endsWith("/v1/admin/me/access") && r.status() === 200,
    );
    expect(detailReads).toBe(loadedReads);
    await page.getByLabel("نام نمایشی جدید", { exact: true }).fill("نام آزمایشی مرورگر");
    await page.getByRole("button", { name: "بازبینی اصلاح نام", exact: true }).click();
    await approve();
    await expect(page.getByText("نام نمایشی: نام آزمایشی مرورگر", { exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "مدت محرومیت", exact: true })).toBeVisible();
    const options = await page
      .getByRole("combobox", { name: "مدت محرومیت", exact: true })
      .locator("option")
      .allTextContents();
    expect(options).toEqual(["۱ ساعت", "۲۴ ساعت", "۷ روز", "۳۰ روز", "دائم"]);
    await page.getByRole("combobox", { name: "مدت محرومیت", exact: true }).selectOption("HOURS_24");
    await page.getByRole("button", { name: "پیش‌نمایش محرومیت", exact: true }).click();
    await page.getByRole("combobox", { name: "دلیل عملیات", exact: true }).selectOption("SPAM");
    const note = "توضیح محرمانهٔ مرورگر";
    await page.getByLabel("توضیح محرمانه (اختیاری)", { exact: false }).fill(note);
    await approve();
    await expect(
      page.getByRole("button", { name: "پیش‌نمایش رفع محرومیت", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(note, { exact: true })).toHaveCount(0);
    await page
      .getByRole("button", { name: "مشاهدهٔ ثبت‌شوندهٔ توضیح محرمانه", exact: true })
      .click();
    await expect(page.getByText(note, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "بستن توضیح محرمانه", exact: true }).click();
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
    await page.getByRole("button", { name: "پیش‌نمایش رفع محرومیت", exact: true }).click();
    const liftNote = "رفع محدودیت پس از بررسی آزمایشی";
    await page.getByLabel("توضیح محرمانه (اختیاری)", { exact: false }).fill(liftNote);
    await approve();
    await expect(page.getByText(/پایان اعمال‌شده:/)).toBeVisible();
    await page
      .getByRole("button", { name: "مشاهدهٔ ثبت‌شوندهٔ توضیح رفع محرومیت", exact: true })
      .click();
    await expect(page.getByText(liftNote, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "بستن توضیح محرمانه", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "پیش‌نمایش محرومیت", exact: true }),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("phase3-users-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
    ).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("phase3-users-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "مدیران و نقش‌ها", exact: true }).click();
    await page.getByLabel("نام کاربری مدیر جدید", { exact: true }).fill("browser_phase_three_temp");
    await page.getByRole("button", { name: "ساخت مدیر با رمز تصادفی", exact: true }).click();
    let ordinaryPassword = "";
    await approve(async () => {
      ordinaryPassword = (await page.locator("output").textContent())!;
    });
    const manager = page
      .getByRole("listitem")
      .filter({ has: page.locator("bdi", { hasText: /^browser_phase_three_temp$/ }) });
    await manager.getByRole("button", { name: "ویرایش دسترسی", exact: true }).click();
    await page.getByLabel("مجوز users.view قید 1", { exact: true }).selectOption("allow");
    await page.getByRole("button", { name: "بازبینی تغییر دسترسی", exact: true }).click();
    await approve();
    const ordinary = await ordinaryContext.newPage();
    await ordinary.goto(origin);
    await ordinary.getByLabel("نام کاربری", { exact: true }).fill("browser_phase_three_temp");
    await ordinary.getByLabel("رمز عبور", { exact: true }).fill(ordinaryPassword);
    await ordinary.getByRole("button", { name: "ورود به پنل", exact: true }).click();
    ordinaryPassword = "";
    await expect(ordinary.getByText("مدیر پلتفرم", { exact: true })).toBeVisible();
    await expect(ordinary.getByLabel("PIN شش‌رقمی", { exact: true })).toHaveCount(0);
    expect((await ordinaryContext.request.get(origin + "/v1/admin/users")).status()).toBe(200);
    expect((await ordinaryContext.request.get(origin + "/v1/admin/admins")).status()).toBe(403);
    await manager.getByRole("button", { name: "ابطال نشست‌های مدیر", exact: true }).click();
    await approve();
    expect((await ordinaryContext.request.get(origin + "/v1/admin/users")).status()).toBe(401);
    await expect(
      ordinary.getByRole("heading", { name: "به هم‌بازی خوش آمدید", exact: true }),
    ).toBeVisible({ timeout: 6000 });
    await manager.getByRole("button", { name: "غیرفعال‌سازی", exact: true }).click();
    await approve();
    await expect(manager).toContainText("DISABLED");
  } finally {
    await ordinaryContext.close();
    await context.close();
  }
});
