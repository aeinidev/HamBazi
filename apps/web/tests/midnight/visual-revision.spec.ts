import { test } from "./fixture.js";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { setup, launch, nativeEvent, fixtureOrigin } from "./fixture.js";

for (const size of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  test(`branded boot and authenticated home at ${size.width}`, async ({ page, request }, info) => {
    const state = await setup(page, request);
    await request.post(`${fixtureOrigin}/__test/state`, { data: { displayName: "الکس" } });
    await page.setViewportSize(size);
    // Block the bundle in the test only to inspect the real pre-JS shell.
    // Aborting lets WebKit finish document loading before it captures the page.
    await page.route(/\/assets\/index-[^/]+\.js$/, (route) => route.abort());
    await page.goto("https://staging.hambazi.top/");
    await expect(page.getByRole("status", { name: "در حال بارگذاری هم‌بازی" })).toBeVisible();
    await page.evaluate(() => document.fonts.load('900 52px "Vazirmatn"'));
    await page.locator(".hambazi-loading-art").evaluate((el) => (el as HTMLImageElement).decode());
    expect(
      await page.evaluate(
        () => getComputedStyle(document.querySelector(".hambazi-loading")!).position,
      ),
    ).toBe("fixed");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`loading-${size.width}.png`),
      animations: "disabled",
    });
    expect(state.http).toEqual([]);
    await page.unroute(/\/assets\/index-[^/]+\.js$/);
    await launch(page);
    await expect(page.locator(".hambazi-loading")).toHaveCount(0);
    await expect(page.locator(".home-identity")).toContainText("الکس");
    await expect(page.locator(".home-recovery-link")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /بازی پیدا کن/ })).toHaveCount(0);
    await expect(page.locator(".home-activity dd")).toHaveText(["—", "—", "—"]);
    await expect(page.locator(".home-bottom-nav > *")).toHaveText([
      "بازی‌ها",
      "دوستان",
      "چت",
      "برترین‌ها",
      "پروفایل",
    ]);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.querySelectorAll<HTMLImageElement>(".home-screen img")].map((img) =>
          img.decode(),
        ),
      );
    });
    const layout = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      return {
        headingLeft:
          rect(".home-section-heading h1").left < rect(".home-section-heading button").left,
        hokmLeft: rect(".home-game-hokm").left < rect(".home-game-kahroba").left,
        coupLeft: rect(".home-game-coup").left < rect(".home-game-ludo").left,
        homeRight:
          rect('.home-bottom-nav a[href="#/games"]').left >
          rect('.home-bottom-nav a[href="#/profile"]').left,
        noOverflow: document.documentElement.scrollWidth <= innerWidth,
        bannerRatio: rect(".home-banner").width / rect(".home-banner").height,
        cardRatio: rect(".home-game-hokm").width / rect(".home-game-hokm").height,
        chessRatio: rect(".home-game-chess").width / rect(".home-game-chess").height,
        coupRatio: rect(".home-game-coup").width / rect(".home-game-coup").height,
      };
    });
    expect(layout).toMatchObject({
      headingLeft: true,
      hokmLeft: true,
      coupLeft: true,
      homeRight: true,
      noOverflow: true,
    });
    // Artwork adapts to the available height while retaining a landscape composition.
    for (const ratio of [layout.bannerRatio, layout.cardRatio, layout.chessRatio, layout.coupRatio])
      expect(ratio).toBeGreaterThan(1);
    await expect(page.locator(".home-card-arrow svg")).toHaveCount(1);
    await expect(page.locator(".home-card-badge")).toHaveCount(7);
    const art = await page
      .locator(".home-screen img")
      .evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src")));
    expect(art).toHaveLength(9);
    expect(art.every((src) => /^\/assets\/home\/[a-z]+-[a-f0-9]{12}\.webp$/.test(src!))).toBe(true);
    const delivered = await page.locator(".home-screen img").evaluateAll((imgs) =>
      imgs.map((img) => ({
        source: (img as HTMLImageElement).currentSrc,
        width: (img as HTMLImageElement).naturalWidth,
      })),
    );
    for (const img of delivered) expect(img.source).toMatch(/-compact-[a-f0-9]{12}\.webp$/);
    await expect(page.locator(".home-banner img")).toHaveAttribute("fetchpriority", "high");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`home-${size.width}.png`), fullPage: true });
    await page.screenshot({ path: info.outputPath(`home-top-${size.width}.png`) });
    const navBeforeScroll = await page.locator(".home-bottom-nav").boundingBox();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    expect(await page.locator(".home-bottom-nav").boundingBox()).toEqual(navBeforeScroll);
    const overlap = await page.evaluate(
      () =>
        document.querySelector(".home-game-coup")!.getBoundingClientRect().bottom -
        document.querySelector(".home-bottom-nav")!.getBoundingClientRect().top,
    );
    expect(overlap).toBeLessThanOrEqual(0);
    await page.screenshot({ path: info.outputPath(`home-bottom-${size.width}.png`) });
  });
}

