import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createHttp } from "../../src/platform/http.js";
import { gameSchema } from "../../src/platform/contracts.js";
import { createRuntime } from "../../src/platform/runtime.js";
import { errorMessage } from "../../src/platform/errors.js";
const game = {
  id: "future",
  slug: "future",
  title: "New game",
  minPlayers: 2,
  maxPlayers: 4,
  status: "DISABLED",
  playable: false,
  matchmakingEnabled: false,
  privateRoomsEnabled: false,
  chatEnabled: false,
  voiceEnabled: false,
};
const id = "11111111-1111-4111-8111-111111111111";
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
describe("contract clients", () => {
  it("accepts old catalogs without guessing a mode and future server-owned modes", () => {
    expect(gameSchema.parse(game).matchmakingModes).toBeUndefined();
    expect(
      gameSchema.parse({
        ...game,
        matchmakingModes: [{ id: "future-mode", title: "New mode", extra: true }],
        extra: true,
      }).matchmakingModes,
    ).toEqual([{ id: "future-mode", title: "New mode" }]);
    expect(
      gameSchema.safeParse({ ...game, matchmakingModes: [{ id: "../bad", title: "Bad" }] }).success,
    ).toBe(false);
  });
  it("uses bearer headers with no cookie/cache and allows additive response fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ name: "ok", extra: "discard" }));
    const client = createHttp("https://api.example", () => "synthetic", vi.fn(), fetcher);
    expect(await client("/v1/me", z.object({ name: z.string() }))).toEqual({ name: "ok" });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer synthetic" },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
  });
  it("rejects malformed responses, bounds bodies and never reflects server messages", async () => {
    for (const value of [{ name: 10 }, { raw: "x".repeat(1048577) }]) {
      const client = createHttp(
        "https://api.example",
        () => "synthetic",
        vi.fn(),
        vi.fn<typeof fetch>().mockResolvedValue(json(value)),
      );
      await expect(client("/v1/me", z.object({ name: z.string() }))).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
    }
    const client = createHttp(
      "https://api.example",
      () => "synthetic",
      vi.fn(),
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          json(
            { ok: false, error: { code: "FUTURE_ERROR", message: "secret", retryable: false } },
            400,
          ),
        ),
    );
    const error = await client("/v1/me", z.object({})).catch((error: unknown) => error);
    expect(errorMessage(error)).not.toContain("secret");
  });
  it("clears auth only for the current credential and discards late successful reads", async () => {
    let token: string | null = "old";
    const expired = vi.fn();
    let resolve!: (value: Response) => void;
    const client = createHttp(
      "https://api.example",
      () => token,
      expired,
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const result = client("/v1/me", z.object({}));
    token = null;
    resolve(json({}));
    await expect(result).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(expired).not.toHaveBeenCalled();
    token = "new";
    const denied = createHttp(
      "https://api.example",
      () => token,
      expired,
      async () => json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401),
    );
    await expect(denied("/v1/me", z.object({}))).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(expired).toHaveBeenCalledOnce();
  });
  it("does not send unauthenticated private requests and sanitizes network failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret transport"));
    await expect(
      createHttp("https://api.example", () => null, vi.fn(), fetcher)("/v1/me", z.object({})),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      createHttp("https://api.example", () => "x", vi.fn(), fetcher)("/v1/me", z.object({})),
    ).rejects.toMatchObject({ message: "NETWORK_ERROR", retryable: true });
  });
});
describe("memory session lifetime", () => {
  it("expires credentials, socket state and query data together", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
    const close = vi.fn();
    const factory = vi.fn().mockReturnValue({ close });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        schemaVersion: 1,
        tokenType: "Bearer",
        accessToken: "synthetic-token",
        session: { schemaVersion: 1, sessionId: id, userId: id, expiresAt: 1002 },
      }),
    );
    const runtime = createRuntime("https://api.example", "synthetic-init", fetcher, factory);
    await runtime.login(id);
    runtime.query.setQueryData(["profile"], { name: "private" });
    expect(JSON.stringify(runtime.store.getState())).not.toContain("synthetic-token");
    await vi.advanceTimersByTimeAsync(2001);
    expect(runtime.store.getState().expired).toBe(true);
    expect(runtime.store.getState().session).toBeNull();
    expect(runtime.query.getQueryData(["profile"])).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
    runtime.dispose();
    vi.useRealTimers();
  });
  it("ignores authentication finishing after disposal and keeps launch hints non-authoritative", async () => {
    let resolve!: (value: Response) => void;
    const factory = vi.fn();
    const runtime = createRuntime(
      "https://api.example",
      `start_param=room_${"A".repeat(43)}`,
      () =>
        new Promise((r) => {
          resolve = r;
        }),
      factory,
    );
    expect(runtime.store.getState().invite).toBe(`room_${"A".repeat(43)}`);
    const login = runtime.login(id);
    runtime.dispose();
    resolve(
      json({
        schemaVersion: 1,
        tokenType: "Bearer",
        accessToken: "synthetic",
        session: { schemaVersion: 1, sessionId: id, userId: id, expiresAt: 9999999999 },
      }),
    );
    await expect(login).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(factory).not.toHaveBeenCalled();
    expect(runtime.store.getState().invite).toBeNull();
  });
  it("requires HTTPS except for explicit loopback development origins", () => {
    expect(() => createRuntime("http://example.com", "")).toThrow();
    expect(() => createRuntime("https://example.com/path", "")).toThrow();
    const runtime = createRuntime("http://127.0.0.1:4000", "");
    runtime.dispose();
  });
});
