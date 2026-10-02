import { readFileSync } from "node:fs";
import { request } from "node:https";
import { expect, it, vi } from "vitest";
import { createServiceHealth, healthPaths } from "@hambazi/observability";
import {
  createApiHealth,
  healthOpenApiDocument,
  botHealthOperation,
} from "../../src/health/index.js";
import { botInternalOpenApiDocument } from "../../src/auth/index.js";
import { compatibleAuthContract } from "../../scripts/contract-compatibility.mjs";
import { botFixture } from "../auth/bot-onboarding-fixtures.js";
import { internalHarness, testCertificate, bearer } from "./bot-internal-fixture.js";
import { createSafeLogger } from "../../src/composition/safe-logger.js";
it("keeps durable API readiness while Redis-dependent capabilities degrade", async () => {
  const health = createApiHealth({
    postgres: async () => true,
    redis: async () => false,
    timeoutMs: 100,
  });
  health.started();
  expect((await health.ready()).status).toBe("DEGRADED");
  expect(health.accepting()).toBe(true);
});
it("checks private backend readiness without spending admission counters and enforces service authentication", async () => {
  const tls = await testCertificate();
  const f = botFixture();
  const consumeIp = vi.fn(async () => ({ allowed: true as const }));
  let ready = true;
  const health = createServiceHealth([{ required: true, probe: async () => ready }], 100);
  health.started();
  const h = await internalHarness({
    tls,
    onboarding: f.service,
    health,
    limiter: { consumeIp, consumeIdentity: consumeIp },
    logger: createSafeLogger({ write: () => {} }),
  });
  async function get(authorization: string) {
    return new Promise<{ status: number; body: string }>((resolve) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: h.port,
          path: healthPaths.ready,
          ca: tls.cert,
          agent: false,
          headers: { authorization },
        },
        (res) => {
          let body = "";
          res.on("data", (v) => (body += v));
          res.on("end", () => resolve({ status: res.statusCode!, body }));
        },
      );
      req.end();
    });
  }
  try {
    expect(await get(bearer)).toEqual({
      status: 200,
      body: '{"schemaVersion":1,"status":"READY"}',
    });
    ready = false;
    expect(await get(bearer)).toEqual({
      status: 503,
      body: '{"schemaVersion":1,"status":"NOT_READY"}',
    });
    const denied = await get("Bearer PRIVATE");
    expect(denied.status).toBe(401);
    expect(JSON.parse(denied.body)).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(consumeIp).not.toHaveBeenCalled();
    h.stopAdmission();
    expect((await get(bearer)).status).toBe(503);
  } finally {
    await h.app.close();
    await h.settled();
  }
});
it("protects the operational v1 baseline and preserves private Bot paths", () => {
  const baseline = JSON.parse(
    readFileSync(
      new URL("../../../../docs/contracts/health.v1.baseline.json", import.meta.url),
      "utf8",
    ),
  );
  const document = healthOpenApiDocument();
  expect(compatibleAuthContract(baseline, document)).toBe(true);
  const next = structuredClone(document);
  next.paths[healthPaths.ready].get.responses["200"].content[
    "application/json"
  ].schema.properties.status.enum = ["READY"];
  expect(compatibleAuthContract(baseline, next)).toBe(false);
  const botBaseline = JSON.parse(
    readFileSync(
      new URL("../../../../docs/contracts/bot-internal.v1.baseline.json", import.meta.url),
      "utf8",
    ),
  );
  const bot = botInternalOpenApiDocument();
  const combined = {
    ...bot,
    paths: { ...bot.paths, [healthPaths.ready]: { get: botHealthOperation() } },
  };
  expect(compatibleAuthContract(botBaseline, combined)).toBe(true);
  expect(combined.paths[healthPaths.ready].get.security).toEqual([{ botService: [] }]);
});
