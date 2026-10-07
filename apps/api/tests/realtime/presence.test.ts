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

it("renews a registered heartbeat wave through durable lease guards without constructing discarded views", async () => {
  const f = fixture();
  const sessions = Array.from({ length: 32 }, () =>
    f.port.open({ userId: f.userId, sessionExpiresAt: 10000 }),
  );
  await Promise.all(sessions.map((session) => session.subscribe(f.matchId)));
  f.resync.snapshot.mockClear();
  for (let wave = 0; wave < 4; wave++)
    await Promise.all(sessions.map((session) => session.heartbeat()));
  expect(f.reconnect.renew).toHaveBeenCalledTimes(128);
  expect(f.resync.snapshot).not.toHaveBeenCalled();
  f.reconnect.renew.mockResolvedValueOnce(createErrorEnvelope("GAME_STATE_CONFLICT") as never);
  await expect(sessions[0]!.heartbeat()).rejects.toThrow("Presence lease unavailable");
  await sessions[0]!.close();
  expect(f.reconnect.disconnect).toHaveBeenCalledTimes(1);
  expect(f.reconnect.connect).toHaveBeenCalledTimes(32);
});

it("registers 32 pre-activation subscriptions without a discarded post-connect projection", async () => {
  const f = fixture();
  f.snapshot.status = "READY";
  const sessions = Array.from({ length: 32 }, () =>
    f.port.open({ userId: f.userId, sessionExpiresAt: 10000 }),
  );
  await Promise.all(sessions.map((session) => session.subscribe(f.matchId)));
  expect(f.reconnect.connect).not.toHaveBeenCalled();
  f.snapshot.status = "ACTIVE";
  f.resync.snapshot.mockClear();
  await Promise.all(sessions.map((session) => session.heartbeat()));
  expect(f.reconnect.connect).toHaveBeenCalledTimes(32);
  // Each registration keeps its initial fresh role/lifecycle/pinned-view guard.
  // Heartbeats transmit no view and need no second projection after lease commit.
  expect(f.resync.snapshot.mock.calls.length).toBe(32);
  f.resync.snapshot.mockClear();
  await Promise.all(sessions.map((session) => session.heartbeat()));
  expect(f.reconnect.renew).toHaveBeenCalledTimes(32);
  expect(f.resync.snapshot).not.toHaveBeenCalled();
  await Promise.all(sessions.map((session) => session.close()));
  expect(f.reconnect.disconnect).toHaveBeenCalledTimes(32);
});

it("still returns the fresh spectator view when takeover races initial subscription", async () => {
  const f = fixture();
  f.reconnect.connect.mockImplementation(async () => {
    f.snapshot.role = "SPECTATOR";
    return { ok: true, value: { ...f.value, role: "SPECTATOR" } };
  });
  expect(await f.session.subscribe(f.matchId)).toMatchObject({ role: "SPECTATOR" });
  expect(f.resync.snapshot).toHaveBeenCalledTimes(2);
});

it.each(["projection", "lease"])(
  "fails registration heartbeat closed on %s failure and retains uncertain-commit cleanup",
  async (kind) => {
    const f = fixture();
    f.snapshot.status = "READY";
    await f.session.subscribe(f.matchId);
    f.snapshot.status = "ACTIVE";
    if (kind === "projection")
      f.resync.snapshot.mockResolvedValueOnce(createErrorEnvelope("INTERNAL_ERROR") as never);
    else f.reconnect.connect.mockResolvedValueOnce(createErrorEnvelope("INTERNAL_ERROR") as never);
    await expect(f.session.heartbeat()).rejects.toThrow(
      kind === "projection" ? "Presence projection unavailable" : "Presence lease unavailable",
    );
    await f.session.close();
    expect(f.reconnect.disconnect).toHaveBeenCalledTimes(kind === "lease" ? 1 : 0);
  },
);
