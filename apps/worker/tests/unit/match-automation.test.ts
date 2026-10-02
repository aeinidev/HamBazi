import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { UnrecoverableError } from "bullmq";
import { matchJobProcessor, matchJobId, type MatchJob } from "../../src/match-automation.js";
function fixture() {
  const timeout = vi.fn(async () => ({ ok: true as const, value: {} as never }));
  const execute = vi.fn(async () => ({}) as never);
  const ports = {
    reconnect: {
      timeout,
      connect: vi.fn(),
      renew: vi.fn(),
      disconnect: vi.fn(),
      reconcile: vi.fn(),
    },
    automation: { execute, plan: vi.fn(), recover: vi.fn() },
  };
  const payload = {
    schemaVersion: 1 as const,
    matchId: randomUUID(),
    playerId: randomUUID(),
    expectedConnectionEpoch: 1,
    expectedStateVersion: 2,
    deadlineAt: 1000,
  };
  const data: MatchJob = { schemaVersion: 1, kind: "DISCONNECT", payload };
  return { ports, data, timeout, execute, run: matchJobProcessor(ports) };
}
it("routes strict versioned jobs and returns no state", async () => {
  const f = fixture();
  expect(await f.run({ name: "match-automation-v1", data: f.data })).toEqual({ schemaVersion: 1 });
  expect(f.timeout).toHaveBeenCalledWith(f.data.payload, {
    requestId: expect.any(String),
    traceparent: expect.any(String),
  });
  expect(f.execute).not.toHaveBeenCalled();
});
it.each([null, { schemaVersion: 2 }, { schemaVersion: 1, kind: "UNKNOWN" }])(
  "rejects invalid jobs without retry %#",
  async (data) => {
    const f = fixture();
    await expect(f.run({ name: "match-automation-v1", data })).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(f.timeout).not.toHaveBeenCalled();
  },
);
it("sanitizes dependency failures and retries unsuccessful outcomes", async () => {
  const f = fixture();
  f.timeout.mockRejectedValueOnce(new Error("private state"));
  await expect(f.run({ name: "match-automation-v1", data: f.data })).rejects.toThrow(
    /^Match job failed$/,
  );
  f.timeout.mockResolvedValueOnce({ ok: false } as never);
  await expect(f.run({ name: "match-automation-v1", data: f.data })).rejects.toThrow(
    /^Match job failed$/,
  );
});
it("deduplicates equal descriptors but gives new guards distinct job identities", () => {
  const f = fixture();
  expect(matchJobId(f.data)).toBe(matchJobId(structuredClone(f.data)));
  expect(matchJobId(f.data)).not.toBe(
    matchJobId({ ...f.data, payload: { ...f.data.payload, expectedStateVersion: 3 } }),
  );
});
