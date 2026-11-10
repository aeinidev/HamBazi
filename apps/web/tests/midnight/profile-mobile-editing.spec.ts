import { test, setup, launch, nativeEvent } from "./fixture.js";
import { expect, type Page } from "@playwright/test";

async function viewportFixture(page: Page) {
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    let height = innerHeight,
      top = 0,
      scale = 1;
    Object.defineProperties(viewport, {
      height: { get: () => height },
      width: { get: () => innerWidth },
      offsetTop: { get: () => top },
      offsetLeft: { get: () => 0 },
      scale: { get: () => scale },
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    Object.assign(window, {
      __profileViewport(next: { height: number; top?: number; scale?: number }) {
        height = next.height;
        top = next.top ?? 0;
        scale = next.scale ?? 1;
        viewport.dispatchEvent(new Event("resize"));
        viewport.dispatchEvent(new Event("scroll"));
      },
    });
  });
}
async function setViewport(page: Page, height: number, top = 0, scale = 1) {
  await page.evaluate(
    (next) => {
      (window as unknown as { __profileViewport(v: typeof next): void }).__profileViewport(next);
    },
    { height, top, scale },
  );
}
async function fieldVisible(page: Page, top: number, bottom: number) {
  await expect
    .poll(async () => {
      const rect = await page.locator("input:focus").boundingBox();
      return !!rect && rect.y >= top && rect.y + rect.height <= bottom;
    })
    .toBe(true);
}

test("iOS visual viewport keeps both fields above the keyboard and restores the original frame", async ({
  page,
  request,
}) => {
  await viewportFixture(page);
  await setup(page, request);
  await launch(page, "/profile");
  const nav = page.getByRole("navigation", { name: "ناوبری اصلی" });
  const original = await nav.boundingBox();
  const name = page.getByLabel("نام نمایشی", { exact: true });
  await name.focus();
  expect(
    await name.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await setViewport(page, 400, 60);
  await expect(nav).not.toBeVisible();
  await fieldVisible(page, 60, 460);
  await page.getByLabel("نام کاربری", { exact: true }).focus();
  await fieldVisible(page, 60, 460);
  await page.locator("input:focus").evaluate((e) => (e as HTMLInputElement).blur());
  await expect(nav).not.toBeVisible();
  await setViewport(page, 844);
  await expect(nav).toBeVisible();
  await expect.poll(async () => (await nav.boundingBox())!.y).toBeCloseTo(original!.y, 0);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await name.focus();
  await setViewport(page, 400, 0, 2);
  await expect(nav).toBeVisible();
});

test("Android layout resize and native viewport events hide the dock only on profile", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    history.replaceState(
      null,
      "",
      location.href.replaceAll("tgWebAppPlatform=ios", "tgWebAppPlatform=android"),
    );
  });
  await setup(page, request);
  await launch(page, "/profile");
  const nav = page.getByRole("navigation", { name: "ناوبری اصلی" });
  await page.getByLabel("نام کاربری", { exact: true }).focus();
  await page.setViewportSize({ width: 390, height: 390 });
  await expect(nav).not.toBeVisible();
  await fieldVisible(page, 0, 390);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nav).toBeVisible();
  await nativeEvent(page, "viewport_changed", {
    height: 380,
    is_state_stable: false,
    is_expanded: true,
  });
  await expect(nav).not.toBeVisible();
  await fieldVisible(page, 0, 380);
  await page.evaluate(() => {
    location.hash = "/games";
  });
  await expect(nav).toBeVisible();
  await expect(page.locator(".midnight-shell")).toHaveAttribute("data-screen", "home");
});

