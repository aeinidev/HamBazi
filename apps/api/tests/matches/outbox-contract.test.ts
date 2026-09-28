import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { matchDomainEventSchema, matchFinishedInputSchema } from "../../src/matches/index.js";
const ids = [randomUUID(), randomUUID()];
function payload() {
  return {
    schemaVersion: 1,
    matchId: randomUUID(),
    gameId: "coup",
    stateVersion: 30,
    lastEventSeq: 40,
    finishedAt: 2000,
    engineVersion: "coup-v1",
    stateSchemaVersion: 4,
    rulesetVersion: "coup-provisional-complete-v1",
    result: {
      placements: [
        { playerId: ids[0], place: 1 },
        { playerId: ids[1], place: 2 },
      ],
      winnerId: ids[0],
      reason: "LAST_PLAYER_STANDING",
      metrics: { turns: 10 },
    },
  };
}
it("versioned finish projection input contains only result and pin metadata", () => {
  const p = payload();
  const event = {
    schemaVersion: 1,
    eventId: randomUUID(),
    aggregateId: p.matchId,
    occurredAt: 2000,
    correlation: {},
    type: "MATCH_FINISHED_V1",
    payload: p,
  };
  expect(matchDomainEventSchema.safeParse(event).success).toBe(true);
  expect(matchDomainEventSchema.safeParse({ ...event, schemaVersion: 2 }).success).toBe(false);
  expect(
    matchDomainEventSchema.safeParse({ ...event, payload: { ...p, snapshot: {} } }).success,
  ).toBe(false);
});
it.each(["deck", "influence", "token", "chatText"])(
  "rejects private %s fields in standard result inputs",
  (key) => {
    const p = payload();
    expect(
      matchFinishedInputSchema.safeParse({ ...p, result: { ...p.result, [key]: "SYNTHETIC" } })
        .success,
    ).toBe(false);
  },
);
it("rejects duplicate placements, an unknown winner and malformed correlation", () => {
  const p = payload();
  expect(
    matchFinishedInputSchema.safeParse({
      ...p,
      result: { ...p.result, placements: [p.result.placements[0], p.result.placements[0]] },
    }).success,
  ).toBe(false);
  expect(
    matchFinishedInputSchema.safeParse({ ...p, result: { ...p.result, winnerId: randomUUID() } })
      .success,
  ).toBe(false);
  expect(
    matchDomainEventSchema.safeParse({
      schemaVersion: 1,
      eventId: randomUUID(),
      aggregateId: p.matchId,
      occurredAt: 2000,
      correlation: { token: "SYNTHETIC" },
      type: "MATCH_FINISHED_V1",
      payload: p,
    }).success,
  ).toBe(false);
});
