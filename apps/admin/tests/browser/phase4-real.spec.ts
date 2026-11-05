import { test, expect, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("phase four searches the real game catalog", async ({ browser }) => {
  test.setTimeout(100000);
  test.skip(
    !process.env.TEST_ADMIN_PHASE4_URL,
    "Only the owned disposable Backend harness may enable this test",
  );
  const origin = process.env.TEST_ADMIN_PHASE4_URL!;
  if (!/^https:\/\/127\.0\.0\.1:[0-9]+$/.test(origin)) throw new Error("LOCAL_BACKEND_REQUIRED");
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.route(origin + "/**", async (route: Route) => {
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
  let step = "START";
  try {
    const page = await context.newPage();
    step = "NAVIGATION";
    await page.goto(origin);
    await expect(page.locator("html")).toHaveAttribute("lang", "fa-IR");
    step = "LOGIN";
    await page
      .getByLabel("نام کاربری", { exact: true })
      .fill(process.env.TEST_ADMIN_PHASE4_USERNAME!);
    await page
      .getByLabel("رمز عبور", { exact: true })
      .fill(process.env.TEST_ADMIN_PHASE4_PASSWORD!);
    await page.getByRole("button", { name: "ورود به پنل", exact: true }).click();
    step = "PIN";
    await page.getByLabel("PIN شش‌رقمی", { exact: true }).fill(process.env.TEST_ADMIN_PHASE4_PIN!);
    await page.getByRole("button", { name: "تأیید و ورود", exact: true }).click();
    step = "SECTION";
    await page.getByRole("button", { name: "بازی‌ها", exact: true }).click();
    step = "SEARCH_CONTROL";
    await expect(page.getByLabel("جستجوی بازی", { exact: true })).toBeVisible();
    await page.getByLabel("جستجوی بازی", { exact: true }).fill("phase-four-alpha");
    step = "GAME_STATUS_CONTROL";
    await expect(page.getByRole("combobox", { name: "وضعیت بازی", exact: true })).toBeVisible();
    await page
      .getByRole("combobox", { name: "وضعیت بازی", exact: true })
      .selectOption("MAINTENANCE");
    step = "GAME_SEARCH_RESULTS";
    await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr")).toContainText("phase-four-alpha");
    step = "GAME_DETAIL_CONTROL";
    await expect(
      page.locator("tbody tr").getByRole("button", { name: "phase-four-alpha", exact: true }),
    ).toBeVisible();
    await page
      .locator("tbody tr")
      .getByRole("button", { name: "phase-four-alpha", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "جزئیات بازی", exact: true })).toBeVisible();
    await expect(page.getByText("نسخه‌های نصب‌شده: در دسترس نیست", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "بستن پذیرش جدید", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "بازگشت به فهرست", exact: true }).click();
    step = "GAME_PAGINATION";
    await page.getByLabel("جستجوی بازی", { exact: true }).fill("literal_%_page");
    await page.getByRole("combobox", { name: "وضعیت بازی", exact: true }).selectOption("");
    await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(50);
    await page.getByRole("button", { name: "صفحهٔ بعد", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    step = "ROOM_PAGINATION";
    await page.getByRole("button", { name: "اتاق‌ها", exact: true }).click();
    await page.getByLabel("شناسهٔ بازی", { exact: true }).fill("phase-four-page-01");
    await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(50);
    await page.getByRole("button", { name: "صفحهٔ بعد", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("button", { name: "بازی‌ها", exact: true }).click();
    await page.getByRole("button", { name: "اتاق‌ها", exact: true }).click();
    step = "ROOM_DETAIL";
    await page
      .getByLabel("جستجوی اتاق", { exact: true })
      .fill("41000000-0000-4000-8000-000000000001");
    await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
    await page
      .getByRole("button", { name: "41000000-0000-4000-8000-000000000001", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "جزئیات اتاق", exact: true })).toBeVisible();
    await expect(page.getByText(/ظرفیت: 4/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "بستن اتاق پیش از شروع", exact: true }),
    ).toBeEnabled();
    step = "MATCH_DETAIL";
    await page.getByRole("button", { name: "مسابقات", exact: true }).click();
    await page
      .getByLabel("جستجوی مسابقه", { exact: true })
      .fill("42000000-0000-4000-8000-000000000001");
    await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
    await page
      .getByRole("button", { name: "42000000-0000-4000-8000-000000000001", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "جزئیات مسابقه", exact: true })).toBeVisible();
    const pins = page.getByText(/نسخه‌های ثابت مسابقه/);
    await expect(pins).toContainText("pinned-engine");
    await expect(pins).toContainText("pinned-rules");
    await expect(
      page.getByRole("button", { name: "توقف بدون نتیجهٔ مسابقه", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "بازگشت به فهرست", exact: true }).click();
    await page
      .getByLabel("جستجوی مسابقه", { exact: true })
      .fill("42000000-0000-4000-8000-000000000002");
    await page
      .getByRole("combobox", { name: "وضعیت مسابقه", exact: true })
      .selectOption("FINISHED");
    await page
      .getByLabel("ایجاد از (UTC، ISO 8601)", { exact: true })
      .fill("2026-01-01T00:00:00.000Z");
    await page
      .getByLabel("ایجاد تا (UTC، ISO 8601)", { exact: true })
      .fill("2026-01-03T00:00:00.000Z");
    await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page
      .getByRole("button", { name: "42000000-0000-4000-8000-000000000002", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "توقف بدون نتیجهٔ مسابقه", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "بازگشت به فهرست", exact: true }).click();
    step = "MATCH_NULL_METADATA";
    await page.getByRole("combobox", { name: "وضعیت مسابقه", exact: true }).selectOption("");
    step = "MATCH_NULL_SEARCH";
    await page
      .getByLabel("جستجوی مسابقه", { exact: true })
      .fill("42000000-0000-4000-8000-000000000003");
    await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
    step = "MATCH_NULL_RESULT";
    await expect(
      page.getByRole("button", { name: "42000000-0000-4000-8000-000000000003", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "42000000-0000-4000-8000-000000000003", exact: true })
      .click();
    step = "MATCH_NULL_DETAIL";
    await expect(page.getByText("اتاق: بدون اتاق", { exact: true })).toBeVisible();
    await expect(page.getByText("نوع مسابقه: شخصی با ربات‌ها", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "بازگشت به فهرست", exact: true }).click();
    step = "MATCH_UNKNOWN_TYPE";
    await page
      .getByLabel("جستجوی مسابقه", { exact: true })
      .fill(process.env.TEST_ADMIN_PHASE4_UNKNOWN_MATCH_ID!);
    await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
    await page
      .getByRole("button", { name: process.env.TEST_ADMIN_PHASE4_UNKNOWN_MATCH_ID!, exact: true })
      .click();
    await expect(page.getByText(/نوع مسابقه: ناشناخته/)).toContainText("__proto__");
    await page.getByRole("button", { name: "بازگشت به فهرست", exact: true }).click();
    step = "MATCH_PAGINATION";
    await expect(page.getByLabel("ایجاد از (UTC، ISO 8601)", { exact: true })).toHaveValue(
      "2026-01-01T00:00:00.000Z",
    );
    await expect(page.getByLabel("ایجاد تا (UTC، ISO 8601)", { exact: true })).toHaveValue(
      "2026-01-03T00:00:00.000Z",
    );
    await page.getByLabel("جستجوی مسابقه", { exact: true }).fill("");
    await page.getByLabel("شناسهٔ بازی", { exact: true }).fill("phase-four-page-01");
    await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(50);
    await page.getByRole("button", { name: "صفحهٔ بعد", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page
      .getByRole("combobox", { name: "وضعیت مسابقه", exact: true })
      .selectOption("FINISHED");
    await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
    await expect(page.getByText("موردی یافت نشد.", { exact: true })).toBeVisible();
    await page
      .getByLabel("ایجاد از (UTC، ISO 8601)", { exact: true })
      .fill("2026-02-01T00:00:00.000Z");
    await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("فیلتر معتبر نیست");
    async function openResource(kind: "rooms" | "matches", id: string) {
      await page.getByRole("button", { name: "بازی‌ها", exact: true }).click();
      await page
        .getByRole("button", { name: kind === "rooms" ? "اتاق‌ها" : "مسابقات", exact: true })
        .click();
      await page
        .getByLabel(kind === "rooms" ? "جستجوی اتاق" : "جستجوی مسابقه", { exact: true })
        .fill(id);
      await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
      await page.getByRole("button", { name: id, exact: true }).click();
    }
    step = "ROOM_ROSTER";
    await openResource("rooms", "43000000-0000-4000-8000-000000000001");
    const roomRoster = page.getByRole("region", { name: "بازیکنان اتاق", exact: true });
    await expect(roomRoster.locator("tbody tr")).toHaveCount(2);
    await expect(roomRoster).toContainText(process.env.TEST_ADMIN_PHASE4_USER_ID!);
    await expect(roomRoster).not.toContainText(/وضعیت اتصال|آمادگی|نسخهٔ اتصال/);
    const diagnostics = page.getByRole("region", { name: "تشخیص وضعیت", exact: true });
    await expect(diagnostics).toContainText("نشانه‌ای مشاهده نشد");
    await expect(diagnostics).toContainText("مهلت ثبت‌شده هنوز نگذشته است");
    await expect(diagnostics).toContainText("این مشاهده تأیید سلامت نیست");
    await expect(diagnostics.locator("time")).toHaveAttribute("datetime", /Z$/);
    step = "REGISTERED_PROFILE_NAVIGATION";
    await roomRoster
      .getByRole("button", { name: /^پروفایل کاربر/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "پروفایل کاربر", exact: true })).toBeVisible();
    await expect(page.getByText("شناسهٔ عمومی: phase_four_user", { exact: true })).toBeVisible();
    step = "MATCH_ROSTER_HISTORY";
    await openResource("matches", "44000000-0000-4000-8000-000000000001");
    const matchRoster = page.getByRole("region", { name: "بازیکنان مسابقه", exact: true });
    await expect(matchRoster.locator("tbody tr")).toHaveCount(3);
    await expect(matchRoster.locator("tbody tr").nth(0)).toContainText("قطع‌شده");
    await expect(matchRoster.locator("tbody tr").nth(0)).toContainText("نسخهٔ اتصال: 4");
    await expect(matchRoster.locator("tbody tr").nth(1)).toContainText("جایگزین‌شده با ربات");
    await expect(matchRoster.locator("tbody tr").nth(1)).toContainText("آمادگی: ثبت نشده");
    const serverBot = matchRoster.locator("tbody tr").nth(2);
    await expect(serverBot).toContainText("ربات سرور");
    await expect(serverBot).toContainText("45000000-0000-4000-8000-000000000001");
    await expect(serverBot.getByRole("button")).toHaveCount(0);
    await expect(serverBot).not.toContainText(/آمادگی|اتصال|عضویت|کاربر/);
    const history = page.getByRole("region", { name: "تاریخچهٔ مسابقه", exact: true });
    await expect(history.locator("tbody tr")).toHaveCount(7);
    await expect(history).toContainText("PLAYER_BOT_TAKEOVER_V1");
    await expect(history).toContainText("MATCH_FINISHED_V2");
    await expect(history).not.toContainText(/HIDDEN|payload|stateJsonb|metrics|card|seed/i);
    const results = page.getByRole("region", { name: "نتایج ثبت‌شده", exact: true });
    await expect(results).toContainText("برنده");
    await expect(results).toContainText("رتبه: 1");
    await expect(results).toContainText("نتیجه ثبت نشده");
    await expect(results).not.toContainText("45000000-0000-4000-8000-000000000001");
    await expect(diagnostics).toContainText("وضعیت پایانی");
    await expect(
      page.getByRole("button", { name: "توقف بدون نتیجهٔ مسابقه", exact: true }),
    ).toBeDisabled();
    step = "HISTORY_PAGINATION";
    await openResource("matches", "44000000-0000-4000-8000-000000000004");
    await expect(history.locator("tbody tr")).toHaveCount(50);
    await history.getByRole("button", { name: "صفحهٔ بعد تاریخچه", exact: true }).click();
    await expect(history.locator("tbody tr")).toHaveCount(1);
    await expect(history.locator("tbody tr")).toContainText("51");
    await history.getByRole("button", { name: "تازه‌سازی تاریخچه", exact: true }).click();
    await expect(history.locator("tbody tr")).toHaveCount(50);
    step = "RELATED_ROOM_AND_UNKNOWN_DIAGNOSTICS";
    await openResource("matches", "42000000-0000-4000-8000-000000000001");
    await expect(diagnostics).toContainText("شواهد کافی در دسترس نیست");
    await expect(diagnostics).toContainText("مهلت پایدار ثبت نشده است");
    await page.getByRole("button", { name: /^مشاهدهٔ اتاق/ }).click();
    await expect(page.getByRole("heading", { name: "جزئیات اتاق", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "جزئیات مسابقه", exact: true })).toHaveCount(0);
    await expect(roomRoster.locator("tbody tr")).toHaveCount(0);
    step = "SUSPECTED_DIAGNOSTICS";
    await openResource("rooms", process.env.TEST_ADMIN_PHASE4_SUSPECTED_ROOM_ID!);
    await expect(diagnostics).toContainText("نیازمند بررسی");
    await expect(diagnostics).toContainText("مهلت اتاق گذشته است");
    await expect(
      page.getByRole("button", { name: "بستن اتاق پیش از شروع", exact: true }),
    ).toBeEnabled();
    await expect(page.getByRole("heading", { name: /پیش‌نمایش|بازبینی/ })).toHaveCount(0);
    step = "READER_PERMISSION_GATES";
    await page.getByRole("button", { name: "خروج امن", exact: true }).click();
    await page
      .getByLabel("نام کاربری", { exact: true })
      .fill(process.env.TEST_ADMIN_PHASE4_READER_USERNAME!);
    await page
      .getByLabel("رمز عبور", { exact: true })
      .fill(process.env.TEST_ADMIN_PHASE4_READER_PASSWORD!);
    await page.getByRole("button", { name: "ورود به پنل", exact: true }).click();
    await expect(page.getByText("مدیر پلتفرم", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "اتاق‌ها", exact: true }).click();
    await page
      .getByLabel("جستجوی اتاق", { exact: true })
      .fill("43000000-0000-4000-8000-000000000001");
    await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
    await page
      .getByRole("button", { name: "43000000-0000-4000-8000-000000000001", exact: true })
      .click();
    await expect(roomRoster.locator("tbody tr")).toHaveCount(2);
    await expect(page.getByRole("button", { name: /^پروفایل کاربر/ })).toHaveCount(0);
    await expect(diagnostics).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "بستن اتاق پیش از شروع", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "مسابقات", exact: true }).click();
    await page
      .getByLabel("جستجوی مسابقه", { exact: true })
      .fill("44000000-0000-4000-8000-000000000001");
    await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
    await page
      .getByRole("button", { name: "44000000-0000-4000-8000-000000000001", exact: true })
      .click();
    await expect(history.locator("tbody tr")).toHaveCount(7);
    await expect(matchRoster).toHaveCount(0);
    await expect(diagnostics).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^پروفایل کاربر/ })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "توقف بدون نتیجهٔ مسابقه", exact: true }),
    ).toHaveCount(0);
    console.log("PHASE4_BROWSER_EXECUTED");
  } catch (error) {
    console.error(`ADMIN_TEST_PHASE_FOUR_${step}`);
    throw error;
  } finally {
    await context.close();
  }
});
