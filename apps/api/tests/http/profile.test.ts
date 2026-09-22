import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHttpApplication } from "../../src/composition/http.js";
import { createSafeLogger } from "../../src/composition/safe-logger.js";
import { onboardingFixture } from "../auth/onboarding-fixtures.js";
import { profileService } from "../../src/users/application/profile.js";
import type { ProfileRateDecision } from "../../src/users/infrastructure/profile-rate.js";
import { profileOpenApiDocument } from "../../src/users/index.js";
import { compatibleAuthContract } from "../../scripts/contract-compatibility.mjs";
import { readFileSync } from "node:fs";
const active: Awaited<ReturnType<typeof createHttpApplication>>[] = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((h) => h.app.close()));
});
async function setup(decision: ProfileRateDecision = { allowed: true }) {
  const f = onboardingFixture();
  const userId = randomUUID();
  const output: string[] = [];
  const logger = createSafeLogger({
    write: (s: string) => {
      output.push(s);
    },
  });
  const read = vi.fn(async () => ({
    ok: true as const,
    profile: {
      schemaVersion: 1 as const,
      userId,
      displayName: "PrivateName",
      publicHandle: "stable_12345",
      version: 0,
      settings: { locale: "auto" as const, theme: "system" as const },
    },
  }));
  const patch = vi.fn(async () => ({
    ok: true as const,
    commandId: randomUUID(),
    appliedVersion: 1,
  }));
  const authenticate = vi.fn(async () => ({ ok: true as const, userId }));
  const rate = vi.fn(async () => decision);
  const http = await createHttpApplication({
    auth: {
      sessions: f.service,
      telegram: f.telegram,
      clock: f.clock,
      onboarding: f.onboarding,
      limiter: {
        consumeIp: async () => ({ allowed: true }),
        consumeIdentity: async () => ({ allowed: true }),
      },
    },
    profile: {
      profile: profileService({ read, patch, cleanup: async () => 0 }),
      authenticate,
      rate,
      degraded: logger.profileRateUnavailable,
    },
    allowedOrigins: ["https://mini.example"],
    trustedProxies: [],
    production: false,
    logger,
  });
  active.push(http);
  const headers = { authorization: "Bearer synthetic.token.value" };
  const payload = {
    schemaVersion: 1,
    commandId: randomUUID(),
    expectedVersion: 0,
    patch: { displayName: "PrivateName" },
  };
  return { ...http, headers, payload, read, patch, authenticate, rate, output, logger };
}
it("GET fails open with safe warning/counter on Redis loss; PATCH fails closed", async () => {
  const f = await setup({ allowed: false, reason: "unavailable" });
  expect(
    (await f.server.inject({ method: "GET", url: "/v1/me", headers: f.headers })).statusCode,
  ).toBe(200);
  expect(
    (
      await f.server.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: f.headers,
        payload: f.payload,
      })
    ).statusCode,
  ).toBe(503);
  expect(f.patch).not.toHaveBeenCalled();
  expect(f.logger.profileMetrics()).toEqual({
    profile_rate_read_fail_open_total: 1,
    profile_rate_write_fail_closed_total: 1,
  });
  const logs = f.output.join("");
  expect(logs).toContain("profile.rate_read_fail_open");
  expect(logs).not.toContain("PrivateName");
  expect(logs).not.toContain("synthetic.token");
});
it("fail-open never bypasses missing or invalid authentication", async () => {
  const f = await setup({ allowed: false, reason: "unavailable" });
  expect((await f.server.inject({ url: "/v1/me" })).statusCode).toBe(401);
  f.authenticate.mockImplementation(async () => {
    throw new Error("secret failure");
  });
  expect((await f.server.inject({ url: "/v1/me", headers: f.headers })).statusCode).toBe(500);
  expect(f.read).not.toHaveBeenCalled();
  expect(f.rate).not.toHaveBeenCalled();
});
it.each(["GET", "PATCH"] as const)("enforces exhausted %s quota", async (method) => {
  const f = await setup({ allowed: false, reason: "limited", retryAfterSeconds: 12 });
  const result = await f.server.inject({
    method,
    url: "/v1/me",
    headers: f.headers,
    ...(method === "PATCH" ? { payload: f.payload } : {}),
  });
  expect(result.statusCode).toBe(429);
  expect(result.headers["retry-after"]).toBe("12");
  expect(f.read).not.toHaveBeenCalled();
  expect(f.patch).not.toHaveBeenCalled();
});
it("validates allowed fields and supports PATCH preflight only for profile", async () => {
  const f = await setup();
  expect(
    (
      await f.server.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: f.headers,
        payload: { ...f.payload, userId: randomUUID() },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await f.server.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: f.headers,
        payload: f.payload,
      })
    ).statusCode,
  ).toBe(200);
  const preflight = await f.server.inject({
    method: "OPTIONS",
    url: "/v1/me",
    headers: { origin: "https://mini.example", "access-control-request-method": "PATCH" },
  });
  expect(preflight.statusCode).toBe(204);
  expect(preflight.headers["access-control-allow-methods"]).toContain("PATCH");
});
it("freezes profile wire schemas/security against the initial baseline", () => {
  const baseline = JSON.parse(
    readFileSync(
      new URL("../../../../docs/contracts/profile.v1.baseline.json", import.meta.url),
      "utf8",
    ),
  );
  expect(compatibleAuthContract(baseline, profileOpenApiDocument())).toBe(true);
  const changed = structuredClone(profileOpenApiDocument());
  changed.paths["/v1/me"].get.security = [];
  expect(compatibleAuthContract(baseline, changed)).toBe(false);
});
it("read fail-open does not conceal a database failure", async () => {
  const f = await setup({ allowed: false, reason: "unavailable" });
  f.read.mockRejectedValue(new Error("private database detail"));
  const result = await f.server.inject({ url: "/v1/me", headers: f.headers });
  expect(result.statusCode).toBe(503);
  expect(result.body).not.toContain("private");
});
it("handles a thrown limiter as unavailability and keeps telemetry payload-free", async () => {
  const f = await setup();
  f.rate.mockRejectedValue(new Error("redis password"));
  expect((await f.server.inject({ url: "/v1/me", headers: f.headers })).statusCode).toBe(200);
  expect(
    (
      await f.server.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: f.headers,
        payload: f.payload,
      })
    ).statusCode,
  ).toBe(503);
  expect(f.output.join("")).not.toContain("password");
});
