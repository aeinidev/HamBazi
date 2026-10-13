import { describe, it, expect } from "vitest";
import {
  kahrobaEngine as engine,
  KahrobaError,
  zeroTokens,
  getKahrobaResult,
  migrateKahrobaState,
  executeKahrobaTimeout,
  kahrobaTimerPolicy,
} from "../src/index.js";
import {
  initial,
  scenario,
  own,
  giveBonuses,
  expose,
  holdings,
  selectNobles,
  validated,
  card,
  noble,
  step,
  pay,
  clone,
  rules,
} from "./helpers.js";

describe("additional economic and finish boundaries", () => {
  it("uses a card's bonus only after purchase, not to pay its own matching-color cost", () => {
    const s = scenario();
    expose(s, card(25));
    holdings(s, s.turnPlayerIndex, { diamond: 2, sapphire: 1, onyx: 1 });
    expect(() =>
      step(validated(s), {
        type: "BUY_CARD",
        source: "MARKET",
        cardId: card(25),
        payment: pay({ diamond: 2, sapphire: 1, onyx: 1 }),
      }),
    ).toThrow(KahrobaError);
    holdings(s, s.turnPlayerIndex, { diamond: 3, sapphire: 1, onyx: 1 });
    expect(
      step(validated(s), {
        type: "BUY_CARD",
        source: "MARKET",
        cardId: card(25),
        payment: pay({ diamond: 3, sapphire: 1, onyx: 1 }),
      }).state.players[s.turnPlayerIndex]!.purchased,
    ).toContain(card(25));
  });
  it("triggers the final round from the newly acquired noble", () => {
    const s = scenario(4, 0, 0);
    own(s, 0, [card(80), card(75), card(70)]);
    giveBonuses(s, 0, { sapphire: 4 });
    selectNobles(s, [noble(6), noble(1), noble(3), noble(7), noble(8)]);
    expose(s, card(0));
    holdings(s, 0, { ruby: 2, onyx: 1 });
    const next = step(validated(s), {
      type: "BUY_CARD",
      source: "MARKET",
      cardId: card(0),
      payment: pay({ ruby: 2, onyx: 1 }),
    }).state;
    expect(next.players[0]!.nobles).toEqual([noble(6)]);
    expect(next.finalRound).toMatchObject({
      triggerPlayerId: s.players[0]!.id,
      triggerTurnNumber: s.revision + 1,
    });
    expect(engine.getPlayerView(next, s.players[0]!.id).players[0]!.prestige).toBe(15);
    expect(getKahrobaResult(next)).toBeNull();
  });
  it("awards a noble on the final player's turn after another player triggered the finish", () => {
    const s = scenario(2, 0, 0);
    own(s, 0, [card(80), card(81), card(75)]);
    own(s, 1, [card(84), card(79), card(74)]);
    giveBonuses(s, 1, { ruby: 4 });
    own(s, 1, [card(4)], true);
    selectNobles(s, [noble(8), noble(5), noble(6)]);
    expose(s, card(39));
    holdings(s, 0, { sapphire: 3 });
    holdings(s, 1, { emerald: 2 });
    const first = step(validated(s), {
      type: "BUY_CARD",
      source: "MARKET",
      cardId: card(39),
      payment: pay({ sapphire: 3 }),
    }).state;
    const end = step(first, {
      type: "BUY_CARD",
      source: "RESERVED",
      cardId: card(4),
      payment: pay({ emerald: 2 }),
    }).state;
    expect(end.phase).toBe("GAME_OVER");
    expect(end.players[1]!.nobles).toEqual([noble(8)]);
    expect(getKahrobaResult(end)!.scores.map((p) => p.prestige)).toEqual([15, 15]);
  });
  it("keeps formerly face-up reservations private in current snapshots", () => {
    const start = initial(),
      id = start.market[0][0]!,
      actor = start.players[start.turnPlayerIndex]!.id;
    const s = step(start, { type: "RESERVE_CARD", source: { kind: "MARKET", cardId: id } }).state;
    expect(engine.getPlayerView(s, actor).myReserved[0]!.id).toBe(id);
    expect(JSON.stringify(engine.getSpectatorView(s))).not.toContain(id);
    for (const p of s.players.filter((p) => p.id !== actor))
      expect(JSON.stringify(engine.getPlayerView(s, p.id))).not.toContain(id);
  });
  it("exposes owner-only affordable options with server-computed discounts", () => {
    const s = scenario();
    expose(s, card(0));
    holdings(s, s.turnPlayerIndex, { ruby: 1, onyx: 1, gold: 1 });
    const v = engine.getPlayerView(validated(s), s.players[s.turnPlayerIndex]!.id);
    expect(v.purchaseOptions.find((p) => p.cardId === card(0))).toMatchObject({
      source: "MARKET",
      affordable: true,
      effectiveCost: { ruby: 2, onyx: 1 },
    });
    expect(engine.getSpectatorView(validated(s))).not.toHaveProperty("purchaseOptions");
  });
  it("permits reservation even when a purchase would be affordable", () => {
    const s = scenario();
    expose(s, card(0));
    holdings(s, s.turnPlayerIndex, { ruby: 2, onyx: 1 });
    const next = step(validated(s), {
      type: "RESERVE_CARD",
      source: { kind: "MARKET", cardId: card(0) },
    }).state;
    expect(next.players[s.turnPlayerIndex]!.reserved).toContain(card(0));
    expect(next.players[s.turnPlayerIndex]!.purchased).toHaveLength(0);
  });
  it("rejects invalid noble ownership, oversized reservations and a forged finish trigger", () => {
    const s = scenario();
    const cases = [clone(s), clone(s), clone(s)];
    cases[0]!.players[0]!.nobles.push(cases[0]!.nobles.shift()!);
    own(cases[1]!, 0, cases[1]!.decks[2].slice(0, 4), true);
    cases[2]!.finalRound = {
      triggerPlayerId: s.players[0]!.id,
      triggerTurnNumber: 2,
      endTurnNumber: 4,
    };
    for (const bad of cases) expect(() => migrateKahrobaState(bad, 1)).toThrow(KahrobaError);
  });
  it("validates time bounds and internal timeout guards without enabling a policy", () => {
    const config = { ...rules, turnDurationMs: 100, timeoutPolicyVersion: "fixture-timeout-v1" };
    const deps = {
      clock: { now: () => Number.MAX_SAFE_INTEGER - 50 },
      random: { nextInt: () => 0 },
      rules: config,
    };
    expect(() =>
      engine.createInitialState({ playerIds: initial(2).players.map((p) => p.id) }, deps),
    ).toThrow(KahrobaError);
    const s = initial(2, 1, config),
      guard = kahrobaTimerPolicy.getDeadline(s)!;
    expect(() =>
      executeKahrobaTimeout(
        s,
        { ...guard, expectedRevision: -1 },
        {
          clock: { now: () => 1100 },
          policy: { policyVersion: config.timeoutPolicyVersion, chooseCommand: () => null },
        },
      ),
    ).toThrow(KahrobaError);
    expect(() =>
      executeKahrobaTimeout(s, guard, { clock: { now: () => 1100 }, policy: undefined as never }),
    ).toThrow(KahrobaError);
    expect(() =>
      step(
        s,
        { type: "BUY_CARD", source: "MARKET", cardId: card(0), payment: zeroTokens() },
        1000.5,
      ),
    ).toThrow(KahrobaError);
  });
});
