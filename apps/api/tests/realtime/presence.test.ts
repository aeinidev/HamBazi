import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createErrorEnvelope } from "@hambazi/contracts";
import { createPresencePort } from "../../src/presence/index.js";
import type { MatchSnapshot, ReconnectResult } from "../../src/matches/index.js";
function fixture() {
  const matchId = randomUUID();
  const userId = randomUUID();
  const snapshot: MatchSnapshot = {
    schemaVersion: 1,
    matchId,
    status: "ACTIVE",
    stateVersion: 1,
    lastEventSeq: 1,
    role: "PLAYER",
    gameId: "coup",
    engineVersion: "coup-v1",
    stateSchemaVersion: 4,
    rulesetVersion: "coup-provisional-complete-v1",
    view: null,
  };
  const value: ReconnectResult = {
    schemaVersion: 1,
    matchId,
    stateVersion: 1,
    lastEventSeq: 1,
    role: "PLAYER",
    connectionEpoch: 1,
    status: "CONNECTED",
    timeout: null,
    changed: true,
  };
  const call = () => vi.fn(async () => ({ ok: true as const, value }));
  const reconnect = {
    connect: call(),
    renew: call(),
    disconnect: call(),
    reconcile: call(),
    timeout: call(),
  };
  const resync = {
    snapshot: vi.fn(async () => ({ ok: true as const, value: { ...snapshot } })),
    catchup: vi.fn(),
  };
  const cancelTimeout = vi.fn(async () => {});
  const port = createPresencePort({ reconnect, resync, cancelTimeout });
  const session = port.open({ userId, sessionExpiresAt: 10000 });
  return { port, session, matchId, userId, snapshot, value, reconnect, resync, cancelTimeout };
}
it("uses independent server connection IDs and renews only subscribed seats", async () => {
  const f = fixture();
  await f.session.heartbeat();
  expect(f.reconnect.renew).not.toHaveBeenCalled();
  await f.session.subscribe(f.matchId);
  await f.session.heartbeat();
  const another = f.port.open({ userId: f.userId, sessionExpiresAt: 10000 });
  await another.subscribe(f.matchId);
  const calls = vi.mocked(f.reconnect.connect).mock.calls as unknown[][];
  expect(calls[0]![0]).toMatchObject({ playerId: f.userId, sessionExpiresAt: 10000 });
  expect(calls[0]![0]).not.toEqual(calls[1]![0]);
  await f.session.close();
  await f.session.close();
  expect(f.reconnect.disconnect).toHaveBeenCalledTimes(1);
  await expect(f.session.heartbeat()).resolves.toBeUndefined();
});
it("registers a pre-activation subscription on its next healthy heartbeat", async () => {
  const f = fixture();
  f.snapshot.status = "READY";
  await f.session.subscribe(f.matchId);
  expect(f.reconnect.connect).not.toHaveBeenCalled();
  f.snapshot.status = "ACTIVE";
  await f.session.heartbeat();
  expect(f.reconnect.connect).toHaveBeenCalledTimes(1);
  await f.session.heartbeat();
  expect(f.reconnect.renew).toHaveBeenCalledTimes(1);
});
it("does not lease returning spectators and resynchronizes after takeover races", async () => {
  const f = fixture();
  f.snapshot.role = "SPECTATOR";
  expect((await f.session.subscribe(f.matchId)).role).toBe("SPECTATOR");
  expect(f.reconnect.connect).not.toHaveBeenCalled();
});
it.each(["rejected", "pending"])(
  "%s cancellation cannot prevent reconnect and resync",
  async (behavior) => {
    const f = fixture();
    f.value.timeout = {
      schemaVersion: 1,
      matchId: f.matchId,
      playerId: f.userId,
      expectedConnectionEpoch: 0,
      expectedStateVersion: 1,
      deadlineAt: 5000,
    };
    if (behavior === "rejected") f.cancelTimeout.mockRejectedValue(new Error("Queue unavailable"));
    else f.cancelTimeout.mockImplementation(() => new Promise<void>(() => {}));
    await f.session.subscribe(f.matchId);
    expect(f.cancelTimeout).toHaveBeenCalledWith(f.value.timeout);
  },
);
it("fails closed on an expired lease; disconnect still cleans up an uncertain commit", async () => {
  const f = fixture();
  f.reconnect.connect.mockResolvedValueOnce(createErrorEnvelope("INTERNAL_ERROR") as never);
  await expect(f.session.subscribe(f.matchId)).rejects.toThrow("Presence lease unavailable");
  await f.session.close();
  expect(f.reconnect.disconnect).toHaveBeenCalledTimes(1);
});
