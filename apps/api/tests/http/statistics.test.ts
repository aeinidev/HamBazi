import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { createHttpApplication } from "../../src/composition/http.js";
import { createSafeLogger } from "../../src/composition/safe-logger.js";
import { onboardingFixture } from "../auth/onboarding-fixtures.js";
import { statisticsService } from "../../src/leaderboard/application/service.js";
import {
  statisticsOpenApiDocument,
  type StatisticsHttpDependencies,
} from "../../src/leaderboard/index.js";
import { compatibleAuthContract } from "../../scripts/contract-compatibility.mjs";
const running: Awaited<ReturnType<typeof createHttpApplication>>[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((h) => h.app.close()));
});
async function fixture(
  decision: Awaited<ReturnType<StatisticsHttpDependencies["rate"]>> = { allowed: true },
) {
  const f = onboardingFixture(),
    id = randomUUID();
  const logs: string[] = [];
  const repository = {
    own: vi.fn(async () => [{ gameId: "coup", completed: "2", wins: "1", losses: "1" }]),
    board: vi.fn(async () => ({
      entries: [{ userId: id, rank: "1", wins: "1" }],
      nextOffset: null,
    })),
  };
  const authenticate = vi.fn(async () => ({ ok: true as const, userId: id }));
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
    statistics: {
      statistics: statisticsService({
        repository,
        users: {
          findActiveById: async () => ({ userId: id }),
          findActiveByTelegramId: async () => undefined,
        },
        names: { find: async () => [{ userId: id, displayName: "SYNTHETIC_NAME" }] },
        clock: { nowMs: () => Date.parse("2026-10-02T00:00:00Z") },
      }),
      authenticate,
      rate,
    },
    allowedOrigins: ["https://mini.example"],
    trustedProxies: [],
    production: false,
    logger: createSafeLogger({
      write: (s: string) => {
        logs.push(s);
      },
    }),
  });
  running.push(http);
  return {
    ...http,
    authenticate,
    rate,
    repository,
    logs,
    id,
    headers: { authorization: "Bearer synthetic.token.value" },
  };
}
it("serves authenticated statistics/leaderboard query parameters with safe no-store responses", async () => {
  const f = await fixture();
  const own = await f.server.inject({
    method: "GET",
    url: "/v1/me/stats?period=weekly",
    headers: f.headers,
  });
  expect(own.statusCode).toBe(200);
  expect(own.json()).toMatchObject({ period: "week:2026-09-28", games: [{ completed: "2" }] });
  expect(own.headers["cache-control"]).toBe("no-store");
  const board = await f.server.inject({
    method: "GET",
    url: "/v1/leaderboards/coup?offset=0&limit=2",
    headers: f.headers,
  });
  expect(board.statusCode).toBe(200);
  expect(board.json()).toMatchObject({ entries: [{ displayName: "SYNTHETIC_NAME" }] });
  expect(f.repository.board).toHaveBeenCalledWith("coup", "all_time", 0, 2);
  expect(f.logs.join("")).not.toMatch(/SYNTHETIC_NAME|synthetic\.token|"completed":|"wins":/);
});
it.each([
  "period=weekly&period=all_time",
  "period=seasonal",
  "userId=injected",
  "limit=51",
  "offset=-1",
  "offset=01",
  "limit=2&limit=3",
])("rejects malformed statistics query %s", async (query) => {
  const f = await fixture();
  const response = await f.server.inject({
    method: "GET",
    url: `/v1/leaderboards/coup?${query}`,
    headers: f.headers,
  });
  expect(response.statusCode).toBe(400);
  expect(f.repository.board).not.toHaveBeenCalled();
});
it("keeps the existing query-string rejection on other routes and rejects missing authentication", async () => {
  const f = await fixture();
  expect((await f.server.inject({ method: "GET", url: "/v1/me/stats" })).statusCode).toBe(401);
  expect(
    (await f.server.inject({ method: "GET", url: "/v1/leaderboards/unknown", headers: f.headers }))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await f.server.inject({
        method: "GET",
        url: "/v1/auth/session?period=weekly",
        headers: f.headers,
      })
    ).statusCode,
  ).toBe(400);
});
it.each([
  { allowed: false as const, reason: "limited" as const, retryAfterSeconds: 3 },
  { allowed: false as const, reason: "unavailable" as const },
])("fails closed under statistics rate decisions %j", async (decision) => {
  const f = await fixture(decision);
  const response = await f.server.inject({
    method: "GET",
    url: "/v1/me/stats",
    headers: f.headers,
  });
  expect(response.statusCode).toBe(decision.reason === "limited" ? 429 : 503);
  expect(f.repository.own).not.toHaveBeenCalled();
  if (decision.reason === "limited") expect(response.headers["retry-after"]).toBe("3");
});
it("checks the new frozen OpenAPI baseline and rejects a breaking count type change", () => {
  const doc = statisticsOpenApiDocument();
  const baseline = JSON.parse(
    readFileSync(
      new URL("../../../../docs/contracts/statistics.v1.baseline.json", import.meta.url),
      "utf8",
    ),
  );
  expect(compatibleAuthContract(baseline, doc)).toBe(true);
  const changed = structuredClone(doc);
  const schema = changed.paths["/v1/me/stats"].get.responses[200].content["application/json"]
    .schema as { properties: Record<string, unknown> };
  schema.properties.games = { type: "number" };
  expect(compatibleAuthContract(baseline, changed)).toBe(false);
});
