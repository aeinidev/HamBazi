import { test, setup, launch, nativeEvent } from "./fixture.js";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";

test("profile reveals save failures and retries the same command without losing its draft", async ({
  page,
  request,
}) => {
  await setup(page, request);
  await launch(page, "/profile");
  const commands: string[] = [];
  await page.route("https://api-staging.hambazi.top/v1/me", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    commands.push(String(route.request().postDataJSON().commandId));
    if (commands.length === 1)
      return route.fulfill({
        status: 503,
        json: { ok: false, error: { code: "INTERNAL_ERROR", retryable: true } },
      });
    return route.fallback();
  });
  await page.getByLabel("نام نمایشی", { exact: true }).fill("نام تازه");
  await page.getByRole("button", { name: "ذخیرهٔ تغییرات", exact: true }).click();
  await expect(page.getByRole("alert")).toBeInViewport();
  await page.getByRole("button", { name: "تلاش دوباره", exact: true }).click();
  await expect(page.getByText("تغییرات ذخیره شد", { exact: true })).toBeVisible();
  await expect(page.getByLabel("نام نمایشی", { exact: true })).toHaveValue("نام تازه");
  expect(commands).toHaveLength(2);
  expect(commands[0]).toBe(commands[1]);
});

test("profile hub selects all ten supplied avatars and saves identity into the lobby", async ({
  page,
  request,
}, info) => {
  await setup(page, request);
  await launch(page, "/profile");
  await expect(page.getByRole("group", { name: "آواتارهای پسرانه" })).toBeVisible({
    timeout: 4000,
  });
  await expect(page.locator(".profile-avatar-option")).toHaveCount(10);
  const avatar = page.getByRole("button", { name: "انتخاب شینوبو" });
  await avatar.click();
  await expect(avatar).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("نام نمایشی", { exact: true }).fill("بازیکن نئون");
  const username = page.getByLabel("نام کاربری", { exact: true });
  await username.fill("taken");
  await expect(page.getByText("نام کاربری نامعتبر", { exact: true })).toBeVisible();
  await username.fill("Neon_Player");
  await expect(page.getByText("نام کاربری آزاد است", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ذخیرهٔ تغییرات", exact: true }).click();
  await expect(page.getByText("تغییرات ذخیره شد", { exact: true })).toBeVisible();
  await expect(page.locator(".profile-identity img")).toHaveAttribute("src", /hb-07/);
  const pinned = (await page.locator(".profile-identity").boundingBox())!;
  await page.getByRole("heading", { name: "آمار بازی‌ها" }).scrollIntoViewIfNeeded();
  expect((await page.locator(".profile-identity").boundingBox())!.y).toBe(pinned.y);
  await page.screenshot({ path: info.outputPath("profile-hub.png") });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "بازی‌ها", exact: true }).click();
  await expect(page.locator(".home-identity")).toContainText("بازیکن نئون");
  await expect(page.locator(".home-identity img")).toHaveAttribute("src", /hb-07/);
  await page.getByRole("link", { name: "پروفایل", exact: true }).click();
  await expect(username).toHaveValue("neon_player");
});

test("profile guards drafts on navigation, native back and logout", async ({ page, request }) => {
  await setup(page, request);
  await launch(page, "/profile");
  await page.getByLabel("نام نمایشی", { exact: true }).fill("پیش‌نویس");
  let handled = page.waitForEvent("dialog").then((dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "بازی‌ها", exact: true }).click();
  await handled;
  await expect(page).toHaveURL(/#\/profile$/);
  handled = page.waitForEvent("dialog").then((dialog) => dialog.dismiss());
  await nativeEvent(page, "back_button_pressed");
  await handled;
  await expect(page).toHaveURL(/#\/profile$/);
  handled = page.waitForEvent("dialog").then((dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "خروج از حساب", exact: true }).click();
  await handled;
  await expect(page.getByLabel("نام نمایشی", { exact: true })).toHaveValue("پیش‌نویس");
  handled = page.waitForEvent("dialog").then((dialog) => dialog.accept());
  await page.getByRole("link", { name: "بازی‌ها", exact: true }).click();
  await handled;
  await expect(page.getByRole("heading", { name: "بازی‌ها", exact: true })).toBeVisible();
});

test("profile validates uploads, previews a circular crop and can restore the default", async ({
  page,
  request,
}) => {
  await setup(page, request);
  await launch(page, "/profile");
  const upload = page.getByLabel("آپلود عکس دلخواه");
  await upload.setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(3 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole("alert")).toContainText("۳ مگابایت");
  await upload.setInputFiles({
    name: "bad.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(page.getByRole("alert")).toContainText("فرمت");
  await upload.setInputFiles({
    name: "photo.webp",
    mimeType: "image/webp",
    buffer: readFileSync(new URL("../../src/assets/avatars/hb-01.webp", import.meta.url)),
  });
  const dialog = page.getByRole("dialog", { name: "تنظیم عکس پروفایل" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("slider")).toHaveCount(0);
  await dialog.getByLabel("پیش‌نمایش کراپ دایره‌ای").focus();
  await page.keyboard.press("+");
  await page.getByRole("button", { name: "استفاده از این عکس" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "ذخیرهٔ تغییرات", exact: true }).click();
  await expect(page.locator(".profile-identity img")).toHaveAttribute(
    "src",
    /^data:image\/jpeg;base64,/,
  );
  await page.getByRole("button", { name: "آواتار پیش‌فرض هم‌بازی" }).click();
  await page.getByRole("button", { name: "ذخیرهٔ تغییرات", exact: true }).click();
  await expect(page.locator(".profile-identity .fallback-avatar")).toBeVisible();
});

test("profile decodes a real HEIF in its lazy worker under the deployed CSP", async ({
  page,
  request,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) violations.push(message.text());
  });
  await setup(page, request);
  await launch(page, "/profile");
  await page.getByLabel("آپلود عکس دلخواه").setInputFiles({
    name: "photo.heif",
    mimeType: "image/heif",
    buffer: readFileSync(new URL("../fixtures/rainbow.heic", import.meta.url)),
  });
  await expect(page.getByRole("dialog", { name: "تنظیم عکس پروفایل" })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "استفاده از این عکس" }).click();
  await expect(page.locator(".profile-identity img")).toHaveAttribute(
    "src",
    /^data:image\/jpeg;base64,/,
  );
  expect(violations).toEqual([]);
});

test("background profile read failure preserves unsaved fields and avatar", async ({
  page,
  request,
}) => {
  await setup(page, request);
  await launch(page, "/profile");
  await page.getByLabel("نام نمایشی", { exact: true }).fill("پیش‌نویس آفلاین");
  await page.getByRole("button", { name: "انتخاب گیو", exact: true }).click();
  let fail = false;
  await page.route("https://api-staging.hambazi.top/v1/me", (route) => {
    fail = true;
    return route.fulfill({
      status: 503,
      json: { ok: false, error: { code: "INTERNAL_ERROR", retryable: true } },
    });
  });
  await page.clock.install();
  await page.clock.fastForward(11000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => fail).toBe(true);
  await page.clock.fastForward(20000);
  await expect(page.getByLabel("نام نمایشی", { exact: true })).toHaveValue("پیش‌نویس آفلاین");
  await expect(page.getByRole("button", { name: "انتخاب گیو", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
