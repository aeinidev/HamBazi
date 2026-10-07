import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { createDatabase } from "@hambazi/database";
import type { MatchRequest } from "../../src/matches/application/processing.js";
import { createMatchProcessingRepository } from "../../src/matches/infrastructure/repositories/processing.js";

function fixture() {
  const matchId = randomUUID();
  const row = { id: matchId, status: "ACTIVE", stateVersion: 10, lastEventSeq: 20 };
  const db = {
    lockMatch: vi.fn(async () => {}),
    match: { findUnique: vi.fn(async () => row) },
    matchPlayer: { findMany: vi.fn(async () => []) },
    processedCommand: { findUnique: vi.fn(async () => null) },
  };
  const transaction = vi.fn(async (run: (value: typeof db) => unknown) => run(db));
  const execute = vi.fn(async (run: (value: typeof db) => unknown) => run(db));
  const database = { forModule: () => ({ transaction, execute }) } as unknown as ReturnType<
    typeof createDatabase
  >;
  const repository = createMatchProcessingRepository(database, {
    clock: { nowMs: () => 1000 },
    games: [],
  });
  const request: MatchRequest = {
    schemaVersion: 1,
    actionId: randomUUID(),
    matchId,
    expectedVersion: 5,
    kind: "AUTOMATION",
    intent: {
      schemaVersion: 1,
      matchId,
      expectedStateVersion: 5,
      expectedRevision: 5,
      deadlineAt: 1000,
      kind: "TIMER",
      playerId: null,
      expectedConnectionEpoch: null,
    },
  };
  return { repository, request, row, db, transaction, execute };
}

it("rejects 128 obsolete automation jobs without competing for writer locks or loading private state", async () => {
  const f = fixture();
  for (let wave = 0; wave < 4; wave++)
    await Promise.all(
      Array.from({ length: 32 }, async () => {
        expect(await f.repository.process(null, f.request)).toEqual({
          schemaVersion: 1,
          matchId: f.row.id,
          actionId: f.request.actionId,
          stateVersion: 10,
          lastEventSeq: 20,
          status: "ACTIVE",
        });
      }),
    );
  expect(f.transaction).not.toHaveBeenCalled();
  expect(f.db.lockMatch).not.toHaveBeenCalled();
  expect(f.db.matchPlayer.findMany).not.toHaveBeenCalled();
  expect(f.db.match.findUnique).toHaveBeenCalledWith({
    where: { id: f.row.id },
    select: { id: true, status: true, stateVersion: true, lastEventSeq: true },
  });
});

it("rechecks a potentially current automation job under the writer lock", async () => {
  const f = fixture();
  f.db.match.findUnique.mockResolvedValueOnce({ ...f.row, stateVersion: 5 });
  expect(await f.repository.process(null, f.request)).toMatchObject({
    stateVersion: 10,
    lastEventSeq: 20,
  });
  expect(f.transaction).toHaveBeenCalledTimes(1);
  expect(f.db.lockMatch).toHaveBeenCalledTimes(1);
  expect(f.db.matchPlayer.findMany).toHaveBeenCalledTimes(1);
});

it("does not let player authority use the obsolete automation fast path", async () => {
  const f = fixture();
  await expect(f.repository.process(randomUUID(), f.request)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});

it("keeps a missing automation Match as NOT_FOUND", async () => {
  const f = fixture();
  f.db.match.findUnique.mockResolvedValueOnce(null as never);
  await expect(f.repository.process(null, f.request)).rejects.toMatchObject({ code: "NOT_FOUND" });
});
