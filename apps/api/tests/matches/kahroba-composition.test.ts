import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  kahrobaPlayerViewSchema,
  kahrobaBotPolicy,
  migrateKahrobaState,
} from "@hambazi/kahroba-engine";
import { gameResultV2Schema, matchFinishedV2Schema } from "@hambazi/validation";
import {
  createKahrobaMatchGame,
  kahrobaMatchDescriptor,
} from "../../src/composition/kahroba-match.js";
import {
  standardResultInputSchema,
  matchFinishedInputSchema,
} from "../../src/matches/application/result-input.js";
import { matchDomainEventSchema } from "../../src/matches/index.js";
import { statsFinishSchema } from "../../src/leaderboard/application/contracts.js";
import { executableDescriptorSchema } from "../../src/matches/application/admission.js";

const rules = {
  rulesetVersion: "kahroba-base-v1",
  datasetVersion: "kahroba-economy-v1",
  turnDurationMs: null,
  timeoutPolicyVersion: null,
};
it("keeps explicit timing, supported capacities and private roster binding", () => {
  expect(() =>
    createKahrobaMatchGame({ ...rules, turnDurationMs: 1000, timeoutPolicyVersion: "unapproved" }),
  ).toThrow();
  for (const n of [2, 3, 4])
    expect(
      executableDescriptorSchema.safeParse(
        kahrobaMatchDescriptor({ gameId: "kahroba", mode: "standard", capacity: n }),
      ).success,
    ).toBe(true);
  for (const n of [2, 3, 4])
    expect(
      kahrobaMatchDescriptor({ gameId: "kahroba", mode: "standard", capacity: n }),
    ).toMatchObject({ engineVersion: "kahroba-v1" });
  for (const n of [1, 5, 2.5])
    expect(kahrobaMatchDescriptor({ gameId: "kahroba", capacity: n })).toBeNull();
  expect(kahrobaMatchDescriptor({ gameId: "kahroba", mode: "unknown", capacity: 2 })).toBeNull();
  const game = createKahrobaMatchGame(rules),
    ids = [randomUUID(), randomUUID()];
  const state = game.initialize(ids, 1000);
  expect(() => game.restore(state, [...ids].reverse())).toThrow();
  expect(() => game.project(state, randomUUID(), "SPECTATOR")).toThrow();
  expect(game.automation!(state, [], 1000)).toBeNull();
  expect(migrateKahrobaState(state, 1).deadlineAt).toBeNull();
});
it.each([2, 3, 4])(
  "finishes %s-seat composition with a v2 result while preserving strict v1 parsing",
  (n) => {
    const game = createKahrobaMatchGame(rules),
      ids = Array.from({ length: n }, () => randomUUID());
    let state = game.initialize(ids, 1000),
      result: unknown = null;
    for (let turn = 0; turn < 500; turn++) {
      const s = migrateKahrobaState(state, 1);
      if (s.phase === "GAME_OVER") break;
      const actor = s.players[s.turnPlayerIndex]!.id;
      const command = kahrobaBotPolicy.chooseCommand(
        kahrobaPlayerViewSchema.parse(game.project(state, actor, "PLAYER")),
      );
      const next = game.execute(state, command, actor, 1001 + turn);
      state = next.state;
      result = next.result;
    }
    expect(result).not.toBeNull();
    expect(gameResultV2Schema.safeParse(result).success).toBe(true);
    expect(standardResultInputSchema.safeParse(result).success).toBe(false);
  },
);
it.each([1, 2, 3])("preserves %s co-winners in independent result consumers", (count) => {
  const ids = Array.from({ length: 3 }, () => randomUUID());
  const result = {
    schemaVersion: 2,
    winnerIds: ids.slice(0, count),
    winnerId: count === 1 ? ids[0] : null,
    outcome: count === 1 ? "SOLE_VICTORY" : "SHARED_VICTORY",
    placements: ids.map((playerId, i) => ({ playerId, place: i < count ? 1 : count + 1 })),
    reason: count === 1 ? "PRESTIGE_TARGET_REACHED" : "SHARED_VICTORY",
    metrics: { turnsPlayed: 90 },
  };
  const payload = {
    schemaVersion: 2,
    matchId: randomUUID(),
    gameId: "kahroba",
    stateVersion: 91,
    lastEventSeq: 93,
    finishedAt: 10000,
    engineVersion: "kahroba-v1",
    stateSchemaVersion: 1,
    rulesetVersion: "kahroba-base-v1",
    result,
  };
  const event = {
    schemaVersion: 2,
    eventId: randomUUID(),
    aggregateId: payload.matchId,
    occurredAt: 10000,
    type: "MATCH_FINISHED_V2",
    correlation: {},
    payload,
  };
  expect(matchFinishedV2Schema.safeParse(payload).success).toBe(true);
  expect(matchDomainEventSchema.safeParse(event).success).toBe(true);
  expect(statsFinishSchema.safeParse({ eventId: event.eventId, payload }).success).toBe(true);
  expect(matchFinishedInputSchema.safeParse(payload).success).toBe(false);
  expect(
    gameResultV2Schema.safeParse({ ...result, winnerId: count > 1 ? ids[0] : null }).success,
  ).toBe(false);
  expect(gameResultV2Schema.safeParse({ ...result, winnerIds: [ids[0], ids[0]] }).success).toBe(
    false,
  );
  expect(matchDomainEventSchema.safeParse({ ...event, schemaVersion: 1 }).success).toBe(false);
  expect(matchFinishedV2Schema.safeParse({ ...payload, gameId: "coup" }).success).toBe(false);
});
