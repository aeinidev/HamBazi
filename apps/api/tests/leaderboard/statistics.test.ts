import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { statisticsService } from "../../src/leaderboard/application/service.js";
import {
  leaderboardQuerySchema,
  periodKey,
  statsFinishSchema,
} from "../../src/leaderboard/application/contracts.js";
const id = randomUUID();
function fixture() {
  const repository = {
    own: vi.fn(async () => [
      { gameId: "coup", completed: "9007199254740993", wins: "1", losses: "9007199254740992" },
    ]),
    board: vi.fn(async () => ({
      entries: [{ userId: id, rank: "1", wins: "5" }],
      nextOffset: null,
    })),
  };
  const users = {
    findActiveById: vi.fn(async () => ({ userId: id })),
    findActiveByTelegramId: async () => undefined,
  };
  const names = {
    find: vi.fn(async () => [{ userId: id, displayName: "<script>plain name</script>" }]),
  };
  const service = statisticsService({
    repository,
    users,
    names,
    clock: { nowMs: () => Date.parse("2026-10-02T20:00:00Z") },
  });
  return { service, repository, users, names };
}
it.each([
  ["2026-09-27T23:59:59.999Z", "week:2026-09-21"],
  ["2026-09-28T00:00:00Z", "week:2026-09-28"],
  ["2027-01-01T00:00:00Z", "week:2026-12-28"],
])("assigns UTC Monday weeks at %s", (at, expected) =>
  expect(periodKey("weekly", Date.parse(at))).toBe(expected),
);
it("rejects invalid time rather than consulting ambient time", () => {
  for (const at of [NaN, -1, Infinity, 253402300800000])
    expect(() => periodKey("weekly", at)).toThrow();
});
it.each([
  { userId: id },
  { period: "seasonal" },
  { limit: "51" },
  { limit: "0" },
  { offset: "-1" },
  { offset: "01" },
  { period: ["weekly", "all_time"] },
])("rejects malformed/unapproved query %j", (query) =>
  expect(leaderboardQuerySchema.safeParse(query).success).toBe(false),
);
it("reads only the authenticated account and preserves exact decimal counts", async () => {
  const f = fixture();
  expect(await f.service.own(id, { period: "weekly" })).toMatchObject({
    ok: true,
    value: { period: "week:2026-09-28", games: [{ completed: "9007199254740993" }] },
  });
  expect(f.repository.own).toHaveBeenCalledWith(id, "week:2026-09-28");
  expect(await f.service.own(id, { userId: randomUUID() })).toMatchObject({
    error: { code: "INVALID_INPUT" },
  });
});
it("authenticates active users before reading statistics or names", async () => {
  const f = fixture();
  f.users.findActiveById.mockResolvedValue(undefined as never);
  expect(await f.service.board(id, "coup", {})).toMatchObject({
    error: { code: "UNAUTHENTICATED" },
  });
  expect(f.repository.board).not.toHaveBeenCalled();
  expect(f.names.find).not.toHaveBeenCalled();
});
it("returns only public names through the owning port and keeps unsupported games unavailable", async () => {
  const f = fixture();
  expect(await f.service.board(id, "coup", {})).toMatchObject({
    ok: true,
    value: { entries: [{ displayName: "<script>plain name</script>", rank: "1" }] },
  });
  expect(f.names.find).toHaveBeenCalledWith([id]);
  expect(await f.service.board(id, "unknown", {})).toMatchObject({ error: { code: "NOT_FOUND" } });
  f.names.find.mockResolvedValue([]);
  expect(await f.service.board(id, "coup", {})).toMatchObject({
    value: { entries: [{ displayName: "Player" }] },
  });
});
it("sanitizes projection and profile failures", async () => {
  const f = fixture();
  f.repository.own.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_STATE"));
  const result = await f.service.own(id, {});
  expect(result).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_STATE");
});
it("rejects private result fields and malformed roster projection input", () => {
  const input = {
    eventId: randomUUID(),
    payload: {
      schemaVersion: 1,
      matchId: randomUUID(),
      gameId: "coup",
      stateVersion: 1,
      lastEventSeq: 2,
      finishedAt: 2000,
      engineVersion: "coup-v1",
      stateSchemaVersion: 4,
      rulesetVersion: "v1",
      result: {
        placements: [
          { playerId: id, place: 1 },
          { playerId: randomUUID(), place: 2 },
        ],
        winnerId: id,
        reason: "LAST_PLAYER_STANDING",
        metrics: {},
      },
    },
  };
  expect(statsFinishSchema.safeParse(input).success).toBe(true);
  expect(
    statsFinishSchema.safeParse({ ...input, payload: { ...input.payload, state: {} } }).success,
  ).toBe(false);
  expect(
    statsFinishSchema.safeParse({
      ...input,
      payload: {
        ...input.payload,
        result: {
          ...input.payload.result,
          placements: [input.payload.result.placements[0], input.payload.result.placements[0]],
        },
      },
    }).success,
  ).toBe(false);
});
