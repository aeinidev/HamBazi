import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { finishProcessor, rebuildStatistics } from "../../src/statistics.js";
function fixture() {
  const matchId = randomUUID(),
    winner = randomUUID();
  const event = {
    schemaVersion: 1 as const,
    eventId: randomUUID(),
    aggregateId: matchId,
    occurredAt: 2000,
    type: "MATCH_FINISHED_V1",
    correlation: {},
    payload: {
      schemaVersion: 1 as const,
      matchId,
      gameId: "coup",
      stateVersion: 1,
      lastEventSeq: 2,
      finishedAt: 2000,
      engineVersion: "coup-v1",
      stateSchemaVersion: 4,
      rulesetVersion: "v1",
      result: {
        placements: [
          { playerId: winner, place: 1 },
          { playerId: randomUUID(), place: 2 },
        ],
        winnerId: winner,
        reason: "LAST_PLAYER_STANDING",
        metrics: {},
      },
    },
  };
  const input = { eventId: event.eventId, payload: event.payload };
  const matches = {
    record: vi.fn(async () => input),
    recoverPage: vi.fn(async () => ({ next: null as string | null })),
    page: vi.fn(async () => ({ results: [input], next: null as string | null })),
  };
  const statistics = {
    consume: vi.fn(async () => "APPLIED" as const),
    begin: vi.fn(async () => randomUUID()),
    applyBatch: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    building: vi.fn(async () => null as string | null),
  };
  return { event, input, matches, statistics };
}
it("records verified Matches truth before projecting a versioned finish job", async () => {
  const f = fixture();
  expect(
    await finishProcessor(f.matches, f.statistics)({ name: "MATCH_FINISHED_V1", data: f.event }),
  ).toEqual({ schemaVersion: 1 as const, status: "APPLIED" });
  expect(f.matches.record).toHaveBeenCalledWith(f.event);
  expect(f.statistics.consume).toHaveBeenCalledWith(f.input);
});
it("rejects malformed/private/wrong-name jobs before invoking owner ports", async () => {
  const f = fixture(),
    processor = finishProcessor(f.matches, f.statistics);
  for (const job of [
    { name: "OTHER", data: f.event },
    { name: "MATCH_FINISHED_V1", data: { ...f.event, payload: { ...f.event.payload, deck: [] } } },
  ])
    await expect(processor(job)).rejects.toThrow("Invalid domain job");
  expect(f.matches.record).not.toHaveBeenCalled();
});
it("sanitizes result persistence failures without projecting them", async () => {
  const f = fixture();
  f.matches.record.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_RESULT"));
  await expect(
    finishProcessor(f.matches, f.statistics)({ name: "MATCH_FINISHED_V1", data: f.event }),
  ).rejects.toThrow("Domain consumer failed");
  expect(f.statistics.consume).not.toHaveBeenCalled();
});
it("recovers and scans bounded result pages before switching the generation", async () => {
  const f = fixture();
  f.matches.recoverPage.mockResolvedValueOnce({ next: randomUUID() });
  f.matches.page.mockResolvedValueOnce({ results: [f.input], next: "1" });
  await rebuildStatistics(f.matches, f.statistics);
  expect(f.matches.recoverPage).toHaveBeenCalledTimes(2);
  expect(f.matches.page).toHaveBeenCalledTimes(2);
  expect(f.matches.page).toHaveBeenNthCalledWith(2, "1", 25);
  expect(f.statistics.finish).toHaveBeenCalledTimes(1);
  expect(f.statistics.abort).not.toHaveBeenCalled();
});
it("aborts failed builds without publishing a partial generation", async () => {
  const f = fixture();
  f.statistics.applyBatch.mockRejectedValue(new Error("SYNTHETIC_FAILURE"));
  await expect(rebuildStatistics(f.matches, f.statistics)).rejects.toThrow(
    "Statistics rebuild failed",
  );
  expect(f.statistics.abort).toHaveBeenCalledTimes(1);
  expect(f.statistics.finish).not.toHaveBeenCalled();
});
