import { test, expect, type Page, type Browser, type APIRequestContext } from "@playwright/test";
import { snapshotSchema, type Snapshot } from "../../src/platform/contracts.js";
import { visible, enabled, clickGameIntent } from "./support.js";

const control = "http://127.0.0.1:4176";
type Actor = { telegramUserId: number; displayName: string; initData: string };
async function command(request: APIRequestContext, path: string, data = {}) {
  const result = await request.post(`${control}${path}`, { data });
  expect(result.ok()).toBe(true);
  return result.json();
}
async function actor(request: APIRequestContext, startParam?: string): Promise<Actor> {
  return command(request, "/actor", startParam ? { startParam } : {});
}
function observe(page: Page) {
  const state: {
    snapshot: Snapshot | null;
    privateLeak: boolean;
    token: string;
    gameAcks: { ok: boolean; code?: string }[];
    snapshots: number;
  } = {
    snapshot: null,
    privateLeak: false,
    token: "",
    gameAcks: [],
    snapshots: 0,
  };
  page.on("response", (response) => {
    if (response.url().endsWith("/v1/auth/telegram-mini-app") && response.status() === 200)
      void response
        .json()
        .then((value) => {
          state.token = value.accessToken;
        })
        .catch(() => {});
  });
  page.on("websocket", (socket) => {
    const commands = new Set<string>();
    socket.on("framesent", (frame) => {
      if (typeof frame.payload !== "string") return;
      const match = /^42(?:\/v1,)?(\d+)\[/.exec(frame.payload);
      if (match) {
        try {
          const items = JSON.parse(frame.payload.slice(frame.payload.indexOf("[")));
          if (items[0] === "game:command") commands.add(match[1]!);
        } catch {
          /* Only packet IDs are retained; no command payload diagnostics. */
        }
      }
    });
    socket.on("framereceived", (frame) => {
      if (typeof frame.payload !== "string") return;
      const offset = frame.payload.indexOf("[");
      if (offset < 0) return;
      try {
        const items = JSON.parse(frame.payload.slice(offset));
        const acknowledgement = /^43(?:\/v1,)?(\d+)\[/.exec(frame.payload);
        if (acknowledgement && commands.delete(acknowledgement[1]!))
          state.gameAcks.push({
            ok: items[0]?.ok === true,
            ...(items[0]?.error?.code ? { code: items[0].error.code } : {}),
          });
        const input =
          items[0] === "match:snapshot" ? items[1] : (items[0]?.value?.snapshot ?? items[0]?.value);
        const parsed = snapshotSchema.safeParse(input);
        if (parsed.success) {
          state.snapshots++;
          // Check raw recipient data, before the client schema can strip extra fields.
          state.privateLeak ||=
            /"(?:deck|influence|seed|rng|stateJsonb|initData|accessToken)"/.test(
              JSON.stringify(input),
            );
          if (!state.snapshot || parsed.data.stateVersion >= state.snapshot.stateVersion)
            state.snapshot = parsed.data;
        }
      } catch {
        /* Non-Socket.IO frames are irrelevant; no frame contents are reported. */
      }
    });
  });
  return state;
}
async function launch(page: Page, person: Actor) {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({ body: "", contentType: "text/javascript" }),
  );
  await page.addInitScript(
    ({ initData }) => {
      window.Telegram = {
        WebApp: {
          initData,
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
    { initData: person.initData },
  );
  await page.goto("/");
}
async function account(page: Page, person: Actor) {
  await launch(page, person);
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByLabel("Display name").fill(person.displayName);
  await page.getByRole("button", { name: "Create account & continue" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
}
async function pair(browser: Browser, request: APIRequestContext) {
  const contexts = [await browser.newContext(), await browser.newContext()];
  const pages = [await contexts[0]!.newPage(), await contexts[1]!.newPage()];
  const observations = pages.map(observe);
  const people = [await actor(request), await actor(request)];
  return { contexts, pages, observations, people };
}
type Pair = Awaited<ReturnType<typeof pair>>;
async function openPrivate(f: Pair, request: APIRequestContext) {
  const host = f.pages[0]!,
    guest = f.pages[1]!;
  await account(host, f.people[0]!);
  await host.getByRole("link", { name: /Coup.*View lobby/ }).click();
  await host.getByRole("button", { name: "Invite friends" }).click();
  await expect(host.getByRole("heading", { name: "Your room" })).toBeVisible();
  await host.getByRole("button", { name: "Get invite link" }).click();
  const invite = new URL(await host.getByLabel("Invite link").inputValue()).searchParams.get(
    "startapp",
  )!;
  f.people[1] = await actor(request, invite);
  await account(guest, f.people[1]);
  await expect(guest.getByRole("heading", { name: "You’re invited" })).toBeVisible();
  await guest.getByRole("button", { name: "Join room" }).click();
  await expect(guest.getByRole("heading", { name: "Your room" })).toBeVisible();
  await expect(guest.getByRole("button", { name: "Start match" })).toHaveCount(0);
  await host.getByRole("button", { name: "Refresh room" }).click();
  await expect(host.getByRole("button", { name: "Start match" })).toBeEnabled();
  await host.getByRole("button", { name: "Start match" }).click();
  await expect(host.getByRole("link", { name: "Open match" })).toBeVisible();
  await guest.getByRole("button", { name: "Refresh room" }).click();
  await expect(guest.getByRole("link", { name: "Open match" })).toBeVisible();
  await host.getByRole("link", { name: "Open match" }).click();
  await guest.getByRole("link", { name: "Open match" }).click();
}
async function ready(f: Pair) {
  for (const page of f.pages) {
    await enabled(page.getByRole("button", { name: "I’m ready" }));
    const before = Math.max(...f.observations.map((value) => value.snapshot?.stateVersion ?? 0));
    await page.getByRole("button", { name: "I’m ready" }).click();
    // Let both recipients receive the new version before constructing the next intent.
    await expect
      .poll(() => f.observations.every((value) => (value.snapshot?.stateVersion ?? 0) > before))
      .toBe(true);
  }
  for (const page of f.pages)
    await visible(page.getByRole("region", { name: "Available actions" }));
  await expect
    .poll(() => f.observations.every((value) => value.snapshot?.status === "ACTIVE"))
    .toBe(true);
  return f.observations[0]!.snapshot!.matchId;
}
async function attemptMove(f: Pair) {
  for (const label of [/^select card to lose/, /^declare coup/, /^declare income$/]) {
    for (const [index, page] of f.pages.entries()) {
      const buttons = page
        .getByRole("region", { name: "Available actions" })
        .getByRole("button", { name: label });
      for (const button of await buttons.all()) {
        const observation = f.observations[index]!;
        const receipts = observation.gameAcks.length;
        const snapshots = observation.snapshots;
        const revision = (observation.snapshot?.view as { revision: number }).revision;
        if (await clickGameIntent(button)) {
          await expect.poll(() => observation.gameAcks.length > receipts).toBe(true);
          const acknowledgement = observation.gameAcks.at(-1)!;
          if (!acknowledgement.ok) {
            expect(acknowledgement.code).toBe("GAME_STATE_CONFLICT");
            await expect.poll(() => observation.snapshots > snapshots).toBe(true);
            await enabled(button);
            return null; // Definitive rejection; the UI synchronizes before a new intent.
          }
          await expect
            .poll(() =>
              f.observations.every(
                (value) =>
                  ((value.snapshot?.view as { revision?: number } | null)?.revision ?? 0) >
                  revision,
              ),
            )
            .toBe(true);
          // Both rendered tables must catch up before choosing the next player's intent.
          await expect
            .poll(() => new Set(f.observations.map((value) => value.snapshot?.stateVersion)).size)
            .toBe(1);
          return index;
        }
      }
    }
  }
  throw new Error("No permitted browser move became available");
}
async function move(f: Pair): Promise<number> {
  for (let retry = 0; retry < 5; retry++) {
    const actor = await attemptMove(f);
    if (actor !== null) return actor;
  }
  throw new Error("Release game intent conflicts exceeded the retry bound");
}
async function finish(f: Pair) {
  for (let step = 0; step < 80; step++) {
    if (f.observations.every((value) => value.snapshot?.status === "FINISHED")) break;
    await move(f);
  }
  for (const page of f.pages)
    await visible(page.getByRole("link", { name: "View your statistics" }));
  expect(f.observations.every((value) => value.snapshot?.status === "FINISHED")).toBe(true);
}
async function durable(request: APIRequestContext, matchId: string) {
  const response = await request.get(`${control}/audit/match/${matchId}`);
  expect(response.ok()).toBe(true);
  return response.json();
}
async function statistics(f: Pair, request: APIRequestContext, matchId: string) {
  await expect.poll(async () => (await durable(request, matchId)).applications).toBe(1);
  const saved = await durable(request, matchId);
  expect(saved).toMatchObject({
    status: "FINISHED",
    seats: 2,
    results: 1,
    resultSeats: 2,
    finishEvents: 1,
    applications: 1,
  });
  expect(saved.events).toBe(saved.lastEventSeq);
  for (const page of f.pages) {
    await page.getByRole("link", { name: "View your statistics" }).click();
    await expect(page.getByText(/Played: 1 · Wins: [01] · Losses: [01]/)).toBeVisible();
    await page.getByRole("link", { name: "Coup leaderboard", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Coup leaderboard", exact: true }),
    ).toBeVisible();
    for (const person of f.people)
      await expect(page.getByRole("cell", { name: person.displayName, exact: true })).toBeVisible();
  }
  expect(f.observations.some((value) => value.privateLeak)).toBe(false);
  for (const [index, page] of f.pages.entries()) {
    const values = [f.people[index]!.initData, f.observations[index]!.token];
    expect(values.every((value) => value.length > 0)).toBe(true);
    expect(
      await page.evaluate(
        (secrets) =>
          [localStorage, sessionStorage].some((storage) =>
            Object.values(storage).some((value) =>
              secrets.some((secret) => String(value).includes(secret)),
            ),
          ),
        values,
      ),
    ).toBe(false);
  }
}

test("Account → Invite → real Coup → Finish → durable Worker statistics", async ({
  browser,
  request,
}) => {
  const f = await pair(browser, request);
  try {
    await test.step("Private onboarding and admission", () => openPrivate(f, request));
    const matchId = await test.step("Explicit player readiness", () => ready(f));
    await f.pages[0]!.getByLabel("Message", { exact: true }).fill("<b>Release chat</b>");
    await f.pages[0]!.getByRole("button", { name: "Send message", exact: true }).click();
    await visible(f.pages[1]!.getByText("<b>Release chat</b>", { exact: true }));
    expect(await f.pages[1]!.locator(".chat-messages b").count()).toBe(0);
    // Stop/reconstruct the actual Worker before finish: durable outbox/queue truth survives.
    await test.step("Worker reconstruction", async () => {
      await command(request, "/worker/stop");
      await command(request, "/worker/start");
    });
    await test.step("Coup play to finish", () => finish(f), { timeout: 60000 });
    await test.step("Durable results and statistics", () => statistics(f, request, matchId));
    expect((await durable(request, matchId)).roomStatus).toBe("CLOSED");
  } finally {
    await Promise.all(f.contexts.map((context) => context.close()));
  }
});

test("Account → Find → real Coup with offline catch-up → Finish → Stats", async ({
  browser,
  request,
}) => {
  const f = await pair(browser, request);
  try {
    for (const [index, page] of f.pages.entries()) {
      await account(page, f.people[index]!);
      await page.getByRole("link", { name: /Coup.*View lobby/ }).click();
      await page.getByRole("button", { name: "Find players" }).click();
    }
    for (const page of f.pages) {
      await expect(page.getByRole("button", { name: "Join match" })).toBeEnabled();
      await page.getByRole("button", { name: "Join match" }).click();
    }
    const matchId = await ready(f);
    // Queue reservation order can differ from browser launch order. Disconnect
    // browser zero only after its actual turn, leaving browser one able to act.
    if ((await move(f)) !== 0) expect(await move(f)).toBe(0);
    await enabled(f.pages[1]!.getByRole("button", { name: "declare income", exact: true }));
    const before = f.observations[0]!.snapshot!.stateVersion;
    await f.contexts[0]!.setOffline(true);
    // Chromium offline emulation does not reliably close an established WebSocket.
    // A real API drain/restart closes it; the offline recipient cannot reconnect.
    await command(request, "/api/restart");
    await visible(f.pages[0]!.getByText("Synchronizing the table…", { exact: true }));
    // Disconnect drops the snapshot, so no stale game action remains available.
    await expect.poll(() => f.pages[0]!.getByRole("button", { name: /^declare/ }).count()).toBe(0);
    // Seat two acts while seat one's browser misses the committed invalidation.
    await visible(f.pages[1]!.getByText("Connected", { exact: true }));
    await expect
      .poll(async () => {
        const snapshot = f.observations[1]!.snapshot;
        const view = snapshot?.view as { legalCommands?: { type: string }[] } | null;
        return {
          wireActive: snapshot?.status === "ACTIVE",
          wirePlayer: snapshot?.role === "PLAYER",
          wireIncome:
            view?.legalCommands?.some((command) => command.type === "DECLARE_INCOME") ?? false,
          renderedIncome: await f.pages[1]!.getByRole("button", {
            name: "declare income",
            exact: true,
          }).count(),
          synchronizing: await f.pages[1]!.getByText("Synchronizing the table…", {
            exact: true,
          }).count(),
        };
      })
      .toEqual({
        wireActive: true,
        wirePlayer: true,
        wireIncome: true,
        renderedIncome: 1,
        synchronizing: 0,
      });
    await f.pages[1]!.getByRole("button", { name: "declare income", exact: true }).click();
    await expect.poll(() => (f.observations[1]!.snapshot?.stateVersion ?? 0) > before).toBe(true);
    await f.contexts[0]!.setOffline(false);
    await expect
      .poll(
        () =>
          f.observations[0]!.snapshot?.stateVersion === f.observations[1]!.snapshot?.stateVersion,
      )
      .toBe(true);
    await finish(f);
    await statistics(f, request, matchId);
    expect((await durable(request, matchId)).matchType).toBe("MATCHMAKING");
  } finally {
    await Promise.all(f.contexts.map((context) => context.close()));
  }
});

test("invalid signed Telegram launch cannot create an account", async ({ page, request }) => {
  const person = await actor(request);
  const fields = new URLSearchParams(person.initData);
  fields.set("user", JSON.stringify({ id: person.telegramUserId + 1, first_name: "Forged" }));
  await launch(page, { ...person, initData: fields.toString() });
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByLabel("Display name").fill(person.displayName);
  const result = page.waitForResponse((response) =>
    response.url().endsWith("/v1/auth/telegram-mini-app/account"),
  );
  await page.getByRole("button", { name: "Create account & continue" }).click();
  expect((await result).status()).toBe(401);
  await expect(page.getByRole("alert")).toBeVisible();
  const saved = await (await request.get(`${control}/audit/actor/${person.telegramUserId}`)).json();
  expect(saved.userId).toBeNull();
});

test("lost create response retries one intent; node drain denies mutation and restart preserves room", async ({
  page,
  request,
}) => {
  const person = await actor(request);
  await account(page, person);
  await page.getByRole("link", { name: /Coup.*View lobby/ }).click();
  const ids: string[] = [];
  let lost = false;
  await page.route("http://127.0.0.1:4174/v1/rooms", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    ids.push(route.request().postDataJSON().commandId);
    const response = await route.fetch();
    if (!lost) {
      lost = true;
      expect(response.status()).toBe(201);
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Invite friends" }).click();
  await expect(page.getByRole("alert")).toContainText("Connection interrupted");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your room" })).toBeVisible();
  expect(lost).toBe(true);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(1);
  const audit = () =>
    request
      .get(`${control}/audit/actor/${person.telegramUserId}`)
      .then((response) => response.json());
  expect((await audit()).rooms).toBe(1);
  const roomUrl = page.url();
  await command(request, "/api/drain");
  await page.getByRole("button", { name: "Leave room" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(page.url()).toBe(roomUrl);
  await command(request, "/api/restart");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh room" }).click();
  await expect(page.getByRole("heading", { name: "Your room" })).toBeVisible();
  expect((await audit()).rooms).toBe(1);
  // Drain returned a definitive denial, so the next leave is a new intent.
  await page.getByRole("button", { name: "Leave room", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Games", exact: true })).toBeVisible();
});
