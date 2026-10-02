import { afterEach, describe, expect, it, vi } from "vitest";
import { createErrorEnvelope } from "@hambazi/contracts";
import { createHttpApplication } from "../../src/composition/http.js";
import { createSafeLogger } from "../../src/composition/safe-logger.js";
import { authPaths, type RateDecision } from "../../src/auth/index.js";
import { onboardingFixture } from "../auth/onboarding-fixtures.js";
import { initData, commandId, now, userId } from "../auth/session-fixtures.js";

const opened: Awaited<ReturnType<typeof createHttpApplication>>[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((http) => http.app.close()));
});
async function setup(production = false) {
  const f = onboardingFixture();
  const logs: string[] = [];
  const ip = vi.fn(async (_ip: string): Promise<RateDecision> => ({ allowed: true }));
  const identity = vi.fn(async (_id: string): Promise<RateDecision> => ({ allowed: true }));
  const create = vi.spyOn(f.onboarding, "create");
  const http = await createHttpApplication({
    auth: {
      sessions: f.service,
      onboarding: f.onboarding,
      clock: f.clock,
      telegram: f.telegram,
      limiter: { consumeIp: ip, consumeIdentity: identity },
    },
    allowedOrigins: ["https://mini.example"],
    trustedProxies: ["192.0.2.1"],
    production,
    logger: createSafeLogger({
      write: (line: string) => {
        logs.push(line);
      },
    }),
  });
  opened.push(http);
  const payload = {
    schemaVersion: 1,
    commandId,
    initData: initData(99, now, "room_synthetic"),
    displayName: "  Mehdi  ",
  };
  const post = (body: unknown = payload) =>
    http.server.inject({ method: "POST", url: authPaths.createAccount, payload: body as object });
  return { ...f, ...http, logs, ip, identity, createPort: create, payload, post };
}
describe("Mini App onboarding HTTP boundary", () => {
  it("creates an account and preserves invite context without issuing a token, cookie or session", async () => {
    const f = await setup();
    const response = await f.post();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 1,
      account: { displayName: "Mehdi", publicHandle: "mehdi_65022" },
      startParam: "room_synthetic",
    });
    expect(Object.keys(response.json()).sort()).toEqual(["account", "schemaVersion", "startParam"]);
    expect(f.rows.size).toBe(0);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect((await f.post({ ...f.payload, displayName: "Ignored" })).json()).toEqual(
      response.json(),
    );
    expect(f.identity).toHaveBeenCalledWith("99");
  });
  it("requires separate explicit session issuance and leaves unknown-user issuance unchanged", async () => {
    const f = await setup();
    const payload = { schemaVersion: 1, commandId, initData: f.payload.initData };
    expect(
      (await f.server.inject({ method: "POST", url: authPaths.issue, payload })).statusCode,
    ).toBe(401);
    expect(f.accountsByTelegram.has(99n)).toBe(false);
    expect((await f.post()).statusCode).toBe(200);
    expect(
      (await f.server.inject({ method: "POST", url: authPaths.issue, payload })).statusCode,
    ).toBe(200);
    expect(f.rows.size).toBe(1);
  });
  it.each([
    { schemaVersion: 2 },
    { commandId: "bad" },
    { displayName: null },
    { displayName: "" },
    { displayName: "x".repeat(257) },
    { userId },
    { telegramUserId: "42" },
    { publicHandle: "chosen" },
    { startParam: "room_forged" },
    { initDataUnsafe: { user: { id: 42 } } },
  ])("rejects invalid/injected DTO fields %# before application entry", async (patch) => {
    const f = await setup();
    expect((await f.post({ ...f.payload, ...patch })).statusCode).toBe(400);
    expect(f.createPort).not.toHaveBeenCalled();
  });
  it.each(["forged", initData(99, now - 301), initData(99, now + 31)])(
    "rejects invalid/stale/future initData %#",
    async (data) => {
      const f = await setup();
      expect((await f.post({ ...f.payload, initData: data })).statusCode).toBe(401);
      expect(f.identity).not.toHaveBeenCalled();
      expect(f.createPort).not.toHaveBeenCalled();
    },
  );
  it.each(["   ", "x\u202ey", "x\ny", "😀".repeat(41)])(
    "returns Users domain validation errors %#",
    async (displayName) => {
      const f = await setup();
      const response = await f.post({ ...f.payload, displayName });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(createErrorEnvelope("INVALID_INPUT"));
      expect(f.accountsByTelegram.has(99n)).toBe(false);
    },
  );
  it("preserves valid plain text without rendering or logging it", async () => {
    const f = await setup();
    const displayName = "<b>SENSITIVE</b>";
    expect((await f.post({ ...f.payload, displayName })).json().account.displayName).toBe(
      displayName,
    );
    expect(f.logs.join("")).not.toContain("SENSITIVE");
    expect(f.logs.join("")).not.toContain(f.payload.initData);
    expect(f.logs.join("")).not.toContain("room_synthetic");
    for (const line of f.logs)
      expect(Object.keys(JSON.parse(line)).sort()).toEqual([
        "durationMs",
        "event",
        "level",
        "operation",
        "requestId",
        "spanId",
        "traceId",
      ]);
  });
  it.each(["limited", "unavailable"] as const)(
    "fails admission closed on IP %s before parsing",
    async (reason) => {
      const f = await setup();
      f.ip.mockResolvedValue(
        reason === "limited"
          ? { allowed: false, reason, retryAfterSeconds: 17 }
          : { allowed: false, reason },
      );
      const response = await f.server.inject({
        method: "POST",
        url: authPaths.createAccount,
        headers: { "content-type": "application/json" },
        payload: "SENSITIVE invalid json",
      });
      expect(response.statusCode).toBe(reason === "limited" ? 429 : 503);
      if (reason === "limited") expect(response.headers["retry-after"]).toBe("17");
      expect(f.createPort).not.toHaveBeenCalled();
      expect(f.identity).not.toHaveBeenCalled();
      expect(f.logs.join("")).not.toContain("SENSITIVE");
    },
  );
  it.each(["limited", "unavailable"] as const)(
    "fails identity admission closed on %s",
    async (reason) => {
      const f = await setup();
      f.identity.mockResolvedValue(
        reason === "limited"
          ? { allowed: false, reason, retryAfterSeconds: 23 }
          : { allowed: false, reason },
      );
      const response = await f.post();
      expect(response.statusCode).toBe(reason === "limited" ? 429 : 503);
      expect(f.createPort).not.toHaveBeenCalled();
    },
  );
  it("charges both routes to the same identity limiter rather than per-route subjects", async () => {
    const f = await setup();
    await f.post();
    await f.server.inject({
      method: "POST",
      url: authPaths.issue,
      payload: { schemaVersion: 1, commandId, initData: f.payload.initData },
    });
    expect(f.identity.mock.calls).toEqual([["99"], ["99"]]);
    expect(f.ip.mock.calls).toEqual([["127.0.0.1"], ["127.0.0.1"]]);
  });
  it("enforces origin, HTTPS and trusted-proxy controls on the new route", async () => {
    const f = await setup(true);
    expect((await f.post()).statusCode).toBe(403);
    const input = {
      method: "POST" as const,
      url: authPaths.createAccount,
      payload: f.payload,
      remoteAddress: "192.0.2.1",
    };
    expect(
      (
        await f.server.inject({
          ...input,
          headers: { "x-forwarded-proto": "https", origin: "https://evil.example" },
        })
      ).statusCode,
    ).toBe(403);
    const response = await f.server.inject({
      ...input,
      headers: { "x-forwarded-proto": "https", origin: "https://mini.example" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["strict-transport-security"]).toBe("max-age=31536000");
  });
  it("rejects oversized multibyte initData, parser errors and query credentials safely", async () => {
    const f = await setup();
    expect((await f.post({ ...f.payload, initData: "é".repeat(8193) })).statusCode).toBe(400);
    for (const [body, type, status] of [
      ["SENSITIVE-invalid", "application/json", 400],
      ["x".repeat(32769), "application/json", 413],
      ["SENSITIVE", "text/xml", 415],
    ] as const) {
      const response = await f.server.inject({
        method: "POST",
        url: authPaths.createAccount,
        headers: { "content-type": type },
        payload: body,
      });
      expect(response.statusCode).toBe(status);
      expect(response.body).not.toContain("SENSITIVE");
    }
    expect(
      (
        await f.server.inject({
          method: "POST",
          url: `${authPaths.createAccount}?initData=SENSITIVE`,
          payload: f.payload,
        })
      ).statusCode,
    ).toBe(400);
    expect(f.createPort).not.toHaveBeenCalled();
  });
  it("sanitizes application failures and refuses malformed success projections", async () => {
    const f = await setup();
    f.createPort.mockRejectedValueOnce(new Error("SENSITIVE"));
    expect((await f.post()).statusCode).toBe(500);
    f.createPort.mockResolvedValueOnce(createErrorEnvelope("INTERNAL_ERROR"));
    expect((await f.post()).statusCode).toBe(503);
    f.createPort.mockResolvedValueOnce({
      ok: true,
      account: {
        schemaVersion: 1,
        userId: "bad",
        displayName: "Mehdi",
        publicHandle: "mehdi_65022",
      },
    });
    expect((await f.post()).statusCode).toBe(500);
    expect(f.logs.join("")).not.toContain("SENSITIVE");
  });
});
