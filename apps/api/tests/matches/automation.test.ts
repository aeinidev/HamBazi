import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { coupModule, migrateCoupState, getCoupModulePlayerView } from "@hambazi/coup-engine";
import { createCoupMatchGame } from "../../src/composition/coup-match.js";
import { automationIntentSchema } from "../../src/matches/index.js";
import { rules } from "../fixtures/match-rules.js";

it.each(["BOT", "TIMER"] as const)(
  "completes a full %s Match and replays every event exactly",
  (kind) => {
    const ids = [randomUUID(), randomUUID()];
    const game = createCoupMatchGame(rules);
    let state = migrateCoupState(game.initialize(ids, 1000), 4);
    let replay = state;
    let steps = 0;
    while (state.phase !== "GAME_OVER" && steps++ < 500) {
      const plan = game.automation!(state, kind === "BOT" ? ids : [], state.lastCommandAt);
      expect(plan).not.toBeNull();
      const intent = automationIntentSchema.parse({
        schemaVersion: 1,
        matchId: randomUUID(),
        expectedStateVersion: steps,
        ...plan,
        expectedConnectionEpoch: plan?.playerId ? 1 : null,
      });
      const outcome = game.automate!(state, intent, intent.deadlineAt);
      expect(outcome.events.length).toBeGreaterThan(0);
      for (const event of outcome.events)
        replay = coupModule.engine.applyEvent(
          replay,
          coupModule.schemas.event.parse(event.payload),
        );
      state = migrateCoupState(outcome.state, 4);
      expect(replay).toEqual(state);
    }
    expect(state.phase).toBe("GAME_OVER");
    expect(coupModule.engine.getResult(state)?.placements).toHaveLength(2);
  },
);
it("uses the same legal PlayerView decision as the pinned bot policy", () => {
  const ids = [randomUUID(), randomUUID()];
  const game = createCoupMatchGame(rules);
  const state = migrateCoupState(game.initialize(ids, 1000), 4);
  const plan = game.automation!(state, ids, 1000)!;
  const command = coupModule.botPolicy.chooseCommand(
    getCoupModulePlayerView(state, plan.playerId!),
  );
  const expected = game.execute(state, command, plan.playerId!, plan.deadlineAt);
  const actual = game.automate!(
    state,
    {
      schemaVersion: 1,
      matchId: randomUUID(),
      expectedStateVersion: 1,
      ...plan,
      expectedConnectionEpoch: 1,
    },
    plan.deadlineAt,
  );
  expect(actual).toEqual(expected);
  expect(game.project(state, ids[0]!, "SPECTATOR")).not.toHaveProperty("myCards");
});
it("does not execute early, wrong-deadline or stale-revision jobs", () => {
  const ids = [randomUUID(), randomUUID()];
  const game = createCoupMatchGame(rules);
  const state = game.initialize(ids, 1000);
  const plan = game.automation!(state, [], 1000)!;
  const intent = {
    schemaVersion: 1 as const,
    matchId: randomUUID(),
    expectedStateVersion: 1,
    ...plan,
    expectedConnectionEpoch: null,
  };
  for (const [job, at] of [
    [intent, intent.deadlineAt - 1],
    [{ ...intent, deadlineAt: intent.deadlineAt + 1 }, intent.deadlineAt + 1],
    [{ ...intent, expectedRevision: 999 }, intent.deadlineAt],
  ] as const) {
    const result = game.automate!(state, job, at);
    expect(result.events).toEqual([]);
    expect(result.state).toEqual(state);
  }
});
it.each([
  { kind: "BOT", playerId: null, expectedConnectionEpoch: null },
  { kind: "TIMER", playerId: randomUUID(), expectedConnectionEpoch: 1 },
])("rejects mismatched automation authority %#", (input) => {
  expect(
    automationIntentSchema.safeParse({
      schemaVersion: 1,
      matchId: randomUUID(),
      expectedStateVersion: 1,
      expectedRevision: 1,
      deadlineAt: 2000,
      ...input,
    }).success,
  ).toBe(false);
});

it("prioritizes an overdue timer over bot intent and makes a late bot job harmless", () => {
  const ids = [randomUUID(), randomUUID()];
  const game = createCoupMatchGame(rules);
  const state = migrateCoupState(game.initialize(ids, 1000), 4);
  const bot = game.automation!(state, ids, 1000)!;
  expect(game.automation!(state, ids, state.deadlineAt!)!.kind).toBe("TIMER");
  expect(
    game.automate!(
      state,
      {
        schemaVersion: 1,
        matchId: randomUUID(),
        expectedStateVersion: 1,
        ...bot,
        expectedConnectionEpoch: 1,
      },
      state.deadlineAt!,
    ).events,
  ).toEqual([]);
});