test("crop modal supports drag, pinch, pointer handoff and precise export without sliders", async ({
  page,
  request,
}, info) => {
  await setup(page, request);
  await launch(page, "/profile");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 300;
    const ctx = canvas.getContext("2d")!;
    ["#ff2020", "#20ff20", "#2020ff"].forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(i * 300, 0, 300, 300);
    });
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  const content = page.locator(".profile-content");
  await page.getByLabel("آپلود عکس دلخواه").setInputFiles({
    name: "stripes.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  const dialog = page.getByRole("dialog", { name: "تنظیم عکس پروفایل" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("slider")).toHaveCount(0);
  const canvas = dialog.locator("canvas");
  // Synthetic multitouch has no native active pointer to capture. Real drag is covered separately.
  await canvas.evaluate((e) => {
    e.setPointerCapture = () => {};
  });
  const pointer = async (name: string, id: number, x: number, y: number) => {
    const bounds = (await canvas.boundingBox())!;
    await canvas.dispatchEvent(name, {
      pointerId: id,
      pointerType: "touch",
      isPrimary: id === 1,
      clientX: bounds.x + bounds.width * x,
      clientY: bounds.y + bounds.height * y,
      bubbles: true,
      cancelable: true,
    });
  };
  const preview = () => canvas.evaluate((e) => (e as HTMLCanvasElement).toDataURL());
  const initial = await preview();
  await pointer("pointerdown", 1, 0.4, 0.5);
  await pointer("pointerdown", 2, 0.6, 0.5);
  await pointer("pointermove", 1, 0.2, 0.5);
  await pointer("pointermove", 2, 0.8, 0.5);
  await pointer("pointerup", 2, 0.8, 0.5);
  await pointer("pointermove", 1, 3.5, 0.5);
  await pointer("pointerup", 1, 3.5, 0.5);
  await expect.poll(preview).not.toBe(initial);
  expect(
    await canvas.evaluate((e) => {
      const p = (e as HTMLCanvasElement).getContext("2d")!.getImageData(192, 192, 1, 1).data;
      return p[0]! > 200 && p[1]! < 60;
    }),
  ).toBe(true);
  const before = await content.evaluate((e) => e.scrollTop);
  await page.mouse.move(8, 420);
  await page.mouse.wheel(0, 600);
  expect(await content.evaluate((e) => e.scrollTop)).toBe(before);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  for (const size of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await expect(dialog.getByRole("button", { name: "استفاده از این عکس" })).toBeInViewport();
  }
  await page.screenshot({ path: info.outputPath("gesture-crop.png") });
  const expected = await canvas.evaluate((e) =>
    (e as HTMLCanvasElement).toDataURL("image/jpeg", 0.88),
  );
  await dialog.getByRole("button", { name: "استفاده از این عکس" }).click();
  await expect(page.locator(".profile-identity img")).toHaveAttribute("src", expected);
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => document.body.style.position)).not.toBe("fixed");
});

test("keyboard restores the latest scroll after an earlier hardware-keyboard focus", async ({
  page,
  request,
}) => {
  await viewportFixture(page);
  await setup(page, request);
  await launch(page, "/profile");
  const name = page.getByLabel("نام نمایشی", { exact: true });
  await name.focus();
  await name.evaluate((e) => (e as HTMLInputElement).blur());
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const region = page.locator(".profile-content");
  await region.evaluate((e) => {
    e.scrollTop = 100;
  });
  await page.getByLabel("نام کاربری", { exact: true }).focus();
  const before = await region.evaluate((e) => e.scrollTop);
  expect(before).toBeGreaterThan(0);
  await setViewport(page, 400);
  await expect(page.getByRole("navigation")).not.toBeVisible();
  await setViewport(page, 844);
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect.poll(() => region.evaluate((e) => e.scrollTop)).toBeCloseTo(before, 0);
});

