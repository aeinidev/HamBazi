import { test, expect, type Page } from "@playwright/test";
import { readTelegramSdk } from "../browser/telegram-sdk.js";
import { telegramSdkUrl, telegramSdkIntegrity } from "../../src/platform/telegram-sdk.js";

const appOrigin = "http://127.0.0.1:4173";
const framedOrigin = "https://mini.example";
const hash = new URLSearchParams({
  tgWebAppData:
    "query_id=SYNTHETIC_CSP_CANARY&user=%7B%22id%22%3A123456%7D&auth_date=1&hash=synthetic",
  tgWebAppVersion: "9.0",
  tgWebAppPlatform: "web",
  tgWebAppThemeParams: '{"bg_color":"#ffffff","text_color":"#000000"}',
}).toString();
let sdk: string;
declare global {
  interface Window {
    __cspDirectives: string[];
    __policyExecution?: boolean;
    __policyEval?: boolean;
    __policyInline?: boolean;
    __policyHandler?: boolean;
  }
}
test.beforeAll(async () => {
  sdk = await readTelegramSdk();
});
test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:4174/__test/reset");
});

async function prepare(page: Page) {
  await page.route(telegramSdkUrl, (route) =>
    route.fulfill({
      body: sdk,
      contentType: "application/javascript",
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
  await page.addInitScript(() => {
    window.__cspDirectives = [];
    // Collect only fixed directive names: never blocked URLs, samples or credentials.
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspDirectives.push(event.effectiveDirective);
    });
  });
}
async function open(page: Page) {
  await prepare(page);
  await page.goto(`/#${hash}`);
  await expect(
    page.getByRole("button", { name: "Continue with Telegram", exact: true }),
  ).toBeVisible();
}

async function mirrorFramedApp(page: Page) {
  // Preserve the actual built response and headers while avoiding the browser's
  // public-HTTPS-to-loopback network restriction in synthetic parent frames.
  await page.route(`${framedOrigin}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${appOrigin}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
}

test("built HTML enforces the generated headers and disables unused browser capabilities", async ({
  page,
  request,
}) => {
  const response = await request.get("/");
  expect(response.headers()["content-security-policy"]).toContain(
    `script-src 'self' '${telegramSdkIntegrity}'`,
  );
  expect(response.headers()["content-security-policy"]).toContain(
    "frame-ancestors https://web.telegram.org http://127.0.0.1:4175",
  );
  expect(response.headers()["content-security-policy"]).not.toMatch(
    /unsafe-eval|report-uri|report-to|report-sample|\*/,
  );
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["x-frame-options"]).toBeUndefined();
  for (const path of ["/room/synthetic", "/security-headers.json", "/__missing.css"]) {
    const other = await request.get(path);
    for (const name of [
      "content-security-policy",
      "cache-control",
      "referrer-policy",
      "x-content-type-options",
      "permissions-policy",
    ])
      expect(other.headers()[name]).toBe(response.headers()[name]);
  }
  await open(page);
  expect(
    await page.evaluate(() => {
      const policy = (
        document as Document & { featurePolicy: { allowsFeature(name: string): boolean } }
      ).featurePolicy;
      return [
        policy.allowsFeature("camera"),
        policy.allowsFeature("microphone"),
        policy.allowsFeature("geolocation"),
      ];
    }),
  ).toEqual([false, false, false]);
});

test("actual SDK sign-in, polling and WebSocket upgrade work with no CSP violations", async ({
  page,
}) => {
  let polling = false,
    upgrade = false;
  page.on("request", (request) => {
    polling ||= request.url().includes("transport=polling");
  });
  page.on("websocket", (socket) => {
    upgrade ||= socket.url().startsWith("ws://127.0.0.1:4174/v1/socket.io");
  });
  await open(page);
  await page.getByRole("button", { name: "Continue with Telegram", exact: true }).click();
  await expect(page.getByRole("link", { name: "Profile", exact: true })).toBeVisible();
  await expect.poll(() => polling && upgrade).toBe(true);
  expect(await page.evaluate(() => window.__cspDirectives)).toEqual([]);
});

test("inline scripts, event attributes and eval are blocked in browser-executed code", async ({
  page,
}) => {
  await open(page);
  await page.route("**/__policy-probe.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    window.__policyExecution = true;
    try { eval('window.__policyEval = true'); } catch {}
    try { new Function('window.__policyEval = true')(); } catch {}
    const script = document.createElement('script'); script.textContent = 'window.__policyInline = true'; document.head.appendChild(script);
    const button = document.createElement('button'); button.setAttribute('onclick', 'window.__policyHandler = true'); document.body.appendChild(button); button.click();
  `,
    }),
  );
  await page.evaluate(async (url) => {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("PROBE_LOAD_FAILED"));
      document.head.appendChild(script);
    });
  }, `${appOrigin}/__policy-probe.js`);
  await expect
    .poll(() => page.evaluate(() => window.__cspDirectives.length))
    .toBeGreaterThanOrEqual(3);
  expect(
    await page.evaluate(() => [
      window.__policyExecution,
      !!window.__policyEval,
      !!window.__policyInline,
      !!window.__policyHandler,
    ]),
  ).toEqual([true, false, false, false]);
});

