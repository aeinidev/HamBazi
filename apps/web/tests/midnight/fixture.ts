import { readFileSync } from "node:fs";
import { expect, type APIRequestContext, type Page, type WebSocketRoute } from "@playwright/test";
// UI transport fixture only: the actual engine/DB path is tested separately.
// The real production bundle and unmodified pinned Telegram SDK run in the browser.
const goldens = (
  JSON.parse(
    readFileSync(
      new URL(
        "../../../../packages/games/coup-engine/tests/fixtures/module-v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { goldens: Record<string, { players: Record<string, unknown>[] }> }
).goldens;
export const matchId = "33333333-3333-4333-8333-333333333333";
export const fixtureOrigin = "http://127.0.0.1:4174";
export async function setup(page: Page, request: APIRequestContext, viewerIndex = 0) {
  await request.post(`${fixtureOrigin}/__test/reset`);
  await request.post(`${fixtureOrigin}/__test/state`, { data: { viewerIndex } });
  const state = {
    current: null as string | null,
    customView: null as Record<string, unknown> | null,
    sentCommands: [] as Record<string, unknown>[],
    starts: [] as string[],
    events: [] as string[],
    http: [] as string[],
    sockets: [] as WebSocketRoute[],
    failStart: null as "before" | "after" | null,
    failCurrent: false,
    enforceSinglePending: false,
    holdNextCatchup: false,
    releaseCatchup: null as (() => void) | null,
    maximumPending: 0,
    rateRejections: 0,
    phase: "WAITING_FOR_ACTION",
    version: 2,
  };
  const snapshot = () => {
    const view = state.customView ?? goldens[state.phase]?.players[viewerIndex];
    if (!view) throw new Error("Missing synthetic view");
    return {
      schemaVersion: 1,
      matchId,
      stateVersion: state.version,
      lastEventSeq: state.version,
      status: state.phase === "GAME_OVER" ? "FINISHED" : "ACTIVE",
      role: "PLAYER",
      gameId: "coup",
      engineVersion: view.engineVersion,
      stateSchemaVersion: view.stateSchemaVersion,
      rulesetVersion: view.rulesetVersion,
      view: {
        ...view,
        deadlineAt: state.customView
          ? view.deadlineAt
          : view.deadlineAt === null
            ? null
            : Date.now() + 30000,
      },
    };
  };
  await page.route("https://staging.hambazi.top/**", async (route) => {
    const url = new URL(route.request().url());
    const response = await request.get(`http://127.0.0.1:4175${url.pathname}${url.search}`);
    await route.fulfill({ response });
  });
  await page.route("https://api-staging.hambazi.top/**", async (route) => {
    const incoming = route.request();
    const url = new URL(incoming.url());
    state.http.push(`${incoming.method()} ${url.pathname}`);
    const response = await request.fetch(`${fixtureOrigin}${url.pathname}${url.search}`, {
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
  await page.routeWebSocket(/wss:\/\/api-staging\.hambazi\.top\/v1\/personal\/socket\.io/, (ws) => {
    let pending = 0;
    state.sockets.push(ws);
    ws.send(
      '0{"sid":"synthetic-engine","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}',
    );
    ws.onMessage((message) => {
      const text = String(message);
      if (text.startsWith("40/personal-v1,")) {
        ws.send('40/personal-v1,{"sid":"synthetic-personal"}');
        return;
      }
      if (text === "2") {
        ws.send("3");
        return;
      }
      const packet = /^42\/personal-v1,(\d+)(\[.*\])$/.exec(text);
      if (!packet) return;
      const [event, input] = JSON.parse(packet[2]!) as [string, Record<string, unknown>];
      state.events.push(event);
      if (state.enforceSinglePending) {
        pending++;
        state.maximumPending = Math.max(state.maximumPending, pending);
      }
      const ack = (value: unknown) => {
        if (state.enforceSinglePending) pending--;
        ws.send(`43/personal-v1,${packet[1]}${JSON.stringify([value])}`);
      };
      if (state.enforceSinglePending && pending > 1) {
        state.rateRejections++;
        return ack({ ok: false, error: { code: "RATE_LIMITED", retryable: true } });
      }
      const ok = (value: unknown) => ack({ ok: true, value });
      const push = () =>
        ws.send(`42/personal-v1,${JSON.stringify(["match:snapshot", snapshot()])}`);
      if (event === "personal:current") {
        if (state.failCurrent) {
          state.failCurrent = false;
          return ack({ ok: false, error: { code: "NETWORK_ERROR", retryable: true } });
        }
        return ok({ schemaVersion: 1, matchId: state.current });
      }
      if (event === "personal:start") {
        state.starts.push(String(input.commandId));
        const fail = state.failStart;
        state.failStart = null;
        if (fail !== "before") state.current = matchId;
        if (fail) return ack({ ok: false, error: { code: "NETWORK_ERROR", retryable: true } });
        return ok(snapshot());
      }
      if (event === "match:subscribe") {
        ok({ schemaVersion: 1, matchId, role: "PLAYER" });
        push();
        return;
      }
      if (event === "match:catchup") {
        const reply = () =>
          ok({ schemaVersion: 1, mode: "SNAPSHOT", events: [], snapshot: snapshot() });
        if (state.holdNextCatchup) {
          state.holdNextCatchup = false;
          state.releaseCatchup = reply;
          return;
        }
        return reply();
      }
      if (event === "game:command" || event === "personal:close") {
        state.sentCommands.push(input);
        state.version++;
        state.phase = "GAME_OVER";
        ok({
          schemaVersion: 1,
          actionId: input.actionId,
          matchId,
          stateVersion: state.version,
          lastEventSeq: state.version,
          status: "FINISHED",
        });
        if (event === "personal:close") state.current = null;
        else push();
        return;
      }
      ack({ ok: false, error: { code: "INVALID_INPUT", retryable: false } });
    });
  });
  return state;
}
export async function launch(page: Page, path = "/games") {
  const query = new URLSearchParams({
    tgWebAppData: "test=synthetic&auth_date=1791612000",
    tgWebAppVersion: "8.0",
    tgWebAppPlatform: "ios",
  });
  await page.goto(`https://staging.hambazi.top/?${query}#${query}`);
  await expect(page.locator(".midnight-shell")).toBeVisible();
  if (path !== "/games") {
    await expect(
      page
        .getByRole("heading", { name: "بازی‌ها", exact: true })
        .or(page.getByRole("button", { name: "بازگشت به ربات" })),
    ).toBeVisible();
    await page.evaluate((path) => {
      location.hash = path;
    }, path);
  }
}
export async function nativeEvent(page: Page, name: string, data: unknown = {}) {
  await page.evaluate(
    ({ name, data }) => {
      const telegram = window.Telegram as unknown as {
        WebView: { receiveEvent(name: string, data: unknown): void };
      };
      telegram.WebView.receiveEvent(name, data);
    },
    { name, data },
  );
}
