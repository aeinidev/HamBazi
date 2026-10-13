import { describe, expect, it } from "vitest";
import {
  kahrobaEngine as engine,
  kahrobaCards,
  getKahrobaResult,
  GEM_COLORS,
  TOKEN_COLORS,
  totalTokens,
  KahrobaError,
  zeroTokens,
} from "../src/index.js";
import { scenario, validated, own, card, expose, holdings, step, giveBonuses } from "./helpers.js";

function almostFinished(n: number, relative: number, first: number) {
  const s = scenario(n, relative, first),
    index = s.turnPlayerIndex;
  own(s, index, [card(80), card(81), card(75)]);
  expose(s, card(39));
  holdings(s, index, { sapphire: 3 });
  return validated(s);
}
function reach15(s: ReturnType<typeof almostFinished>) {
  return step(s, {
    type: "BUY_CARD",
    source: "MARKET",
    cardId: card(39),
    payment: { ...zeroTokens(), sapphire: 3 },
  }).state;
}
describe("equal final turns and official tie breaking", () => {
  for (const n of [2, 3, 4]) {
    for (let first = 0; first < n; first++)
      for (let relative = 0; relative < n; relative++) {
        it(`${n} seats, starter ${first}, trigger at relative seat ${relative}`, () => {
          const s = almostFinished(n, relative, first),
            actor = s.players[s.turnPlayerIndex]!.id;
          let next = reach15(s);
          const expectedEnd = n * 31;
          expect(next.finalRound).toEqual({
            triggerPlayerId: actor,
            triggerTurnNumber: s.revision + 1,
            endTurnNumber: expectedEnd,
          });
          expect(next.phase).toBe(relative === n - 1 ? "GAME_OVER" : "WAITING_FOR_ACTION");
          while (next.phase !== "GAME_OVER") {
            const command = engine
              .getPlayerView(next, next.players[next.turnPlayerIndex]!.id)
              .legalCommands.find((c) => c.type === "TAKE_TOKENS")!;
            next = step(next, command).state;
            expect(next.finalRound!.endTurnNumber).toBe(expectedEnd);
          }
          expect(next.revision).toBe(expectedEnd);
          expect(new Set(next.players.map((p) => p.turnsTaken))).toEqual(new Set([31]));
          expect(getKahrobaResult(next)!.winnerIds).toEqual([actor]);
          expect(next.deadlineAt).toBeNull();
          expect(() => step(next, { type: "PASS" })).toThrow(KahrobaError);
        });
      }
  }
  it("a later player can exceed the triggerer's score", () => {
    const s = scenario(2, 0, 0);
    own(s, 0, [card(80), card(81), card(75)]);
    own(s, 1, [card(82), card(83), card(76)]);
    giveBonuses(s, 1, { ruby: 2, onyx: 1 });
    own(s, 1, [card(84)], true);
    expose(s, card(39));
    holdings(s, 0, { sapphire: 3 });
    holdings(s, 1, { ruby: 4, onyx: 2 });
    const next = reach15(validated(s));
    // The later player buys another five-point card using their existing bonuses.
    const command = engine
      .getPlayerView(validated(next), next.players[1]!.id)
      .legalCommands.find((c) => c.type === "BUY_CARD" && c.cardId === card(84))!;
    const end = step(validated(next), command).state;
    expect(getKahrobaResult(end)!.winnerIds).toEqual([end.players[1]!.id]);
    expect(getKahrobaResult(end)!.scores[0]!.prestige).toBe(19);
  });
  it.each([false, true])(
    "preserves a shared victory or resolves it by purchased count (extra=%s)",
    (extra) => {
      const s = scenario(2, 0, 0);
      own(s, 0, [card(80), card(81), card(75)]);
      own(s, 1, [card(82), card(83), card(76)]);
      if (extra) own(s, 1, [card(24)]);
      own(s, 0, [card(39)], true);
      own(s, 1, [card(35)], true);
      holdings(s, 0, { sapphire: 3 });
      holdings(s, 1, { emerald: 3 });
      const first = step(validated(s), {
        type: "BUY_CARD",
        source: "RESERVED",
        cardId: card(39),
        payment: { ...zeroTokens(), sapphire: 3 },
      }).state;
      const end = step(first, {
        type: "BUY_CARD",
        source: "RESERVED",
        cardId: card(35),
        payment: { ...zeroTokens(), emerald: 3 },
      }).state;
      const result = getKahrobaResult(end)!;
      expect(result.winnerIds).toEqual(extra ? [s.players[0]!.id] : s.players.map((p) => p.id));
      expect(result.winnerId).toBe(extra ? s.players[0]!.id : null);
      expect(result.reason).toBe(extra ? "PRESTIGE_TARGET_REACHED" : "SHARED_VICTORY");
      expect(result.placements.map((p) => p.place)).toEqual(extra ? [1, 2] : [1, 1]);
      expect(result.scores.map((p) => p.prestige)).toEqual([15, 15]);
    },
  );
});

describe("forced pass authority", () => {
  it("passes only when collection, purchase and reservation are all unavailable", () => {
    const s = scenario(4, 0, 0);
    holdings(s, 0, { diamond: 7, sapphire: 3 });
    // Partition all remaining bank tokens into three ten-token hands.
    for (let index = 1; index < 4; index++) {
      const tokens = zeroTokens();
      let remaining = 10;
      for (const c of TOKEN_COLORS) {
        tokens[c] = Math.min(remaining, s.bank[c]);
        remaining -= tokens[c];
      }
      holdings(s, index, tokens);
    }
    expect(totalTokens(s.bank)).toBe(0);
    const affordable = (id: string) =>
      GEM_COLORS.every(
        (c) => kahrobaCards.find((x) => x.id === id)!.cost[c] <= s.players[0]!.tokens[c],
      );
    const reserved = s.decks[2].filter((id) => !affordable(id)).slice(0, 3);
    own(s, 0, reserved, true);
    for (let tier = 0; tier < 3; tier++) {
      for (const id of [...s.market[tier]!].filter((id) => id !== null && affordable(id))) {
        const slot = s.market[tier]!.indexOf(id),
          replacement = s.decks[tier]!.find((c) => !affordable(c))!;
        s.decks[tier]!.splice(s.decks[tier]!.indexOf(replacement), 1);
        s.decks[tier]!.push(id!);
        s.market[tier]![slot] = replacement;
      }
    }
    const view = engine.getPlayerView(validated(s), s.players[0]!.id);
    expect(view.legalCommands).toEqual([{ type: "PASS" }]);
    const next = step(validated(s), { type: "PASS" }).state;
    expect(next.metrics.passes).toBe(1);
    expect(next.turnPlayerIndex).toBe(1);
    expect(next.bank).toEqual(s.bank);
    for (const p of next.players) expect(p.tokens).toEqual(s.players[p.seat]!.tokens);
    // A released reservation slot is a legal action, even when the gold bank is empty.
    const restored = JSON.parse(JSON.stringify(s)) as typeof s;
    const id = restored.players[0]!.reserved.pop()!;
    restored.decks[2].push(id);
    expect(() => step(validated(restored), { type: "PASS" })).toThrow(KahrobaError);
    expect(() => step(validated(s), { type: "PASS", reason: "client says blocked" })).toThrow(
      KahrobaError,
    );
  });
});
