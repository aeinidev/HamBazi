import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { createDatabase } from "@hambazi/database";
import { createMatchReconnectRepository } from "../../src/matches/infrastructure/repositories/reconnect.js";
import type { ReconnectRequest } from "../../src/matches/application/reconnect.js";

function fixture() {
  const matchId = randomUUID(),
    playerId = randomUUID(),
    connectionId = randomUUID();
  const policy = { schemaVersion: 1 as const, leaseMs: 30000, graceMs: 60000, maxConnections: 4 };
  const row = {
    id: matchId,
    status: "ACTIVE",
    stateVersion: 7,
    lastEventSeq: 11,
    reconnectPolicyJsonb: policy as typeof policy | null,
    startedAt: new Date(0),
  };
  const player = {
    userId: playerId,
    agentType: "HUMAN",
    replacedAt: null as Date | null,
    connectionStatus: "CONNECTED",
    connectionEpoch: 2,
    disconnectDeadlineAt: null,
    disconnectedAt: null,
  };
  const lease = {
    userId: playerId,
    sessionExpiresAt: new Date(100000),
    leaseUntil: new Date(20000),
    closedAt: null as Date | null,
  };
  const db = {
    lockMatch: vi.fn(async () => {}),
    lockMatchPresence: vi.fn(async () => row as typeof row | null),
    match: { findUnique: vi.fn(async () => row), update: vi.fn() },
    matchPlayer: { findUnique: vi.fn(async () => player) },
    matchConnectionLease: {
      findUnique: vi.fn(async () => lease),
      update: vi.fn(async () => {}),
      findFirst: vi.fn(async () => ({ connectionId })),
    },
  };
  const transaction = vi.fn(async (run: (value: typeof db) => unknown) => run(db));
  const database = { forModule: () => ({ transaction }) } as unknown as ReturnType<
    typeof createDatabase
  >;
  const repository = createMatchReconnectRepository(database, {
    clock: { nowMs: () => 1000 },
    policy,
  });
  const request: ReconnectRequest = {
    schemaVersion: 1,
    matchId,
    playerId,
    connectionId,
    sessionExpiresAt: 100000,
    kind: "RENEW",
  };
  return { repository, request, db, row, player, lease, policy };
}

it("renews 128 locked live leases without loading game state or re-reading the lease it just renewed", async () => {
  const f = fixture();
  for (let wave = 0; wave < 4; wave++)
    await Promise.all(
      Array.from({ length: 32 }, async () => {
        expect(await f.repository.apply(f.request)).toMatchObject({
          stateVersion: 7,
          lastEventSeq: 11,
          connectionEpoch: 2,
          changed: false,
          role: "PLAYER",
          status: "CONNECTED",
          timeout: null,
        });
      }),
    );
  expect(f.db.lockMatchPresence).toHaveBeenCalledTimes(128);
  expect(f.db.lockMatchPresence).toHaveBeenCalledWith(f.request.matchId);
  expect(f.db.lockMatch).not.toHaveBeenCalled();
  expect(f.db.match.findUnique).not.toHaveBeenCalled();
  expect(f.db.matchConnectionLease.update).toHaveBeenCalledTimes(128);
  expect(f.db.matchConnectionLease.update).toHaveBeenLastCalledWith({
    where: {
      matchId_connectionId: {
        matchId: f.request.matchId,
        connectionId: "connectionId" in f.request ? f.request.connectionId : "",
      },
    },
    data: { leaseUntil: new Date(31000) },
  });
  expect(f.db.matchConnectionLease.findFirst).not.toHaveBeenCalled();
  expect(f.db.match.update).not.toHaveBeenCalled();
});

it("rejects a missing locked Match before renewing a lease", async () => {
  const f = fixture();
  f.db.lockMatchPresence.mockResolvedValue(null);
  await expect(f.repository.apply(f.request)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(f.db.matchConnectionLease.update).not.toHaveBeenCalled();
});

it.each(["closed", "expired", "foreign", "session-expired"])(
  "retains the %s renewal rejection before writing a lease",
  async (kind) => {
    const f = fixture();
    if (kind === "closed") f.lease.closedAt = new Date(0);
    if (kind === "expired") f.lease.leaseUntil = new Date(1000);
    if (kind === "foreign") f.lease.userId = randomUUID();
    const request =
      kind === "session-expired" ? { ...f.request, sessionExpiresAt: 1000 } : f.request;
    await expect(f.repository.apply(request)).rejects.toMatchObject({
      code:
        kind === "foreign"
          ? "FORBIDDEN"
          : kind === "session-expired"
            ? "UNAUTHENTICATED"
            : "GAME_STATE_CONFLICT",
    });
    expect(f.db.matchConnectionLease.update).not.toHaveBeenCalled();
  },
);

it("never renews a replaced seat or reclaims its human authority", async () => {
  const f = fixture();
  f.player.replacedAt = new Date(500);
  expect(await f.repository.apply(f.request)).toMatchObject({
    role: "SPECTATOR",
    status: "REPLACED_BY_BOT",
    changed: false,
  });
  expect(f.db.matchConnectionLease.findUnique).not.toHaveBeenCalled();
  expect(f.db.matchConnectionLease.update).not.toHaveBeenCalled();
});

it("pins an absent durable policy during renewal without changing gameplay checkpoints", async () => {
  const f = fixture();
  f.row.reconnectPolicyJsonb = null;
  expect(await f.repository.apply(f.request)).toMatchObject({
    changed: false,
    stateVersion: 7,
    lastEventSeq: 11,
  });
  expect(f.db.match.update).toHaveBeenCalledExactlyOnceWith({
    where: { id: f.request.matchId },
    data: { reconnectPolicyJsonb: f.policy },
  });
});

it("keeps renewal monotonic when a prior lease already extends beyond the current deadline", async () => {
  const f = fixture();
  f.lease.leaseUntil = new Date(40000);
  await f.repository.apply(f.request);
  expect(f.db.matchConnectionLease.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { leaseUntil: new Date(40000) } }),
  );
});
