import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { createDatabase } from "@hambazi/database";
import { createMatchResyncRepository } from "../../src/matches/infrastructure/repositories/resync.js";
import { createCoupMatchGame } from "../../src/composition/coup-match.js";
import { rules } from "../fixtures/match-rules.js";

function fixture() {
  const matchId = randomUUID(),
    userId = randomUUID();
  const game = createCoupMatchGame(rules);
  const row = {
    id: matchId,
    status: "ACTIVE",
    stateVersion: 7,
    lastEventSeq: 11,
    gameId: game.gameId,
    ...game.descriptor,
    stateJsonb: {},
  };
  const player = {
    userId,
    agentType: "HUMAN",
    connectionStatus: "CONNECTED",
    replacedAt: null as Date | null,
  };
  const db = {
    lockMatch: vi.fn(async () => {}),
    match: { findUnique: vi.fn(async () => row) },
    matchPlayer: { findMany: vi.fn(async () => [player]) },
    gameEvent: { findMany: vi.fn(async () => [] as { id: string; seq: number }[]) },
    processedCommand: { findMany: vi.fn(async () => [] as { resultJsonb: unknown }[]) },
  };
  const database = {
    forModule: () => ({ transaction: async (run: (value: typeof db) => unknown) => run(db) }),
  } as unknown as ReturnType<typeof createDatabase>;
  const project = vi.fn((_state: unknown, _userId: string, role: string) => ({ role }));
  const repository = createMatchResyncRepository(database, [
    { ...game, restore: () => ({}), project },
  ]);
  return { repository, matchId, userId, db, row, player, project };
}

it("keeps 128 current-cursor catchups fresh and authorized without querying an empty event/receipt tail", async () => {
  const f = fixture();
  for (let wave = 0; wave < 4; wave++)
    await Promise.all(
      Array.from({ length: 32 }, async () => {
        expect(await f.repository.read(f.userId, f.matchId, 11)).toMatchObject({
          mode: "EVENTS",
          events: [],
          snapshot: { stateVersion: 7, lastEventSeq: 11, role: "PLAYER", view: { role: "PLAYER" } },
        });
      }),
    );
  expect(f.db.lockMatch).toHaveBeenCalledTimes(128);
  expect(f.db.match.findUnique).toHaveBeenCalledTimes(128);
  expect(f.db.matchPlayer.findMany).toHaveBeenCalledTimes(128);
  expect(f.project).toHaveBeenCalledTimes(128);
  expect(f.db.gameEvent.findMany.mock.calls.length).toBe(0);
  expect(f.db.processedCommand.findMany.mock.calls.length).toBe(0);

  f.player.replacedAt = new Date(1000);
  expect(await f.repository.read(f.userId, f.matchId, 11)).toMatchObject({
    snapshot: { role: "SPECTATOR", view: { role: "SPECTATOR" } },
  });
  await expect(f.repository.read(randomUUID(), f.matchId, 11)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("still reads and maps a nonempty tail and falls back when a required event is missing", async () => {
  const f = fixture();
  const eventId = randomUUID();
  f.db.gameEvent.findMany.mockResolvedValue([{ id: eventId, seq: 11 }]);
  f.db.processedCommand.findMany.mockResolvedValue([
    {
      resultJsonb: {
        schemaVersion: 1,
        matchId: f.matchId,
        actionId: randomUUID(),
        stateVersion: 7,
        lastEventSeq: 11,
        status: "ACTIVE",
      },
    },
  ]);
  expect(await f.repository.read(f.userId, f.matchId, 10)).toMatchObject({
    mode: "EVENTS",
    events: [{ eventId, seq: 11, stateVersion: 7, payload: {} }],
  });
  expect(f.db.processedCommand.findMany).toHaveBeenCalledTimes(1);
  f.db.gameEvent.findMany.mockResolvedValue([]);
  expect(await f.repository.read(f.userId, f.matchId, 10)).toMatchObject({
    mode: "SNAPSHOT",
    events: [],
  });
  expect(f.db.processedCommand.findMany).toHaveBeenCalledTimes(1);
});
