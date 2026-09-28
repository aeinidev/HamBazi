import { describe, expect, it } from "vitest";
import {
  coupCommandSchema,
  coupEventSchema,
  coupFoundationDescriptor,
  coupInitialInputSchema,
  coupRuleConfigSchema,
  coupManifest,
  createCoupInitialState,
} from "../src/index.js";

const playerIds = [
  "a9659a20-93bb-4b86-a7bc-fc64600da8f6",
  "bb55f7c2-3337-4c55-81d1-3ca671aa3a2c",
  "e72d93cd-0df9-49fd-a49a-3fd38a393146",
  "d124ca36-3757-49c7-b0ed-ff39512f0448",
  "bb5757a9-0a15-49c2-bb1e-ef156991d5ec",
  "6c232945-797d-4fb3-96c4-f8855e68229c",
];
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
function seeded(seed: number) {
  let value = seed;
  return {
    nextInt(upperExclusive: number) {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value % upperExclusive;
    },
  };
}
const input = (size: number) => ({ playerIds: playerIds.slice(0, size) });
const create = (size: number, seed: number) =>
  createCoupInitialState(input(size), {
    clock: { now: () => 1720000000000 },
    random: seeded(seed),
    rules,
  });

describe("Coup initial model", () => {
  it("aligns disabled registry metadata and explicit foundation versions", () => {
    expect(coupManifest).toMatchObject({
      id: "coup",
      minPlayers: 2,
      maxPlayers: 6,
      status: "DISABLED",
    });
    expect(Object.isFrozen(coupManifest.modes)).toBe(true);
    expect(coupFoundationDescriptor).toMatchObject({
      stateSchemaVersion: 1,
      commandSchemaVersion: 1,
      eventSchemaVersion: 1,
    });
  });

  it.each([2, 3, 4, 5, 6])("deals a consistent %i-seat state without mutating inputs", (size) => {
    const seats = input(size);
    const state = createCoupInitialState(seats, {
      clock: { now: () => 1720000000000 },
      random: seeded(17),
      rules,
    });
    expect(seats.playerIds).toEqual(playerIds.slice(0, size));
    expect(state.players).toHaveLength(size);
    expect(state.turnPlayerId).toBe(playerIds[0]);
    expect(state.phase).toBe("WAITING_FOR_ACTION");
    expect(state.rules).toEqual(rules);
    expect(Object.isFrozen(state.rules)).toBe(true);
    expect(state.players.map((player) => player.seat)).toEqual(
      Array.from({ length: size }, (_, index) => index),
    );
    expect(
      state.players.every((player) => player.coins === 2 && player.influence.length === 2),
    ).toBe(true);
    const all = [...state.deck, ...state.players.flatMap((player) => player.influence)];
    expect(all).toHaveLength(15);
    for (const role of ["DUKE", "ASSASSIN", "CAPTAIN", "AMBASSADOR", "CONTESSA"])
      expect(all.filter((card) => card === role)).toHaveLength(3);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.players[0]?.influence)).toBe(true);
    expect(Object.isFrozen(state.deck)).toBe(true);
  });

  it("reproduces state from the same injected time and random stream", () => {
    expect(create(6, 91)).toEqual(create(6, 91));
    expect(create(6, 92)).not.toEqual(create(6, 91));
  });

  it("rejects malformed seats, insufficient cards, time and random errors", () => {
    expect(
      coupInitialInputSchema.safeParse({ playerIds: [playerIds[0], playerIds[0]] }).success,
    ).toBe(false);
    expect(coupInitialInputSchema.safeParse({ playerIds: playerIds.slice(0, 1) }).success).toBe(
      false,
    );
    expect(
      coupInitialInputSchema.safeParse({ playerIds: playerIds.slice(0, 2), deck: [] }).success,
    ).toBe(false);
    expect(() =>
      createCoupInitialState(input(6), {
        clock: { now: () => 1 },
        random: seeded(1),
        rules: { ...rules, copiesPerRole: 1 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      createCoupInitialState(input(2), { clock: { now: () => -1 }, random: seeded(1), rules }),
    ).toThrow(RangeError);
    expect(() =>
      createCoupInitialState(input(2), {
        clock: { now: () => 1 },
        random: { nextInt: (bound) => bound },
        rules,
      }),
    ).toThrow(RangeError);
    expect(coupRuleConfigSchema.safeParse({ ...rules, mandatoryCoupAt: 6 }).success).toBe(false);
  });

  it("validates strict version-1 intent and internal-event unions", () => {
    expect(
      coupCommandSchema.safeParse({ type: "DECLARE_STEAL", targetId: playerIds[1] }).success,
    ).toBe(true);
    expect(
      coupCommandSchema.safeParse({ type: "DECLARE_STEAL", targetId: playerIds[1], coins: 99 })
        .success,
    ).toBe(false);
    expect(coupCommandSchema.safeParse({ type: "DEAL_CARD", role: "DUKE" }).success).toBe(false);
    expect(
      coupEventSchema.safeParse({ type: "TURN_STARTED", playerId: playerIds[0], turnNumber: 1 })
        .success,
    ).toBe(true);
    expect(
      coupEventSchema.safeParse({ type: "TURN_STARTED", playerId: playerIds[0], turnNumber: 0 })
        .success,
    ).toBe(false);
  });
});
