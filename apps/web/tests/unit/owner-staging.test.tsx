import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../../src/app.js";
import { createRuntime } from "../../src/platform/runtime.js";

const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());
describe("temporary staging account scope", () => {
  it("retains memory-only login/logout while making no realtime or invitation attempt", async () => {
    const factory = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            tokenType: "Bearer",
            accessToken: "synthetic-token",
            session: { schemaVersion: 1, sessionId: id, userId: id, expiresAt: 9999999999 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ schemaVersion: 1, ok: true }), { status: 200 }),
      );
    const runtime = createRuntime(
      "https://api-staging.hambazi.top",
      `start_param=room_${"A".repeat(43)}`,
      fetcher,
      factory,
      "owner-auth",
    );
    await runtime.login(id);
    expect(runtime.store.getState().session?.userId).toBe(id);
    expect(runtime.store.getState().invite).toBeNull();
    expect(factory).not.toHaveBeenCalled();
    expect(JSON.stringify(runtime.store.getState())).not.toContain("synthetic-token");
    expect(() => runtime.realtime()).toThrow("UNAUTHENTICATED");
    await runtime.logout();
    expect(runtime.store.getState().session).toBeNull();
    expect(fetcher.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://api-staging.hambazi.top/v1/auth/telegram-mini-app",
      "https://api-staging.hambazi.top/v1/auth/logout",
    ]);
    runtime.dispose();
  });
  it("keeps public gameplay navigation closed and offers only personal bot tests", () => {
    vi.stubGlobal("window", { location: { hash: `#/match/${id}` } });
    const runtime = createRuntime(
      "https://api-staging.hambazi.top",
      "",
      vi.fn(),
      vi.fn(),
      "owner-auth",
    );
    runtime.store.setState({
      session: { schemaVersion: 1, sessionId: id, userId: id, expiresAt: 9999999999 },
    });
    runtime.query.setQueryData(["profile"], {
      displayName: "Synthetic owner",
      settings: { theme: "system" },
    });
    vi.spyOn(runtime.store, "getInitialState").mockImplementation(runtime.store.getState);
    const html = renderToStaticMarkup(<App runtime={runtime} />);
    expect(html).toContain("Synthetic owner");
    expect(html).toContain("Invitations are unavailable");
    expect(html).toContain("Start game with bot");
    expect(html).toContain("Personal test results do not enter leaderboards");
    expect(html).toContain("Sign out");
    expect(html).not.toContain('aria-label="Main navigation"');
    expect(html).not.toContain("Reconnect");
    expect(html).not.toContain("Match session");
    runtime.dispose();
  });
});