test("unapproved network, CSS/image, frames, forms, bases and workers are denied", async ({
  page,
}) => {
  await open(page);
  let escaped = false;
  await page.route("https://untrusted.example/**", (route) => {
    escaped = true;
    return route.abort();
  });
  await page.evaluate(() => {
    void fetch("https://untrusted.example/exfil").catch(() => {});
    new WebSocket("wss://untrusted.example/socket").onerror = () => {};
    const image = document.createElement("img");
    image.src = "https://untrusted.example/image";
    document.body.appendChild(image);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://untrusted.example/style";
    document.head.appendChild(link);
    const frame = document.createElement("iframe");
    frame.src = "https://untrusted.example/frame";
    document.body.appendChild(frame);
    const base = document.createElement("base");
    base.href = "https://untrusted.example/";
    document.head.appendChild(base);
    const form = document.createElement("form");
    form.action = "https://untrusted.example/form";
    document.body.appendChild(form);
    form.submit();
    const worker = URL.createObjectURL(
      new Blob(["postMessage('synthetic')"], { type: "application/javascript" }),
    );
    try {
      new Worker(worker);
    } catch {
      // A synchronous CSP denial is also an expected outcome.
    } finally {
      URL.revokeObjectURL(worker);
    }
  });
  for (const directive of [
    "connect-src",
    "img-src",
    "style-src-elem",
    "frame-src",
    "base-uri",
    "form-action",
    "worker-src",
  ])
    await expect.poll(() => page.evaluate(() => window.__cspDirectives)).toContain(directive);
  expect(escaped).toBe(false);
  expect(await page.evaluate(() => document.baseURI.startsWith("http://127.0.0.1:4173/"))).toBe(
    true,
  );
  expect(await page.evaluate(() => !!document.querySelector("#root button"))).toBe(true);
});

test("the approved Telegram ancestor can load the SDK and apply its dynamic iframe style", async ({
  page,
}) => {
  await prepare(page);
  await mirrorFramedApp(page);
  await page.route("https://web.telegram.org/__policy-parent", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<iframe id="mini" src="${framedOrigin}/#${hash}"></iframe>`,
    }),
  );
  await page.goto("https://web.telegram.org/__policy-parent");
  const child = page.frameLocator("#mini");
  await expect(
    child.getByRole("button", { name: "Continue with Telegram", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>("#mini")!;
    frame.contentWindow!.postMessage(
      JSON.stringify({
        eventType: "set_custom_style",
        eventData: "body { --sdk-parent-style: verified; }",
      }),
      "https://mini.example",
    );
    frame.contentWindow!.postMessage(
      JSON.stringify({
        eventType: "theme_changed",
        eventData: { theme_params: { bg_color: "#000000", text_color: "#ffffff" } },
      }),
      "https://mini.example",
    );
  });
  await expect(child.locator("html")).toHaveAttribute("data-telegram-theme", "dark");
  const frame = page.frames().find((frame) => frame.url().startsWith(framedOrigin))!;
  await expect
    .poll(() =>
      frame.evaluate(() =>
        getComputedStyle(document.body).getPropertyValue("--sdk-parent-style").trim(),
      ),
    )
    .toBe("verified");
  expect(await frame.evaluate(() => window.__cspDirectives)).toEqual([]);
  expect(await frame.evaluate(() => location.href.includes("tgWebAppData"))).toBe(false);
});

test("an unapproved ancestor is blocked before SDK or application execution", async ({ page }) => {
  await prepare(page);
  await mirrorFramedApp(page);
  let denied = false,
    sdkRequested = false;
  page.on("console", (message) => {
    denied ||= message.text().includes("frame-ancestors");
  });
  page.on("request", (request) => {
    sdkRequested ||= request.url() === telegramSdkUrl;
  });
  await page.route("https://untrusted.example/__policy-parent", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<iframe src="${framedOrigin}/#${hash}"></iframe>`,
    }),
  );
  await page.goto("https://untrusted.example/__policy-parent");
  await expect.poll(() => denied).toBe(true);
  expect(sdkRequested).toBe(false);
});

test("an external SDK tag without matching integrity metadata is blocked by CSP", async ({
  page,
}) => {
  await open(page);
  let fetched = false;
  await page.route(telegramSdkUrl, (route) => {
    fetched = true;
    return route.abort();
  });
  await expect(page.addScriptTag({ url: telegramSdkUrl })).rejects.toThrow();
  expect(fetched).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__cspDirectives)).toContain("script-src-elem");
});
