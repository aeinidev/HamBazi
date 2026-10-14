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
  it("opens the private lobby without public gameplay navigation or realtime", () => {
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
    expect(html).toContain("بازی‌ها");
    expect(html).toContain("Synthetic owner");
    expect(html).toContain("fallback-avatar");
    expect(html).toContain("کودتا، موقتاً غیرفعال");
    for (const name of ["حکم", "کهربا", "شطرنج", "دومینو", "منچ"])
      expect(html).toContain(`${name}، به‌زودی`);
    expect(html).toContain("بازی پیدا کن، به‌زودی");
    expect(html).toContain("همه را ببینید، به‌زودی");
    expect(html).toContain("جدول، به‌زودی");
    expect(html).toContain("دوستان، به‌زودی");
    expect(html.match(/disabled=""/g)).toHaveLength(11);
    expect(html).toContain('href="#/profile"');
    expect(html).toContain('href="#/games"');
    expect(html).not.toContain('aria-label="Main navigation"');
    expect(html).not.toContain("Reconnect");
    expect(html).not.toContain("Match session");
    runtime.dispose();
  });
  it("renders the session photo beside the authenticated saved name", () => {
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
    expect(html).toContain("Chosen");
    expect(html).toContain("https://t.me/i/userpic/320/synthetic.jpg");
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
