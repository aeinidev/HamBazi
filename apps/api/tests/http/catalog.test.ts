import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createHttpApplication } from "../../src/composition/http.js";
import { createSafeLogger } from "../../src/composition/safe-logger.js";
import { onboardingFixture } from "../auth/onboarding-fixtures.js";
import { catalogService } from "../../src/games/application/catalog.js";
import { catalogOpenApiDocument } from "../../src/games/index.js";
import type { CatalogRateDecision } from "../../src/games/infrastructure/catalog-rate.js";
import type { CatalogHttpDependencies } from "../../src/games/infrastructure/catalog-http.js";
import { compatibleLegacyCatalog } from "../../scripts/catalog-compatibility.mjs";
import { compatibleAuthContract } from "../../scripts/contract-compatibility.mjs";
const row = {
  id: "coup",
  slug: "coup",
  title: "Coup",
  minPlayers: 2,
  maxPlayers: 6,
  status: "DISABLED",
  matchmakingEnabled: false,
  privateRoomsEnabled: false,
  chatEnabled: false,
  voiceEnabled: false,
  configSchemaVersion: 1,
  configJsonb: {},
};
const active: Awaited<ReturnType<typeof createHttpApplication>>[] = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((h) => h.app.close()));
});
async function setup(decision: CatalogRateDecision = { allowed: true }) {
  const f = onboardingFixture();
  const userId = randomUUID();
  const output: string[] = [];
  const logger = createSafeLogger({
    write: (value: string) => {
      output.push(value);
    },
  });
  const list = vi.fn(async () => [row]);
  const find = vi.fn(async (slug: string) => (slug === "coup" ? row : null));
  const authenticate = vi.fn<CatalogHttpDependencies["authenticate"]>(async () => ({
    ok: true,
    userId,
  }));
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
    catalog: {
      catalog: catalogService({ list, find }),
      authenticate,
      rate,
      degraded: logger.catalogRateUnavailable,
    },
    allowedOrigins: ["https://mini.example"],
    trustedProxies: [],
    production: false,
    logger,
  });
  active.push(http);
  return {
    ...http,
    list,
    find,
    authenticate,
    rate,
    output,
    logger,
    userId,
    headers: { authorization: "Bearer synthetic.token.value" },
  };
}
it.each(["/v1/games", "/v1/games/coup"])(
  "serves authenticated non-playable metadata at %s",
  async (url) => {
    const f = await setup();
    const response = await f.server.inject({ url, headers: f.headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain('"playable":false');
    expect(response.body).not.toContain("configJsonb");
    expect(f.rate).toHaveBeenCalledWith(f.userId);
  },
);
it.each(["hokm", "kahroba", "chess", "domino", "ludo"])(
  "does not register the %s home card as an API game",
  async (slug) => {
    const f = await setup();
    const response = await f.server.inject({ url: `/v1/games/${slug}`, headers: f.headers });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(f.find).toHaveBeenCalledWith(slug);
  },
);
it.each(["/v1/games", "/v1/games/coup"])(
  "fails open on limiter outage at %s with safe telemetry",
  async (url) => {
    const f = await setup({ allowed: false, reason: "unavailable" });
    expect((await f.server.inject({ url, headers: f.headers })).statusCode).toBe(200);
    expect(f.logger.catalogMetrics()).toEqual({ catalog_rate_read_fail_open_total: 1 });
    expect(f.output.join("")).toContain("catalog.rate_read_fail_open");
    expect(f.output.join("")).not.toContain("synthetic.token");
    f.list.mockRejectedValue(new Error("secret database failure"));
    const response = await f.server.inject({ url: "/v1/games", headers: f.headers });
    expect(response.statusCode).toBe(503);
    expect(response.body + f.output.join("")).not.toContain("secret database");
  },
);
it("does not bypass authentication on Redis failure", async () => {
  const f = await setup({ allowed: false, reason: "unavailable" });
  expect((await f.server.inject({ url: "/v1/games" })).statusCode).toBe(401);
  f.authenticate.mockResolvedValue({ ok: false, error: { code: "UNAUTHENTICATED" } });
  expect((await f.server.inject({ url: "/v1/games", headers: f.headers })).statusCode).toBe(401);
  expect(f.rate).not.toHaveBeenCalled();
  expect(f.list).not.toHaveBeenCalled();
});
it.each(["/v1/games", "/v1/games/coup"])("returns 429 for exhausted budget at %s", async (url) => {
  const f = await setup({ allowed: false, reason: "limited", retryAfterSeconds: 12 });
  const response = await f.server.inject({ url, headers: f.headers });
  expect(response.statusCode).toBe(429);
  expect(response.headers["retry-after"]).toBe("12");
  expect(f.list).not.toHaveBeenCalled();
  expect(f.find).not.toHaveBeenCalled();
});
it("rejects input injection and write routes; unknown slug is 404", async () => {
  const f = await setup();
  for (const url of ["/v1/games?userId=someone", "/v1/games/INVALID"])
    expect((await f.server.inject({ url, headers: f.headers })).statusCode).toBe(400);
  expect((await f.server.inject({ url: "/v1/games/missing", headers: f.headers })).statusCode).toBe(
    404,
  );
  for (const method of ["POST", "PATCH", "DELETE"] as const)
    expect(
      (await f.server.inject({ method, url: "/v1/games/coup", headers: f.headers })).statusCode,
    ).toBe(404);
  expect(
    (
      await f.server.inject({
        url: "/v1/games",
        headers: { ...f.headers, origin: "https://evil.example" },
      })
    ).statusCode,
  ).toBe(403);
});
it("handles thrown rate/auth failures without exposing details", async () => {
  const f = await setup();
  f.rate.mockRejectedValue(new Error("secret redis"));
  expect((await f.server.inject({ url: "/v1/games", headers: f.headers })).statusCode).toBe(200);
  f.authenticate.mockRejectedValue(new Error("secret auth"));
  const response = await f.server.inject({ url: "/v1/games", headers: f.headers });
  expect(response.statusCode).toBe(503);
  expect(response.body + f.output.join("")).not.toContain("secret");
});
it("checks generated contract and rejects authentication removal", () => {
  const baseline = JSON.parse(
    readFileSync(
      new URL("../../../../docs/contracts/catalog.v1.baseline.json", import.meta.url),
      "utf8",
    ),
  );
  const contract = catalogOpenApiDocument();
  expect(compatibleLegacyCatalog(baseline, contract)).toBe(true);
  contract.paths["/v1/games"].get.security = [];
  expect(compatibleLegacyCatalog(baseline, contract)).toBe(false);
});

it("freezes the optional mode addition and rejects changes to old fields", () => {
  const baseline = JSON.parse(
    readFileSync(
      new URL("../../../../docs/contracts/catalog.modes.v1.baseline.json", import.meta.url),
      "utf8",
    ),
  );
  const contract = catalogOpenApiDocument();
  expect(compatibleAuthContract(baseline, contract)).toBe(true);
  const changed = structuredClone(contract);
  changed.paths["/v1/games"].get.security = [];
  expect(compatibleAuthContract(baseline, changed)).toBe(false);
});
