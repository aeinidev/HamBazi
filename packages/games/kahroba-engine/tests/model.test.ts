import { describe, expect, it } from "vitest";
import {
  kahrobaEngine as engine,
  kahrobaCards,
  kahrobaNobles,
  TOKEN_COLORS,
  GEM_COLORS,
  kahrobaBotPolicy,
  getKahrobaResult,
  totalTokens,
  type KahrobaState,
} from "../src/index.js";
import { initial, random, step } from "./helpers.js";

function assertConservation(s: KahrobaState, n: number) {
  const cards = [
    ...s.decks.flat(),
    ...s.market.flat().filter((c) => c !== null),
    ...s.players.flatMap((p) => [...p.purchased, ...p.reserved]),
  ].sort();
  expect(cards).toEqual(kahrobaCards.map((c) => c.id).sort());
  expect([...s.nobles, ...s.unusedNobles, ...s.players.flatMap((p) => p.nobles)].sort()).toEqual(
    kahrobaNobles.map((x) => x.id).sort(),
  );
  for (const c of TOKEN_COLORS)
    expect(s.bank[c] + s.players.reduce((sum, p) => sum + p.tokens[c], 0)).toBe(
      c === "gold" ? 5 : n === 2 ? 4 : n === 3 ? 5 : 7,
    );
  for (const p of s.players) {
    expect(totalTokens(p.tokens)).toBeLessThanOrEqual(10);
    expect(p.reserved.length).toBeLessThanOrEqual(3);
    expect(TOKEN_COLORS.every((c) => Number.isInteger(p.tokens[c]) && p.tokens[c] >= 0)).toBe(true);
    const view = engine.getPlayerView(s, p.id);
    const publicPlayer = view.players[p.seat]!;
    for (const c of GEM_COLORS)
      expect(publicPlayer.bonuses[c]).toBe(
        p.purchased.filter((id) => kahrobaCards.find((x) => x.id === id)!.bonus === c).length,
      );
    expect(publicPlayer.prestige).toBe(
      p.purchased.reduce((sum, id) => sum + kahrobaCards.find((x) => x.id === id)!.prestige, 0) +
        p.nobles.length * 3,
    );
  }
}
describe("deterministic generated model sequences", () => {
  const mixedCases = [2, 3, 4].flatMap((n) =>
    Array.from({ length: 12 }, (_, seed) => [n, seed] as const),
  );
  const botCases = [2, 3, 4].flatMap((n) =>
    Array.from({ length: 8 }, (_, seed) => [n, seed] as const),
  );
  it.each(mixedCases)("conserves and replays mixed sequences: %i seats, seed %i", (n, seed) => {
    const start = initial(n, seed),
      rng = random(seed + 100),
      log = [];
    let s = start;
    for (let turn = 0; turn < 100 && s.phase !== "GAME_OVER"; turn++) {
      const view = engine.getPlayerView(s, s.players[s.turnPlayerIndex]!.id),
        legal = view.legalCommands;
      for (const command of legal)
        expect(() => engine.validateCommand(s, command, view.viewerId)).not.toThrow();
      const command =
        turn % 3 === 0 ? kahrobaBotPolicy.chooseCommand(view)! : legal[rng.nextInt(legal.length)]!;
      const before = JSON.stringify(s),
        next = step(s, command);
      expect(JSON.stringify(s)).toBe(before);
      expect(next.state.revision).toBe(s.revision + 1);
      log.push(...next.events);
      s = next.state;
      assertConservation(s, n);
    }
    const replay = log.reduce(engine.applyEvent, start);
    expect(replay).toEqual(s);
    expect(getKahrobaResult(replay)).toEqual(getKahrobaResult(s));
  });
  it.each(botCases)("finishes a replayable bot game: %i seats, seed %i", (n, seed) => {
    const start = initial(n, seed),
      log = [];
    let s = start;
    for (let turn = 0; turn < 400 && s.phase !== "GAME_OVER"; turn++) {
      const view = engine.getPlayerView(s, s.players[s.turnPlayerIndex]!.id),
        command = kahrobaBotPolicy.chooseCommand(view);
      expect(command).not.toBeNull();
      engine.validateCommand(s, command!, view.viewerId);
      const next = step(s, command);
      log.push(...next.events);
      s = next.state;
    }
    expect(s.phase).toBe("GAME_OVER");
    assertConservation(s, n);
    expect(log.reduce(engine.applyEvent, start)).toEqual(s);
    expect(getKahrobaResult(s)!.winnerIds.length).toBeGreaterThan(0);
    expect(kahrobaBotPolicy.chooseCommand(engine.getPlayerView(s, s.players[0]!.id))).toBeNull();
  });
});
