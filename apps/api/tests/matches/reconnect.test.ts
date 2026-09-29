import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { MatchFault } from "../../src/matches/index.js";
import {
  matchReconnectService,
  reconnectPolicySchema,
  disconnectTimeoutSchema,
  type ReconnectRepository,
} from "../../src/matches/application/reconnect.js";
const ref = { schemaVersion: 1, matchId: randomUUID(), playerId: randomUUID() };
const lease = { ...ref, connectionId: randomUUID(), sessionExpiresAt: 10000 };
it.each(["connect", "renew", "disconnect", "reconcile", "timeout"] as const)(
  "rejects malformed %s before repository access",
  async (method) => {
    const apply = vi.fn<ReconnectRepository["apply"]>();
    const port = matchReconnectService({ apply });
    expect(await port[method]({ ...lease, unexpected: "injected" })).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(apply).not.toHaveBeenCalled();
  },
);
it("requires complete guarded, versioned jobs and explicit bounded policies", () => {
  const job = { ...ref, expectedConnectionEpoch: 2, expectedStateVersion: 8, deadlineAt: 6000 };
  expect(disconnectTimeoutSchema.safeParse(job).success).toBe(true);
  for (const key of Object.keys(job)) {
    const invalid = { ...job } as Record<string, unknown>;
    delete invalid[key];
    expect(disconnectTimeoutSchema.safeParse(invalid).success).toBe(false);
  }
  expect(
    reconnectPolicySchema.safeParse({
      schemaVersion: 1,
      leaseMs: 1000,
      graceMs: 2000,
      maxConnections: 4,
    }).success,
  ).toBe(true);
  for (const leaseMs of [0, -1, 86400001, 1.5, Infinity])
    expect(
      reconnectPolicySchema.safeParse({
        schemaVersion: 1,
        leaseMs,
        graceMs: 2000,
        maxConnections: 4,
      }).success,
    ).toBe(false);
  expect(reconnectPolicySchema.safeParse({}).success).toBe(false);
});
it("sanitizes repository failures and preserves stable domain errors", async () => {
  const apply = vi
    .fn<ReconnectRepository["apply"]>()
    .mockRejectedValue(new Error("SYNTHETIC_SECRET"));
  const port = matchReconnectService({ apply });
  const failed = await port.connect(lease);
  expect(failed).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  expect(JSON.stringify(failed)).not.toContain("SYNTHETIC_SECRET");
  apply.mockRejectedValue(new MatchFault("GAME_STATE_CONFLICT"));
  expect(await port.renew(lease)).toMatchObject({ error: { code: "GAME_STATE_CONFLICT" } });
});
