import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { currentCorrelation } from "@hambazi/observability";
import { request } from "node:http";
import { withDeadline } from "@hambazi/observability";
import { createErrorEnvelope } from "@hambazi/contracts";
import { SecretValue } from "@hambazi/config";
import { createHttpApplication } from "../../src/composition/http.js";
import { createSafeLogger } from "../../src/composition/safe-logger.js";
import { authOpenApiDocument, authPaths } from "../../src/auth/index.js";
import type { AuthRateLimiter, RateDecision } from "../../src/auth/index.js";
import { initData, userId } from "../auth/session-fixtures.js";
import { onboardingFixture } from "../auth/onboarding-fixtures.js";

const active: Awaited<ReturnType<typeof createHttpApplication>>[] = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((h) => h.app.close()));
});
async function setup(options: { production?: boolean; trustedProxies?: string[] } = {}) {
  const f = onboardingFixture();
  const output: string[] = [];
  const ip = vi.fn(async (_value: string): Promise<RateDecision> => ({ allowed: true }));
  const identity = vi.fn(async (_value: string): Promise<RateDecision> => ({ allowed: true }));
  const limiter: AuthRateLimiter = { consumeIp: ip, consumeIdentity: identity };
  const sessions = { ...f.service };
  const issue = vi.spyOn(sessions, "issue");
  const http = await createHttpApplication({
    auth: {
      sessions,
      telegram: f.telegram,
      clock: f.clock,
      limiter,
      onboarding: f.onboarding,
    },
    logger: createSafeLogger({
      write: (v: string) => {
        output.push(v);
      },
    }),
    allowedOrigins: ["https://mini.example"],
    trustedProxies: options.trustedProxies ?? [],
    production: options.production ?? false,
  });
  active.push(http);
  const payload = { schemaVersion: 1, commandId: randomUUID(), initData: initData() };
  const post = (body: unknown = payload) =>
    http.server.inject({ method: "POST", url: authPaths.issue, payload: body as object });
  return { ...f, ...http, output, ip, identity, issue, payload, post };
}
describe("Nest/Fastify authentication boundary", () => {
  it.each([false, true])(
    "drains accepted application work even when client abort=%s",
    async (abort) => {
      const f = await setup();
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((r) => (entered = r));
      const gate = new Promise<void>((r) => (release = r));
      f.issue.mockImplementation(async () => {
        entered();
        await gate;
        return createErrorEnvelope("INVALID_INPUT");
      });
      await f.app.listen(0, "127.0.0.1");
      const address = f.server.server.address();
      if (!address || typeof address === "string") throw new Error("Test address");
      let client!: ReturnType<typeof request>;
      const response = new Promise<number>((resolve) => {
        client = request(
          {
            host: "127.0.0.1",
            port: address.port,
            path: authPaths.issue,
            method: "POST",
            agent: false,
            headers: { "content-type": "application/json" },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode!));
          },
        );
        client.on("error", () => resolve(0));
        client.end(JSON.stringify(f.payload));
      });
      await started;
      try {
        f.stopAdmission();
        expect((await f.post()).statusCode).toBe(503);
        expect(f.issue).toHaveBeenCalledTimes(1);
        if (abort) {
          client.destroy();
          await response;
        }
        const drain = f.app.close().then(() => f.settled());
        await expect(withDeadline(drain, 20)).rejects.toThrow("Operation deadline exceeded");
        release();
        await drain;
        expect(await response).toBe(abort ? 0 : 400);
      } finally {
        release();
        await f.settled();
      }
    },
  );
  it("isolates server-owned correlation across concurrent requests and ignores public trace headers", async () => {
    const f = await setup();
    const observed: { requestId: string; traceparent: string }[] = [];
    f.ip.mockImplementation(async () => {
      const before = currentCorrelation();
      expect(before).toBeDefined();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(currentCorrelation()).toEqual(before);
      observed.push(before!);
      return { allowed: true };
    });
    const untrusted = "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01";
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.server.inject({
          method: "POST",
          url: authPaths.issue,
          headers: { traceparent: untrusted, "x-request-id": "PRIVATE_REQUEST" },
          payload: f.payload,
        }),
      ),
    );
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    expect(new Set(observed.map((c) => c.requestId)).size).toBe(8);
    expect(new Set(observed.map((c) => c.traceparent.slice(3, 35))).size).toBe(8);
    for (const c of observed) {
      expect(c.traceparent.slice(3, 35)).not.toBe("a".repeat(32));
      const line = f.output.map((v) => JSON.parse(v)).find((v) => v.requestId === c.requestId);
      expect(line).toMatchObject({
        event: "http.completed",
        traceId: c.traceparent.slice(3, 35),
        spanId: c.traceparent.slice(36, 52),
      });
    }
    expect(new Set(responses.map((r) => r.headers["x-request-id"]))).toEqual(
      new Set(observed.map((c) => c.requestId)),
    );
    expect(f.output.join("")).not.toMatch(
      /PRIVATE_REQUEST|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|traceparent/,
    );
    expect(currentCorrelation()).toBeUndefined();
  });
  it("does not register privileged Bot operations on the public listener", async () => {
    const f = await setup();
    for (const name of ["admit", "updates", "acknowledgements"]) {
      const result = await f.server.inject({
        method: "POST",
        url: `/v1/internal/bot/${name}`,
        headers: { authorization: `Bearer current.${Buffer.alloc(32, 17).toString("base64url")}` },
        payload: { schemaVersion: 1 },
      });
      expect(result.statusCode).toBe(404);
    }
  });
  it("issues, retries, inspects and idempotently revokes through HTTP", async () => {
    const f = await setup();
    const first = await f.post();
    expect(first.statusCode).toBe(200);
    const result = first.json();
    expect(result).toMatchObject({ schemaVersion: 1, tokenType: "Bearer", session: { userId } });
    expect((await f.post()).json()).toEqual(result);
    expect(f.rows.size).toBe(1);
    expect(f.identity).toHaveBeenCalledWith("42");
    const headers = { authorization: `Bearer ${result.accessToken}` };
    expect((await f.server.inject({ url: authPaths.inspect, headers })).statusCode).toBe(200);
    for (let i = 0; i < 2; i++)
      expect(
        (
          await f.server.inject({
            method: "POST",
            url: authPaths.logout,
            headers,
            payload: { schemaVersion: 1 },
          })
        ).statusCode,
      ).toBe(200);
    expect((await f.server.inject({ url: authPaths.inspect, headers })).statusCode).toBe(401);
    expect((await f.post()).statusCode).toBe(401);
    expect(f.output.join("")).not.toContain(result.accessToken);
    expect(f.output.join("")).not.toContain(f.payload.initData);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.headers["set-cookie"]).toBeUndefined();
    expect(first.headers["content-security-policy"]).toContain("default-src 'none'");
  });
  it.each([
    {},
    { schemaVersion: 2, commandId: randomUUID(), initData: initData() },
    { schemaVersion: 1, commandId: "bad", initData: initData() },
    { schemaVersion: 1, commandId: randomUUID(), initData: initData(), userId },
    { schemaVersion: 1, commandId: randomUUID(), initData: 123 },
    { schemaVersion: 1, commandId: randomUUID(), initData: "x".repeat(16385) },
  ])("rejects malformed or identity-injecting DTO", async (payload) => {
    const f = await setup();
    expect((await f.post(payload)).statusCode).toBe(400);
    expect(f.issue).not.toHaveBeenCalled();
  });
  it.each(["forged-init-data", initData(42, 1699999000), initData(42, 1700000031)])(
    "denies forged/stale/future Telegram data",
    async (data) => {
      const f = await setup();
      expect((await f.post({ ...f.payload, initData: data })).statusCode).toBe(401);
      expect(f.identity).not.toHaveBeenCalled();
      expect(f.issue).not.toHaveBeenCalled();
    },
  );
  it("never creates unknown accounts", async () => {
    const f = await setup();
    expect((await f.post({ ...f.payload, initData: initData(99) })).statusCode).toBe(401);
    expect(f.rows.size).toBe(0);
  });
  it("applies distributed IP admission before malformed JSON parsing", async () => {
    const f = await setup();
    f.ip.mockResolvedValue({ allowed: false, reason: "limited", retryAfterSeconds: 23 });
    const response = await f.server.inject({
      method: "POST",
      url: authPaths.issue,
      headers: { "content-type": "application/json" },
      payload: "secret-invalid-json",
    });
    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("23");
    expect(f.identity).not.toHaveBeenCalled();
    expect(f.issue).not.toHaveBeenCalled();
    expect(f.output.join("")).not.toContain("secret-invalid-json");
  });
  it.each(["limited", "unavailable"] as const)(
    "denies identity admission when %s",
    async (reason) => {
      const f = await setup();
      f.identity.mockResolvedValue(
        reason === "limited"
          ? { allowed: false, reason, retryAfterSeconds: 60 }
          : { allowed: false, reason },
      );
      expect((await f.post()).statusCode).toBe(reason === "limited" ? 429 : 503);
      expect(f.issue).not.toHaveBeenCalled();
    },
  );
  it("fails issuance closed on Redis failure but preserves inspection and logout", async () => {
    const f = await setup();
    const token = (await f.post()).json().accessToken;
    f.ip.mockResolvedValue({ allowed: false, reason: "unavailable" });
    expect((await f.post()).statusCode).toBe(503);
    const headers = { authorization: `Bearer ${token}` };
    expect((await f.server.inject({ url: authPaths.inspect, headers })).statusCode).toBe(200);
    expect(
      (
        await f.server.inject({
          method: "POST",
          url: authPaths.logout,
          headers,
          payload: { schemaVersion: 1 },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("returns safe errors for JSON-parser, body-size and content-type failures", async () => {
    const f = await setup();
    for (const [payload, type, status] of [
      ["SENSITIVE-invalid", "application/json", 400],
      ["SENSITIVE".repeat(5000), "application/json", 413],
      ["SENSITIVE", "application/xml", 415],
    ] as const) {
      const response = await f.server.inject({
        method: "POST",
        url: authPaths.issue,
        headers: { "content-type": type },
        payload,
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
      expect(response.body).not.toContain("SENSITIVE");
    }
    expect(f.output.join("")).not.toContain("SENSITIVE");
  });
  it("does not trust spoofed forwarded IPs or caller request identifiers", async () => {
    const f = await setup();
    const response = await f.server.inject({
      method: "POST",
      url: authPaths.issue,
      payload: f.payload,
      remoteAddress: "192.0.2.1",
      headers: { "x-forwarded-for": "198.51.100.2", "x-request-id": "SENSITIVE" },
    });
    expect(f.ip).toHaveBeenCalledWith("192.0.2.1");
    expect(response.headers["x-request-id"]).not.toBe("SENSITIVE");
    expect(f.output.join("")).not.toContain("SENSITIVE");
  });
  it("uses forwarded identity only behind a configured trusted peer", async () => {
    const f = await setup({ trustedProxies: ["192.0.2.1"] });
    await f.server.inject({
      method: "POST",
      url: authPaths.issue,
      payload: f.payload,
      remoteAddress: "192.0.2.1",
      headers: { "x-forwarded-for": "198.51.100.2" },
    });
    expect(f.ip).toHaveBeenCalledWith("198.51.100.2");
  });
  it("rejects insecure production requests and permits trusted HTTPS ingress", async () => {
    const f = await setup({ production: true, trustedProxies: ["192.0.2.1"] });
    expect((await f.post()).statusCode).toBe(403);
    const response = await f.server.inject({
      method: "POST",
      url: authPaths.issue,
      payload: f.payload,
      remoteAddress: "192.0.2.1",
      headers: { "x-forwarded-proto": "https" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["strict-transport-security"]).toBe("max-age=31536000");
  });
  it("enforces known origins, narrowly scoped preflight and no credentialed cookies", async () => {
    const f = await setup();
    expect(
      (
        await f.server.inject({
          method: "POST",
          url: authPaths.issue,
          payload: f.payload,
          headers: { origin: "https://evil.example" },
        })
      ).statusCode,
    ).toBe(403);
    const response = await f.server.inject({
      method: "OPTIONS",
      url: authPaths.issue,
      headers: {
        origin: "https://mini.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,authorization",
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://mini.example");
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(
      (
        await f.server.inject({
          method: "OPTIONS",
          url: authPaths.issue,
          headers: { origin: "https://mini.example", "access-control-request-method": "DELETE" },
        })
      ).statusCode,
    ).toBe(403);
  });
  it.each([
    "",
    "Bearer invalid",
    "Basic secret",
    "Bearer a.b.c extra",
    `Bearer ${"a".repeat(4200)}.b.c`,
  ])("rejects invalid bearer credentials", async (authorization) => {
    const f = await setup();
    expect(
      (await f.server.inject({ url: authPaths.inspect, headers: { authorization } })).statusCode,
    ).toBe(401);
  });
  it("rejects credential query parameters and safely handles unknown paths", async () => {
    const f = await setup();
    expect(
      (await f.server.inject({ url: `${authPaths.inspect}?token=SENSITIVE` })).statusCode,
    ).toBe(400);
    const response = await f.server.inject({ url: "/SENSITIVE" });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("SENSITIVE");
    expect(f.output.join("")).not.toContain("SENSITIVE");
  });
  it("sanitizes unexpected controller failures and refuses invalid success projections", async () => {
    const f = await setup();
    f.issue.mockRejectedValueOnce(new Error(`SENSITIVE ${f.payload.initData}`));
    const response = await f.post();
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("SENSITIVE");
    f.issue.mockResolvedValueOnce({
      ok: true,
      accessToken: new SecretValue(""),
      session: { schemaVersion: 1, sessionId: randomUUID(), userId, expiresAt: 123 },
    });
    expect((await f.post()).statusCode).toBe(500);
    expect(f.output.join("")).not.toContain("SENSITIVE");
  });
  it("has exact expiry enforcement at the HTTP boundary", async () => {
    const f = await setup();
    const result = (await f.post()).json();
    f.clock.value = result.session.expiresAt * 1000;
    expect(
      (
        await f.server.inject({
          url: authPaths.inspect,
          headers: { authorization: `Bearer ${result.accessToken}` },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("projects only safe telemetry fields", async () => {
    const f = await setup();
    await f.post();
    for (const line of f.output) {
      const event = JSON.parse(line);
      expect(Object.keys(event).sort()).toEqual([
        "durationMs",
        "event",
        "level",
        "operation",
        "requestId",
        "spanId",
        "traceId",
      ]);
      expect(event.event).toBe("http.completed");
    }
  });
  it("serves over loopback TCP and rejects duplicate authorization and oversized headers", async () => {
    const f = await setup();
    await f.app.listen(0, "127.0.0.1");
    const base = await f.app.getUrl();
    const send = (headers: Record<string, string | string[]>) =>
      new Promise<number | undefined>((resolve, reject) => {
        const req = request(`${base}${authPaths.inspect}`, { headers }, (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        });
        req.on("error", reject);
        req.end();
      });
    expect(await send({ authorization: ["Bearer a.b.c", "Bearer d.e.f"] })).toBe(401);
    expect(await send({ "x-oversized": "x".repeat(17000) })).toBe(431);
    const result = await fetch(`${base}${authPaths.issue}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(f.payload),
    });
    expect(result.status).toBe(200);
  });
  it("generates a versioned contract from runtime DTO schemas", () => {
    const doc = authOpenApiDocument();
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(Object.values(authPaths));
    expect(
      doc.paths[authPaths.issue]?.post.requestBody.content["application/json"].schema
        .additionalProperties,
    ).toBe(false);
  });
});
