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
      "https://api-staging.hambazi.top/v1/auth/telegram-mini-app/registered-session-photo",
      "https://api-staging.hambazi.top/v1/auth/logout",
    ]);
    runtime.dispose();
  });
  it("keeps the initial private lobby behind the approved launch gate", () => {
    vi.stubGlobal("window", { location: { hash: "" } });
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
    runtime.query.setQueryData(["lobby-availability", id], {
      schemaVersion: 1,
      lobbyAvailability: [
        ...["kahroba", "hokm", "domino", "chess", "ludo"].map((id) => ({
          id,
          state: "COMING_SOON",
        })),
        { id: "coup", state: "TEMPORARILY_DISABLED" },
      ],
    });
    vi.spyOn(runtime.store, "getInitialState").mockImplementation(runtime.store.getState);
    const html = renderToStaticMarkup(<App runtime={runtime} />);
    // Effects and the approved 3s launch gate do not advance during server rendering.
    // Post-launch lobby, identity and card behavior is covered by the Midnight browser suite.
    expect(html).toContain('aria-label="در حال بارگذاری هم‌بازی"');
    expect(html).not.toContain("Synthetic owner");
    expect(html).not.toContain("home-header");
    expect(html).not.toContain("home-game-grid");
    expect(html).not.toContain("Main navigation");
    runtime.dispose();
  });
  it("does not expose an available Kahroba card before launch completes", () => {
    vi.stubGlobal("window", { location: { hash: "#/games" } });
    vi.stubGlobal("location", { hash: "#/games" });
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
      displayName: "Chosen",
      settings: { theme: "system" },
    });
    runtime.query.setQueryData(["lobby-availability", id], {
      schemaVersion: 1,
      lobbyAvailability: [
        { id: "kahroba", state: "AVAILABLE" },
        { id: "coup", state: "TEMPORARILY_DISABLED" },
      ],
    });
    runtime.query.setQueryData(["kahroba-private-entry"], { enabled: true });
    vi.spyOn(runtime.store, "getInitialState").mockImplementation(runtime.store.getState);
    const html = renderToStaticMarkup(<App runtime={runtime} kahrobaEnabled />);
    expect(html).toContain('aria-label="در حال بارگذاری هم‌بازی"');
    expect(html).not.toContain('aria-label="کهربا، فعال"');
    expect(html).not.toContain("میز خصوصی کهربا");
    expect(html).not.toContain("kh-private-entry");
    runtime.dispose();
  });
  it("keeps the authenticated name and photo hidden until launch completes", () => {
    vi.stubGlobal("window", { location: { hash: "" } });
    const runtime = createRuntime(
      "https://api-staging.hambazi.top",
      "",
      vi.fn(),
      vi.fn(),
      "owner-auth",
    );
    runtime.store.setState({
      session: { schemaVersion: 1, sessionId: id, userId: id, expiresAt: 9999999999 },
      photoUrl: "https://t.me/i/userpic/320/synthetic.jpg",
    });
    runtime.query.setQueryData(["profile"], {
      displayName: "Chosen",
      settings: { theme: "system" },
    });
    vi.spyOn(runtime.store, "getInitialState").mockImplementation(runtime.store.getState);
    const html = renderToStaticMarkup(<App runtime={runtime} />);
    expect(html).toContain('aria-label="در حال بارگذاری هم‌بازی"');
    expect(html).not.toContain("Chosen");
    expect(html).not.toContain("https://t.me/i/userpic/320/synthetic.jpg");
    expect(html).not.toContain("fallback-avatar");
    runtime.dispose();
  });
  it.each(["/games", "/games/coup", "/games/coup/tutorial", "/games/coup/play", "/settings"])(
    "guards direct route %s before registration without creating a profile",
    (hash) => {
      vi.stubGlobal("window", { location: { hash: `#${hash}` } });
      const fetcher = vi.fn(),
        factory = vi.fn();
      const runtime = createRuntime(
        "https://api-staging.hambazi.top",
        "",
        fetcher,
        factory,
        "owner-auth",
      );
      runtime.store.setState({ registrationRequired: true });
      vi.spyOn(runtime.store, "getInitialState").mockImplementation(runtime.store.getState);
      const html = renderToStaticMarkup(<App runtime={runtime} />);
      expect(html).toContain("دوست داری با چه اسمی در بازی دیده بشی؟");
      expect(html).not.toContain("coup-entry-options");
      expect(html).not.toContain("midnight-catalog");
      expect(html).not.toContain("midnight-personal-game");
      expect(fetcher).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
      runtime.dispose();
    },
  );
});
