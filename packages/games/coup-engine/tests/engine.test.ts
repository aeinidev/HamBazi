import { describe, expect, it } from "vitest";
import {
  CoupError,
  applyCoupEvent,
  coupCoreEngine,
  createCoupInitialState,
  executeCoupCommand,
  getCoupPlayerView,
  getCoupResult,
  getCoupSpectatorView,
  type CoupEvent,
  type CoupState,
} from "../src/index.js";

const ids = [
  "a9659a20-93bb-4b86-a7bc-fc64600da8f6",
  "bb55f7c2-3337-4c55-81d1-3ca671aa3a2c",
  "e72d93cd-0df9-49fd-a49a-3fd38a393146",
  "d124ca36-3757-49c7-b0ed-ff39512f0448",
  "bb5757a9-0a15-49c2-bb1e-ef156991d5ec",
  "6c232945-797d-4fb3-96c4-f8855e68229c",
] as const;
const rules = {
  rulesetVersion: "coup-provisional-core-v1",
  copiesPerRole: 3,
  cardsPerPlayer: 2,
  startingCoins: 2,
  incomeCoins: 1,
  foreignAidCoins: 2,
  coupCost: 7,
  mandatoryCoupAt: 10,
} as const;
function initial(size = 2, coins: number = rules.startingCoins, seed = 91) {
  let value = seed;
  return createCoupInitialState(
    { playerIds: ids.slice(0, size) },
    {
      rules: { ...rules, startingCoins: coins },
      clock: { now: () => 1720000000000 },
      random: {
        nextInt: (upper) => (value = (Math.imul(value, 1664525) + 1013904223) >>> 0) % upper,
      },
    },
  );
}
function step(state: CoupState, command: unknown, actorId: string) {
  const events = executeCoupCommand(state, command, actorId);
  const next = events.reduce((current, event) => applyCoupEvent(current, event), state);
  return { events, next };
}
function expectCode(operation: () => unknown, code: CoupError["code"]) {
  try {
    operation();
    throw new Error("Expected CoupError");
  } catch (error) {
    expect(error).toBeInstanceOf(CoupError);
    expect((error as CoupError).code).toBe(code);
  }
}
function conserve(state: CoupState) {
  const cards = [
    ...state.deck,
    ...state.players.flatMap((player) => [...player.influence, ...player.revealed]),
  ];
  expect(cards).toHaveLength(15);
  for (const role of ["DUKE", "ASSASSIN", "CAPTAIN", "AMBASSADOR", "CONTESSA"])
    expect(cards.filter((card) => card === role)).toHaveLength(3);
  expect(
    state.players.every((player) => Number.isSafeInteger(player.coins) && player.coins >= 0),
  ).toBe(true);
  expect(state.eliminationOrder).toHaveLength(new Set(state.eliminationOrder).size);
  const live = state.players.filter((entry) => entry.influence.length > 0);
  expect(live.some((entry) => entry.id === state.turnPlayerId)).toBe(true);
  if (state.phase === "GAME_OVER") {
    expect(live).toHaveLength(1);
    expect(state.winnerId).toBe(live[0]?.id);
    expect(state.eliminationOrder).toHaveLength(state.players.length - 1);
  } else {
    expect(state.winnerId).toBeNull();
    expect(live.length).toBeGreaterThan(1);
  }
  if (state.pendingAction !== null) {
    expect(state.pendingAction.actorId).toBe(state.turnPlayerId);
    if (state.pendingAction.kind === "COUP")
      expect(state.pendingAction.targetId).not.toBe(state.pendingAction.actorId);
  }
  expect(Object.isFrozen(state)).toBe(true);
}