test("fantasy header stays below native controls and the dock respects bottom insets", async ({
  page,
  request,
}) => {
  await setup(page, request);
  await launch(page);
  await expect(page.locator(".home-header")).toBeVisible();
  await nativeEvent(page, "safe_area_changed", { top: 47, bottom: 34, left: 0, right: 0 });
  await nativeEvent(page, "content_safe_area_changed", { top: 56, bottom: 0, left: 0, right: 0 });
  const geometry = await page.evaluate(async () => {
    const header = document.querySelector(".home-header")!.getBoundingClientRect();
    const actions = [...document.querySelectorAll(".home-header-actions button")].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, width: r.width, height: r.height };
    });
    const dock = document.querySelector(".home-bottom-nav")!.getBoundingClientRect();
    const icon = document.querySelector(".lobby-icon")!;
    const url = /url\(["']?([^"')]+)/.exec(getComputedStyle(icon).backgroundImage)![1]!;
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      headerTop: header.top,
      actions,
      bottomSpace: innerHeight - dock.bottom,
      iconLoaded: true,
    };
  });
  expect(geometry.headerTop).toBeGreaterThanOrEqual(111);
  expect(geometry.actions[0]).toEqual(geometry.actions[1]);
  expect(geometry.bottomSpace).toBeGreaterThanOrEqual(34);
  expect(geometry.iconLoaded).toBe(true);
});

test("auth and profile loading never reveal a guessed home identity", async ({
  page,
  request,
}, info) => {
  await setup(page, request);
  let releaseAuth!: () => void;
  let releaseProfile!: () => void;
  const authGate = new Promise<void>((resolve) => {
    releaseAuth = resolve;
  });
  const profileGate = new Promise<void>((resolve) => {
    releaseProfile = resolve;
  });
  await page.route("https://api-staging.hambazi.top/**", async (route) => {
    const incoming = route.request();
    const url = new URL(incoming.url());
    await (url.pathname === "/v1/me" ? profileGate : authGate);
    const response = await request.fetch(`${fixtureOrigin}${url.pathname}`, {
      method: incoming.method(),
      data: incoming.postData() ?? undefined,
      headers: { "content-type": "application/json" },
    });
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "access-control-allow-origin": "https://staging.hambazi.top",
      },
    });
  });
  const query = new URLSearchParams({
    tgWebAppData: "test=synthetic&auth_date=1791612000",
    tgWebAppVersion: "8.0",
    tgWebAppPlatform: "ios",
  });
  await page.goto(`https://staging.hambazi.top/?${query}#${query}`);
  await expect(page.locator(".hambazi-loading")).toBeVisible();
  await expect(page.locator(".midnight-header,.home-header")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "تنظیمات", exact: true })).toHaveCount(0);
  await expect(page.locator(".home-identity,.home-game-grid")).toHaveCount(0);
  for (const size of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 320 },
  ]) {
    await page.setViewportSize(size);
    await page.locator(".hambazi-loading-art").evaluate((el) => (el as HTMLImageElement).decode());
    const content = await page.locator(".hambazi-loading-content").boundingBox();
    const footer = await page.locator(".hambazi-loading-footer").boundingBox();
    expect(content!.y).toBeGreaterThanOrEqual(0);
    expect(content!.y + content!.height).toBeLessThanOrEqual(footer!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      size.width,
    );
    await page.screenshot({ path: info.outputPath(`fantasy-loading-${size.width}.png`) });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".hambazi-loading-orbit")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page.setViewportSize({ width: 390, height: 844 });
  releaseAuth();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/games");
  await expect(page.locator(".hambazi-loading")).toBeVisible();
  await expect(page.locator(".midnight-header,.home-header")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "تنظیمات", exact: true })).toHaveCount(0);
  await expect(page.locator(".home-identity,.home-game-grid")).toHaveCount(0);
  releaseProfile();
  await expect(page.locator(".home-game-grid")).toBeVisible();
  await expect(page.locator(".home-header")).toBeVisible();
  await expect(page.locator(".hambazi-loading")).toHaveCount(0);
});

