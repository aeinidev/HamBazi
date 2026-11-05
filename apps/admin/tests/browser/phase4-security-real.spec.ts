import { test, expect, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

test("phase four real access changes, delayed response and accessible layout", async ({
  browser,
}, testInfo) => {
  test.setTimeout(100000);
  test.skip(
    !process.env.TEST_ADMIN_PHASE4_URL,
    "Only the owned disposable Backend harness may enable this test",
  );
  const origin = process.env.TEST_ADMIN_PHASE4_URL!;
  if (!/^https:\/\/127\.0\.0\.1:[0-9]+$/.test(origin)) throw new Error("LOCAL_BACKEND_REQUIRED");
  const ownerContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const readerContext = await browser.newContext({ ignoreHTTPSErrors: true });
  let hold = false;
  let captured!: () => void;
  let release!: () => void;
  let completed!: () => void;
  let failed!: (error: unknown) => void;
  const completion = new Promise<void>((resolve, reject) => {
    completed = resolve;
    failed = reject;
  });
  const capturedResponse = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const releaseResponse = new Promise<void>((resolve) => {
    release = resolve;
  });
  const serve = async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/v1/admin/")) {
      if (hold && path === "/v1/admin/rooms/search") {
        hold = false;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        expect(await response.text()).toContain("43000000-0000-4000-8000-000000000001");
        captured();
        await releaseResponse;
        try {
          await route.fulfill({ response });
          completed();
        } catch (error) {
          failed(error);
        }
        return;
      }
      return route.continue();
    }
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
  await ownerContext.route(origin + "/**", serve);
  await readerContext.route(origin + "/**", serve);
  const owner = await ownerContext.newPage();
  const reader = await readerContext.newPage();
  try {
    await owner.goto(origin);
    await owner
      .getByLabel("نام کاربری", { exact: true })
      .fill(process.env.TEST_ADMIN_PHASE4_USERNAME!);
    await owner
      .getByLabel("رمز عبور", { exact: true })
      .fill(process.env.TEST_ADMIN_PHASE4_PASSWORD!);
    await owner.getByRole("button", { name: "ورود به پنل", exact: true }).click();
    expect((await ownerContext.request.get(origin + "/v1/admin/admins")).status()).toBe(401);
    await owner.getByLabel("PIN شش‌رقمی", { exact: true }).fill(process.env.TEST_ADMIN_PHASE4_PIN!);
    await owner.getByRole("button", { name: "تأیید و ورود", exact: true }).click();
    await expect(owner.getByText("مالک اصلی · OWNER", { exact: true })).toBeVisible();
    expect(
      (
        await ownerContext.request.post(origin + "/v1/admin/operations", {
          headers: { origin },
          data: { schemaVersion: 1 },
        })
      ).status(),
    ).toBe(403);
    await owner.getByRole("button", { name: "مدیران و نقش‌ها", exact: true }).click();
    const manager = owner
      .getByRole("listitem")
      .filter({ has: owner.locator("bdi", { hasText: /^phase_four_security_reader$/ }) });
    await expect(manager).toBeVisible();
    await reader.goto(origin);
    await reader
      .getByLabel("نام کاربری", { exact: true })
      .fill(process.env.TEST_ADMIN_PHASE4_READER_USERNAME!);
    await reader
      .getByLabel("رمز عبور", { exact: true })
      .fill(process.env.TEST_ADMIN_PHASE4_READER_PASSWORD!);
    await reader.getByRole("button", { name: "ورود به پنل", exact: true }).click();
    await expect(reader.getByText("مدیر پلتفرم", { exact: true })).toBeVisible();
    expect((await readerContext.request.get(origin + "/v1/admin/users")).status()).toBe(403);
    expect(
      (
        await readerContext.request.get(
          origin + "/v1/admin/rooms/43000000-0000-4000-8000-000000000001/players",
        )
      ).status(),
    ).toBe(403);
    await reader.getByRole("button", { name: "اتاق‌ها", exact: true }).click();
    await expect(reader.locator("html")).toHaveAttribute("lang", "fa-IR");
    await expect(reader.locator("html")).toHaveAttribute("dir", "rtl");
    await reader.getByLabel("جستجوی اتاق", { exact: true }).focus();
    await expect(reader.getByLabel("جستجوی اتاق", { exact: true })).toBeFocused();
    await reader.keyboard.press("Tab");
    await expect(reader.getByRole("combobox", { name: "وضعیت اتاق", exact: true })).toBeFocused();
    expect(
      (await new AxeBuilder({ page: reader }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
    ).toEqual([]);
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.screenshot({
      path: testInfo.outputPath("phase4-security-desktop.png"),
      fullPage: true,
    });
    await reader.setViewportSize({ width: 390, height: 844 });
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (await new AxeBuilder({ page: reader }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
    ).toEqual([]);
    await reader.screenshot({
      path: testInfo.outputPath("phase4-security-mobile.png"),
      fullPage: true,
    });
    await reader.setViewportSize({ width: 1280, height: 720 });
    const observer = await readerContext.newPage();
    await observer.goto(origin);
    await observer.getByRole("button", { name: "اتاق‌ها", exact: true }).click();
    await expect(
      observer.getByRole("button", { name: "43000000-0000-4000-8000-000000000001", exact: true }),
    ).toBeVisible();
    await reader.bringToFront();
    hold = true;
    await reader
      .getByLabel("جستجوی اتاق", { exact: true })
      .fill("43000000-0000-4000-8000-000000000001");
    await reader.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
    await capturedResponse;
    await manager.getByRole("button", { name: "ویرایش دسترسی", exact: true }).click();
    await owner.getByLabel("مجوز rooms.view قید 1", { exact: true }).selectOption("none");
    await owner.getByRole("button", { name: "بازبینی تغییر دسترسی", exact: true }).click();
    async function approve() {
      await owner.getByRole("button", { name: "ثبت درخواست تأیید", exact: true }).click();
      await owner
        .getByLabel("رمز عبور فعلی", { exact: true })
        .fill(process.env.TEST_ADMIN_PHASE4_PASSWORD!);
      await owner.getByLabel("PIN فعلی", { exact: true }).fill(process.env.TEST_ADMIN_PHASE4_PIN!);
      await owner.getByRole("checkbox").check();
      await owner.getByRole("button", { name: "تأیید همین عملیات", exact: true }).click();
      await owner.getByRole("button", { name: "اجرای همین درخواست", exact: true }).click();
      await expect(owner.getByRole("status").filter({ hasText: /^انجام شد$/ })).toBeVisible();
      await owner.getByRole("button", { name: "بستن و تازه‌کردن فهرست", exact: true }).click();
    }
    await approve();
    expect((await readerContext.request.get(origin + "/v1/admin/rooms/search")).status()).toBe(403);
    expect((await readerContext.request.get(origin + "/v1/admin/matches/search")).status()).toBe(
      200,
    );
    await observer.bringToFront();
    await expect(observer.getByRole("button", { name: "اتاق‌ها", exact: true })).toHaveCount(0);
    await expect(
      observer.getByText("43000000-0000-4000-8000-000000000001", { exact: true }),
    ).toHaveCount(0);
    await reader.bringToFront();
    await expect(reader.getByRole("button", { name: "اتاق‌ها", exact: true })).toHaveCount(0);
    await reader.getByRole("button", { name: "مسابقات", exact: true }).click();
    release();
    await completion;
    await expect(reader.getByLabel("جستجوی مسابقه", { exact: true })).toBeVisible();
    await expect(
      reader.getByText("43000000-0000-4000-8000-000000000001", { exact: true }),
    ).toHaveCount(0);
    await expect(reader.locator("body")).not.toContainText(
      /HIDDEN_STATE|HIDDEN_INVITE|HIDDEN_BROWSER/,
    );
    await manager.getByRole("button", { name: "ابطال نشست‌های مدیر", exact: true }).click();
    await approve();
    expect((await readerContext.request.get(origin + "/v1/admin/matches/search")).status()).toBe(
      401,
    );
    await expect(
      reader.getByRole("heading", { name: "به هم‌بازی خوش آمدید", exact: true }),
    ).toBeVisible();
    console.log("PHASE4_SECURITY_BROWSER_EXECUTED");
  } finally {
    release();
    await readerContext.close();
    await ownerContext.close();
  }
});
