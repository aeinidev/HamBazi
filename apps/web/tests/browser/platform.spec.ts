import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const fixture = "http://127.0.0.1:4174";
const roomId = "22222222-2222-4222-8222-222222222222";
const matchId = "33333333-3333-4333-8333-333333333333";
async function launch(page: Page, invite = false) {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({ body: "", contentType: "text/javascript" }),
  );
  await page.addInitScript(
    ({ invite }) => {
      window.Telegram = {
        WebApp: {
          initData: invite ? `start_param=room_${"A".repeat(43)}&test=synthetic` : "test=synthetic",
          colorScheme: "light",
          viewportStableHeight: window.innerHeight,
          ready() {},
          expand() {},
          onEvent() {},
          offEvent() {},
          BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        },
      };
    },
    { invite },
  );
  await page.goto("/");
}
async function signIn(page: Page) {
  await launch(page);
  await page.getByRole("button", { name: "Continue with Telegram" }).click();
  await expect(page.getByRole("heading", { name: "Games", exact: true })).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
}
async function enterMatch(page: Page) {
  await signIn(page);
  await page.evaluate((id) => {
    location.hash = `/match/${id}`;
  }, matchId);
  await expect(
    page.getByRole("heading", { name: /At the table|Watching the table/ }),
  ).toBeVisible();
}
test.beforeEach(async ({ request }) => {
  await request.post(`${fixture}/__test/reset`);
});
test("Telegram-only entry is accessible and keeps a narrow viewport", async ({ page }, info) => {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({ body: "", contentType: "text/javascript" }),
  );
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await expect(
    page.getByText("Open HamBazi from Telegram to sign in and play with friends."),
  ).toBeVisible();
  await expect(
    page.getByText("Local preview · synthetic Telegram identity and server data"),
  ).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("entry-mobile.png"), fullPage: true });
});
test("direct Coup preview route is inert in the ordinary app", async ({ page }) => {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({ body: "", contentType: "text/javascript" }),
  );
  await page.goto("/#/preview/coup");
  await expect(
    page.getByText("Open HamBazi from Telegram to sign in and play with friends."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "At the table" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Coup table" })).toHaveCount(0);
});
test("catalog mode comes from server and cancel-vs-match leads to the committed match", async ({
  page,
  request,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: /Coup/ }).click();
  await expect(page.getByLabel("Mode")).toHaveValue("server-choice");
  await page.getByLabel("Players").selectOption("4");
  await page.getByRole("button", { name: "Find players" }).click();
  await expect(page.getByRole("heading", { name: "Finding your people…" })).toBeVisible();
  expect((await (await request.get(`${fixture}/__test/state`)).json()).search).toMatchObject({
    mode: "server-choice",
    capacity: 4,
  });
  await request.post(`${fixture}/__test/state`, { data: { ticketStatus: "MATCHED" } });
  await page.getByRole("button", { name: "Cancel search" }).click();
  await expect(page.getByRole("button", { name: "Join match" })).toBeVisible();
  await page.getByRole("button", { name: "Join match" }).click();
  await expect(page.getByRole("heading", { name: "At the table" })).toBeVisible();
  await request.post(`${fixture}/__test/state`, {
    data: { role: "SPECTATOR", snapshotVersion: 3 },
  });
  await request.post(`${fixture}/__test/disconnect`);
  await expect(page.getByRole("heading", { name: "Watching the table" })).toBeVisible();
  await request.post(`${fixture}/__test/state`, { data: { role: "PLAYER", snapshotVersion: 1 } });
  await request.post(`${fixture}/__test/snapshot`);
  await expect(page.getByRole("heading", { name: "Watching the table" })).toBeVisible();
});
test("old catalog has no invented mode and disabled catalog cannot admit", async ({
  page,
  request,
}) => {
  await request.post(`${fixture}/__test/state`, { data: { modes: null, playable: false } });
  await signIn(page);
  await page.getByRole("link", { name: /Coup/ }).click();
  await expect(page.getByLabel("Mode")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Find players" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Invite friends" })).toBeDisabled();
});
test("ambiguous room create retries with the same command and shows host/roster/start state", async ({
  page,
  request,
}) => {
  await request.post(`${fixture}/__test/state`, { data: { failCreate: true } });
  await signIn(page);
  await page.getByRole("link", { name: /Coup/ }).click();
  await page.getByRole("button", { name: "Invite friends" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your room" })).toBeVisible();
  const state = await (await request.get(`${fixture}/__test/state`)).json();
  expect(state.createIds).toHaveLength(2);
  expect(new Set(state.createIds).size).toBe(1);
  await expect(page.getByRole("button", { name: "Start match" })).toBeDisabled();
  await page.getByRole("button", { name: "Get invite link" }).click();
  await expect(page.getByLabel("Invite link")).toHaveValue(/^https:\/\/t.me\//);
  await request.post(`${fixture}/__test/state`, { data: { roomStatus: "FULL", roomVersion: 2 } });
  await page.getByRole("button", { name: "Refresh room" }).click();
  await expect(page.getByRole("button", { name: "Start match" })).toBeEnabled();
  await page.getByRole("button", { name: "Start match" }).click();
  await expect(page.getByText("Waiting for the server to start your match…")).toBeVisible();
});
test("invite survives account creation and grants membership only on explicit join", async ({
  page,
  request,
}) => {
  await launch(page, true);
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByLabel("Display name").fill("مهدی");
  await page.getByRole("button", { name: "Create account & continue" }).click();
  await expect(page.getByRole("heading", { name: "You’re invited" })).toBeVisible();
  expect(
    (await (await request.get(`${fixture}/__test/state`)).json()).commands.some(
      (c: { event: string }) => c.event === "room:join",
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Join room" }).click();
  await expect(page).toHaveURL(new RegExp(`/rooms/${roomId}`));
  await expect(page.getByRole("heading", { name: "Your room" })).toBeVisible();
});
test("profile escapes text, reports conflict and clears private state on logout", async ({
  page,
  request,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await page.getByLabel("Display name").fill("<img src=x onerror=alert(1)>");
  await page.getByLabel("Appearance").selectOption("dark");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.locator("main img").count()).toBe(0);
  await request.post(`${fixture}/__test/state`, { data: { conflict: true } });
  await page.getByLabel("Display name").fill("Another name");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText("Your profile changed");
  await expect(page.getByRole("alert")).not.toContainText("private debug");
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByText("Open HamBazi from Telegram to sign in and play with friends."),
  ).toBeVisible();
  await expect(page.getByText("test_12345")).toHaveCount(0);
});
test("platform views pass accessibility and responsive checks", async ({ page }, info) => {
  await signIn(page);
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 812 });
    await page.screenshot({ path: info.outputPath(`catalog-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: /Coup/ }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await page.getByLabel("Appearance").selectOption("dark");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("profile-dark-200.png"), fullPage: true });
});

test("re-authentication preserves a direct Match route", async ({ page }) => {
  await launch(page);
  await page.goto("/#/match/33333333-3333-4333-8333-333333333333");
  await page.getByRole("button", { name: "Continue with Telegram" }).click();
  await expect(page.getByRole("heading", { name: "At the table" })).toBeVisible();
  await expect(page).toHaveURL(/#\/match\//);
});

test("Coup controls follow server legal commands through action, proof, exchange, block and finish", async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await enterMatch(page);
  await expect(page.getByRole("region", { name: "Your cards" })).toContainText("AMBASSADOR");
  expect(
    await page.getByRole("region", { name: "Seat 2" }).locator(".coup-card").allTextContents(),
  ).toEqual(["?", "?"]);
  await expect(
    page.getByRole("region", { name: "Available actions" }).getByRole("button"),
  ).toHaveCount(10);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("coup-action-mobile.png"), fullPage: true });
  await request.post(`${fixture}/__test/state`, { data: { nextPhase: "PROOF" } });
  await page.getByRole("button", { name: "declare tax" }).click();
  await expect(page.getByRole("button", { name: /prove claim/ })).toBeVisible();
  await request.post(`${fixture}/__test/state`, { data: { nextPhase: "EXCHANGE" } });
  await page.getByRole("button", { name: /prove claim/ }).click();
  await expect(page.getByRole("group", { name: "Choose cards to keep" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("coup-exchange-mobile.png"), fullPage: true });
  await page.getByRole("checkbox", { name: "Card 1: DUKE" }).check();
  await page.getByRole("checkbox", { name: "Card 2: CAPTAIN" }).check();
  await request.post(`${fixture}/__test/state`, { data: { nextPhase: "BLOCK" } });
  await page.getByRole("button", { name: "Keep selected cards" }).click();
  await expect(page.getByRole("button", { name: /block ·/ })).toBeVisible();
  await request.post(`${fixture}/__test/state`, { data: { nextPhase: "GAME_OVER" } });
  await page.getByRole("button", { name: /block ·/ }).click();
  await expect(page.getByText(/won the match/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Available actions" })).toHaveCount(0);
  const state = await (await request.get(`${fixture}/__test/state`)).json();
  const commands = state.commands.filter(
    (entry: { event: string }) => entry.event === "game:command",
  );
  expect(
    commands.map((entry: { input: { command: { type: string } } }) => entry.input.command.type),
  ).toEqual(["DECLARE_TAX", "PROVE_CLAIM", "SELECT_EXCHANGE", "BLOCK"]);
  expect(commands[2].input.command.cardIndices).toEqual([0, 1]);
  expect(
    commands.every(
      (entry: { input: { actionId: string; expectedVersion: number; schemaVersion: number } }) =>
        entry.input.schemaVersion === 1 &&
        !!entry.input.actionId &&
        Number.isInteger(entry.input.expectedVersion),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("coup-finish-mobile.png"), fullPage: true });
});

test("challenge and loss decisions come from the addressed player's projection", async ({
  page,
  request,
}) => {
  await request.post(`${fixture}/__test/state`, {
    data: { viewerIndex: 1, coupPhase: "CHALLENGE", snapshotVersion: 1 },
  });
  await enterMatch(page);
  await expect(page.getByRole("button", { name: "challenge", exact: true })).toBeVisible();
  await request.post(`${fixture}/__test/state`, { data: { nextPhase: "LOSS" } });
  await page.getByRole("button", { name: "challenge", exact: true }).click();
  await expect(page.getByRole("button", { name: /select card to lose/ })).toHaveCount(2);
  await page
    .getByRole("button", { name: /select card to lose/ })
    .first()
    .click();
  const state = await (await request.get(`${fixture}/__test/state`)).json();
  expect(
    state.commands.filter((entry: { event: string }) => entry.event === "game:command").at(-1).input
      .command.type,
  ).toBe("SELECT_CARD_TO_LOSE");
});

test("spectator, unsupported version and malformed view fail closed", async ({ page, request }) => {
  await request.post(`${fixture}/__test/state`, { data: { role: "SPECTATOR" } });
  await enterMatch(page);
  await expect(page.getByRole("heading", { name: "Watching the table" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your cards" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Available actions" })).toHaveCount(0);
  await request.post(`${fixture}/__test/state`, {
    data: { role: "PLAYER", rulesetVersion: "future", snapshotVersion: 3 },
  });
  await request.post(`${fixture}/__test/snapshot`);
  await expect(page.getByRole("alert")).toContainText("newer version");
  await expect(page.getByRole("region", { name: "Available actions" })).toHaveCount(0);
});