test("save errors remain reachable while the keyboard closes", async ({ page, request }) => {
  await viewportFixture(page);
  await setup(page, request);
  await launch(page, "/profile");
  await page.route("https://api-staging.hambazi.top/v1/me", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 503,
          json: { ok: false, error: { code: "INTERNAL_ERROR", retryable: true } },
        })
      : route.fallback(),
  );
  await page.getByLabel("نام نمایشی", { exact: true }).fill("پیش‌نویس موبایل");
  await setViewport(page, 400);
  await expect(page.getByRole("navigation")).not.toBeVisible();
  await page.locator("#profile-form").evaluate((e) => (e as HTMLFormElement).requestSubmit());
  await expect(page.getByRole("alert")).toBeInViewport();
  await setViewport(page, 844);
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("alert")).toBeInViewport();
  await expect(page.getByLabel("نام نمایشی", { exact: true })).toHaveValue("پیش‌نویس موبایل");
});

test("rotating with the keyboard open does not leave navigation hidden after dismissal", async ({
  page,
  request,
}) => {
  await setup(page, request);
  await launch(page, "/profile");
  const nav = page.getByRole("navigation", { name: "ناوبری اصلی" });
  await page.getByLabel("نام کاربری", { exact: true }).focus();
  await page.setViewportSize({ width: 390, height: 400 });
  await expect(nav).not.toBeVisible();
  await page.setViewportSize({ width: 844, height: 220 });
  await expect(nav).not.toBeVisible();
  await fieldVisible(page, 0, 220);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(nav).toBeVisible();
  await expect(page.locator(".midnight-shell")).not.toHaveAttribute(
    "data-profile-keyboard",
    "true",
  );
  await expect(page.locator(".midnight-shell")).not.toHaveAttribute(
    "data-profile-viewport",
    "true",
  );
});

test("real pointer capture, native back and Escape restore focus and background scrolling", async ({
  page,
  request,
}, info) => {
  await setup(page, request);
  await launch(page, "/profile");
  await page.getByLabel("نام نمایشی", { exact: true }).fill("پیش‌نویس محفوظ");
  const upload = page.getByLabel("آپلود عکس دلخواه");
  const file = {
    name: "photo.webp",
    mimeType: "image/webp",
    buffer: (await import("node:fs")).readFileSync(
      new URL("../../src/assets/avatars/hb-01.webp", import.meta.url),
    ),
  };
  await upload.focus();
  await upload.setInputFiles(file);
  const dialog = page.getByRole("dialog", { name: "تنظیم عکس پروفایل" });
  const canvas = dialog.locator("canvas");
  await expect(dialog.getByRole("heading", { name: "تنظیم عکس پروفایل" })).toHaveCSS(
    "outline-style",
    "none",
  );
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await expect(canvas).toHaveAttribute("data-dragging", "true");
  await page.mouse.move(bounds.x + bounds.width + 30, bounds.y + bounds.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(canvas).toHaveAttribute("data-dragging", "false");
  await page.screenshot({ path: info.outputPath("avatar-modal.png") });
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    // Native dialogs can hand focus to browser chrome, but the background must stay inert.
    expect(
      await dialog.evaluate(
        (e) => e.contains(document.activeElement) || document.activeElement === document.body,
      ),
    ).toBe(true);
  }
  await page
    .getByLabel("نام نمایشی", { exact: true })
    .evaluate((e) => (e as HTMLInputElement).focus());
  await expect(page.getByLabel("نام نمایشی", { exact: true })).not.toBeFocused();
  const prompts: string[] = [];
  page.on("dialog", async (d) => {
    prompts.push(d.message());
    await d.dismiss();
  });
  await nativeEvent(page, "back_button_pressed");
  await expect(dialog).not.toBeVisible();
  expect(prompts).toEqual([]);
  await expect(page).toHaveURL(/#\/profile$/);
  await expect(upload).toBeFocused();
  await expect(page.getByLabel("نام نمایشی", { exact: true })).toHaveValue("پیش‌نویس محفوظ");
  await upload.setInputFiles(file);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  const region = page.locator(".profile-content");
  await region.evaluate((e) => {
    e.scrollTop = 0;
  });
  await region.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => region.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.body.style.position)).not.toBe("fixed");
});