describe("Coup core actions", () => {
  it("resolves income and provisional unblocked foreign aid with ordered replayable events", () => {
    const start = initial();
    expect(coupCoreEngine.descriptor).toMatchObject({
      engineVersion: "coup-core-v1",
      stateSchemaVersion: 2,
    });
    const income = step(start, { type: "DECLARE_INCOME" }, ids[0]);
    expect(
      coupCoreEngine.execute(start, { type: "DECLARE_INCOME" }, ids[0], {
        clock: { now: () => 1720000000000 },
        random: { nextInt: () => 0 },
        rules: start.rules,
      }),
    ).toEqual(income.events);
    expect(income.events.map((event) => event.type)).toEqual([
      "ACTION_DECLARED",
      "COINS_CHANGED",
      "TURN_STARTED",
    ]);
    expect(income.next.players[0]?.coins).toBe(3);
    expect(income.next.turnPlayerId).toBe(ids[1]);
    expect(income.next.turnNumber).toBe(2);
    expect(start.players[0]?.coins).toBe(2);
    const aid = step(income.next, { type: "DECLARE_FOREIGN_AID" }, ids[1]);
    expect(aid.next.players[1]?.coins).toBe(4);
    expect(aid.next.turnPlayerId).toBe(ids[0]);
    expect(aid.next.actionCount).toBe(2);
    expect(getCoupResult(aid.next)).toBeNull();
    const replay = [...income.events, ...aid.events].reduce(applyCoupEvent, start);
    expect(replay).toEqual(aid.next);
  });

  it("charges a coup before the target chooses a card and rejects competing commands", () => {
    const start = initial(2, 7);
    const declared = step(start, { type: "DECLARE_COUP", targetId: ids[1] }, ids[0]);
    expect(declared.events.map((event) => event.type)).toEqual([
      "ACTION_DECLARED",
      "COINS_CHANGED",
    ]);
    expect(declared.next.players[0]?.coins).toBe(0);
    expect(declared.next.phase).toBe("AWAITING_INFLUENCE_LOSS");
    expectCode(() => step(declared.next, { type: "DECLARE_INCOME" }, ids[0]), "FORBIDDEN");
    expectCode(
      () => step(declared.next, { type: "SELECT_CARD_TO_LOSE", cardIndex: 0 }, ids[0]),
      "GAME_STATE_CONFLICT",
    );
    const lost = step(declared.next, { type: "SELECT_CARD_TO_LOSE", cardIndex: 1 }, ids[1]);
    expect(lost.events.map((event) => event.type)).toEqual(["INFLUENCE_LOST", "TURN_STARTED"]);
    expect(lost.next.players[1]?.influence).toHaveLength(1);
    expect(lost.next.players[1]?.revealed).toHaveLength(1);
    expect(lost.next.turnPlayerId).toBe(ids[1]);
    conserve(lost.next);
  });

  it("enforces turn, target, cost, mandatory coup and terminal rules", () => {
    const start = initial();
    expectCode(() => step(start, { type: "DECLARE_INCOME" }, ids[1]), "FORBIDDEN");
    expectCode(
      () => step(start, { type: "DECLARE_COUP", targetId: ids[1] }, ids[0]),
      "GAME_STATE_CONFLICT",
    );
    expectCode(
      () => step(initial(2, 7), { type: "DECLARE_COUP", targetId: ids[0] }, ids[0]),
      "GAME_STATE_CONFLICT",
    );
    expectCode(
      () => step(initial(2, 10), { type: "DECLARE_INCOME" }, ids[0]),
      "GAME_STATE_CONFLICT",
    );
    expectCode(
      () => step(initial(2, 10), { type: "DECLARE_FOREIGN_AID" }, ids[0]),
      "GAME_STATE_CONFLICT",
    );
    expectCode(() => step(start, { type: "DECLARE_TAX" }, ids[0]), "GAME_STATE_CONFLICT");
    expectCode(() => step(start, { type: "DECLARE_INCOME", coins: 99 }, ids[0]), "INVALID_INPUT");
  });

  it("rejects duplicate or forged events without mutating the source state", () => {
    const start = initial(2, 7);
    const declaration = {
      type: "ACTION_DECLARED",
      playerId: ids[0],
      action: "COUP",
      targetId: ids[1],
    } as const;
    const declared = applyCoupEvent(start, declaration);
    expectCode(() => applyCoupEvent(declared, declaration), "GAME_STATE_CONFLICT");
    expectCode(
      () => applyCoupEvent(declared, { type: "COINS_CHANGED", playerId: ids[0], delta: -6 }),
      "GAME_STATE_CONFLICT",
    );
    const charged = applyCoupEvent(declared, {
      type: "COINS_CHANGED",
      playerId: ids[0],
      delta: -7,
    });
    expectCode(
      () => applyCoupEvent(charged, { type: "COINS_CHANGED", playerId: ids[0], delta: -7 }),
      "GAME_STATE_CONFLICT",
    );
    expectCode(
      () => applyCoupEvent(charged, { type: "TURN_STARTED", playerId: ids[1], turnNumber: 2 }),
      "GAME_STATE_CONFLICT",
    );
    expectCode(
      () =>
        applyCoupEvent(charged, {
          type: "INFLUENCE_LOST",
          playerId: ids[1],
          cardIndex: 0,
          role: "NOT_A_CARD",
        }),
      "INVALID_INPUT",
    );
    expect(start.phase).toBe("WAITING_FOR_ACTION");
    expect(start.players[0]?.coins).toBe(7);
  });

  it("eliminates players, skips their seats, and produces a standard final result", () => {
    let state = initial(3, 20);
    const ledger: CoupEvent[] = [];
    const start = state;
    function play(command: unknown, actor: string) {
      const outcome = step(state, command, actor);
      ledger.push(...outcome.events);
      state = outcome.next;
    }
    play({ type: "DECLARE_COUP", targetId: ids[1] }, ids[0]);
    play({ type: "SELECT_CARD_TO_LOSE", cardIndex: 0 }, ids[1]);
    play({ type: "DECLARE_COUP", targetId: ids[0] }, ids[1]);
    play({ type: "SELECT_CARD_TO_LOSE", cardIndex: 0 }, ids[0]);
    play({ type: "DECLARE_COUP", targetId: ids[1] }, ids[2]);
    play({ type: "SELECT_CARD_TO_LOSE", cardIndex: 0 }, ids[1]);
    expect(state.eliminationOrder).toEqual([ids[1]]);
    expect(state.turnPlayerId).toBe(ids[0]);
    expectCode(() => step(state, { type: "DECLARE_INCOME" }, ids[1]), "FORBIDDEN");
    play({ type: "DECLARE_COUP", targetId: ids[2] }, ids[0]);
    play({ type: "SELECT_CARD_TO_LOSE", cardIndex: 0 }, ids[2]);
    play({ type: "DECLARE_COUP", targetId: ids[0] }, ids[2]);
    play({ type: "SELECT_CARD_TO_LOSE", cardIndex: 0 }, ids[0]);
    // The final turn is resolved using the same public command flow.
    for (let guard = 0; state.phase !== "GAME_OVER" && guard < 40; guard += 1) {
      if (state.phase === "AWAITING_INFLUENCE_LOSS") {
        play({ type: "SELECT_CARD_TO_LOSE", cardIndex: 0 }, state.pendingAction!.targetId!);
      } else {
        const actor = state.turnPlayerId;
        const target = state.players.find(
          (entry) => entry.id !== actor && entry.influence.length > 0,
        )!;
        play({ type: "DECLARE_COUP", targetId: target.id }, actor);
      }
    }
    expect(state.phase).toBe("GAME_OVER");
    const result = getCoupResult(state);
    expect(result?.winnerId).toBe(ids[2]);
    expect(result?.placements.map((entry) => entry.place)).toEqual([1, 2, 3]);
    expect(result?.placements.map((entry) => entry.playerId)).toEqual([ids[2], ids[0], ids[1]]);
    expect(result?.reason).toBe("LAST_PLAYER_STANDING");
    expect(result?.metrics.actionsDeclared).toBe(state.actionCount);
    expectCode(() => step(state, { type: "DECLARE_INCOME" }, ids[2]), "FORBIDDEN");
    expect(ledger.reduce(applyCoupEvent, start)).toEqual(state);
    conserve(state);
  });

  it("projects only own hidden cards and public opponent information", () => {
    const state = initial(3);
    const own = getCoupPlayerView(state, ids[0]);
    const publicView = getCoupSpectatorView(state);
    expect(Object.keys(own).sort()).toEqual(
      [
        "engineVersion",
        "myCards",
        "pendingLossTargetId",
        "phase",
        "players",
        "rulesetVersion",
        "stateSchemaVersion",
        "turnNumber",
        "turnPlayerId",
        "winnerId",
      ].sort(),
    );
    expect(own.myCards).toEqual(state.players[0]?.influence);
    expect(own.players[1]).toEqual({
      id: ids[1],
      seat: 1,
      coins: 2,
      cardsRemaining: 2,
      revealed: [],
    });
    expect("deck" in own).toBe(false);
    expect("influence" in own.players[1]!).toBe(false);
    expect("myCards" in publicView).toBe(false);
    const swapped: CoupState = {
      ...state,
      players: state.players.map((entry, index) =>
        index === 1
          ? { ...entry, influence: [state.deck[0]!, ...entry.influence.slice(1)] }
          : entry,
      ),
      deck: [state.players[1]!.influence[0]!, ...state.deck.slice(1)],
    };
    expect(getCoupPlayerView(swapped, ids[0])).toEqual(own);
    expect(getCoupSpectatorView(swapped)).toEqual(publicView);
    for (let viewer = 0; viewer < state.players.length; viewer += 1) {
      const other = (viewer + 1) % state.players.length;
      const altered: CoupState = {
        ...state,
        players: state.players.map((entry, index) =>
          index === other
            ? { ...entry, influence: [state.deck[0]!, ...entry.influence.slice(1)] }
            : entry,
        ),
        deck: [state.players[other]!.influence[0]!, ...state.deck.slice(1)],
      };
      expect(getCoupPlayerView(altered, ids[viewer]!)).toEqual(
        getCoupPlayerView(state, ids[viewer]!),
      );
    }
    expectCode(() => getCoupPlayerView(state, "00000000-0000-0000-0000-000000000000"), "FORBIDDEN");
    expect(Object.isFrozen(own.players[0])).toBe(true);
    expect(Object.isFrozen(own.myCards)).toBe(true);
  });

  it("finishes across seeded capacities with card and event replay invariants", () => {
    for (let size = 2; size <= 6; size += 1) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const start = initial(size, 2, seed);
        let state = start;
        const ledger: CoupEvent[] = [];
        for (let guard = 0; state.phase !== "GAME_OVER" && guard < 200; guard += 1) {
          const actor =
            state.phase === "AWAITING_INFLUENCE_LOSS"
              ? state.pendingAction!.targetId!
              : state.turnPlayerId;
          const command =
            state.phase === "AWAITING_INFLUENCE_LOSS"
              ? { type: "SELECT_CARD_TO_LOSE", cardIndex: 0 }
              : state.players.find((entry) => entry.id === actor)!.coins >= 7
                ? {
                    type: "DECLARE_COUP",
                    targetId: state.players.find(
                      (entry) => entry.id !== actor && entry.influence.length > 0,
                    )!.id,
                  }
                : guard % 2 === 0
                  ? { type: "DECLARE_INCOME" }
                  : { type: "DECLARE_FOREIGN_AID" };
          const outcome = step(state, command, actor);
          ledger.push(...outcome.events);
          state = outcome.next;
          conserve(state);
        }
        expect(state.phase).toBe("GAME_OVER");
        expect(getCoupResult(state)?.placements).toHaveLength(size);
        expect(ledger.reduce(applyCoupEvent, start)).toEqual(state);
        expect(coupCoreEngine.getSpectatorView?.(state)).toEqual(getCoupSpectatorView(state));
      }
    }
  });
});
