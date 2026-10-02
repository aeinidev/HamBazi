import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { ownStatsSchema, leaderboardSchema } from "../../src/features/leaderboard/index.js";
it("validates exact counts and refuses inconsistent or duplicate statistics", () => {
  const row = {
    gameId: "coup",
    completed: "9007199254740993",
    wins: "1",
    losses: "9007199254740992",
  };
  const input = { schemaVersion: 1, period: "all_time", games: [row] };
  expect(ownStatsSchema.safeParse(input).success).toBe(true);
  expect(ownStatsSchema.safeParse({ ...input, games: [{ ...row, losses: "1" }] }).success).toBe(
    false,
  );
  expect(ownStatsSchema.safeParse({ ...input, games: [row, row] }).success).toBe(false);
});
it("allows shared ranks and plain-text names while rejecting private fields and duplicate entries", () => {
  const entry = {
    userId: randomUUID(),
    displayName: "<script>literal</script>",
    rank: "1",
    wins: "3",
  };
  const input = {
    schemaVersion: 1,
    gameId: "coup",
    metric: "wins",
    period: "all_time",
    entries: [entry, { ...entry, userId: randomUUID() }],
    nextOffset: null,
  };
  expect(leaderboardSchema.safeParse(input).success).toBe(true);
  expect(leaderboardSchema.safeParse({ ...input, entries: [entry, entry] }).success).toBe(false);
  expect(
    leaderboardSchema.safeParse({ ...input, entries: [{ ...entry, telegramUserId: "123" }] })
      .success,
  ).toBe(false);
});