for (const endpoint of ["registered-session-photo", "me"]) {
  test(`${endpoint} failure leaves the loader and supports retry`, async ({ page, request }) => {
    await setup(page, request);
    let fail = true;
    await page.route(`https://api-staging.hambazi.top/**/${endpoint}`, async (route) => {
      if (fail) {
        fail = false;
        await route.abort();
      } else await route.fallback();
    });
    await launch(page);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator(".hambazi-loading,.home-game-grid")).toHaveCount(0);
    await page.getByRole("button", { name: "تلاش دوباره", exact: true }).click();
    await expect(page.locator(".home-game-grid")).toBeVisible();
    await expect(page.locator(".hambazi-loading")).toHaveCount(0);
  });
}

test("launch loading lasts at least three seconds with fast server responses", async ({
  page,
  request,
}) => {
  await setup(page, request);
  await page.addInitScript(() => {
    const timings = { loading: 0, home: 0, leaving: 0, leakedHeader: false };
    Object.assign(window, { launchTimings: timings });
    new MutationObserver(() => {
      if (!timings.loading && document.querySelector(".hambazi-loading"))
        timings.loading = performance.now();
      if (document.querySelector(".hambazi-loading.is-leaving")) {
        timings.leaving ||= performance.now();
        timings.leakedHeader ||= !!document.querySelector(".home-header");
      }
      if (!timings.home && document.querySelector(".home-game-grid"))
        timings.home = performance.now();
    }).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  });
  await launch(page);
  await expect(page.locator(".home-game-grid")).toBeVisible();
  const duration = await page.evaluate(() => {
    const timings = (window as unknown as { launchTimings: { loading: number; home: number } })
      .launchTimings;
    return timings.home - timings.loading;
  });
  expect(duration).toBeGreaterThanOrEqual(2900);
  const transition = await page.evaluate(
    () =>
      (
        window as unknown as {
          launchTimings: { leaving: number; home: number; leakedHeader: boolean };
        }
      ).launchTimings,
  );
  expect(transition.leaving).toBeGreaterThan(0);
  expect(transition.home - transition.leaving).toBeGreaterThanOrEqual(300);
  expect(transition.leakedHeader).toBe(false);
  // The arrival must not create a containing block for the fixed lobby dock.
  expect(
    await page.locator(".hambazi-launch-arrival").evaluate((el) => getComputedStyle(el).transform),
  ).toBe("none");
  await expect(page.locator("html")).toHaveAttribute("data-fitted-page", "true");
  const dock = await page.locator(".home-bottom-nav").boundingBox();
  const width = await page.evaluate(() => innerWidth);
  expect(dock!.x).toBeGreaterThanOrEqual(0);
  expect(dock!.x + dock!.width).toBeLessThanOrEqual(width);
  await expect(page.locator(".hambazi-loading")).toHaveCount(0);
  await expect(page.locator(".home-header")).toBeVisible();
});
