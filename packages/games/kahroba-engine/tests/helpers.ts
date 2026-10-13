import type { z } from "zod";
import {
  kahrobaEngine as engine,
  kahrobaCards,
  kahrobaNobles,
  zeroTokens,
  TOKEN_COLORS,
  migrateKahrobaState,
  type KahrobaRules,
  type KahrobaState,
  type KahrobaCommand,
  type kahrobaStateSchema,
  type GemColor,
  type TokenVector,
} from "../src/index.js";
export const ids = Array.from({ length: 4 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
export const rules: KahrobaRules = {
  rulesetVersion: "kahroba-base-v1",
  datasetVersion: "kahroba-economy-v1",
  turnDurationMs: null,
  timeoutPolicyVersion: null,
};
export function random(seed: number) {
  let value = seed >>> 0;
  return {
    nextInt(n: number) {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value % n;
    },
  };
}
export function initial(n = 4, seed = 1, config = rules): KahrobaState {
  return engine.createInitialState(
    { playerIds: ids.slice(0, n) },
    { clock: { now: () => 1000 }, random: random(seed), rules: config },
  );
}
type FixtureState = z.infer<typeof kahrobaStateSchema>;
export function clone(s: KahrobaState): FixtureState {
  return JSON.parse(JSON.stringify(s)) as FixtureState;
}
export function step(
  s: KahrobaState,
  command: unknown,
  at = s.lastCommandAt + 1,
  actor = s.players[s.turnPlayerIndex]!.id,
) {
  const events = engine.execute(s, command as KahrobaCommand, actor, {
    clock: { now: () => at },
    random: {
      nextInt() {
        throw new Error("turn must not draw randomness");
      },
    },
    rules: s.rules,
  });
  return { state: events.reduce(engine.applyEvent, s), events };
}
// Synthetic conserved scenarios exercise otherwise rare rule boundaries. They are
// invariant-valid snapshots, not claims of a replayed historical game.
export function scenario(n = 4, relativeTurn = 0, first = 0): FixtureState {
  const s = clone(initial(n));
  s.firstPlayerIndex = first;
  s.revision = n * 30 + relativeTurn;
  s.turnNumber = s.revision + 1;
  s.turnPlayerIndex = (first + s.revision) % n;
  for (const p of s.players)
    p.turnsTaken = Math.floor(s.revision / n) + ((p.seat - first + n) % n < s.revision % n ? 1 : 0);
  return s;
}
export function detachCard(s: FixtureState, id: string): void {
  for (const deck of s.decks) {
    const i = deck.indexOf(id);
    if (i >= 0) deck.splice(i, 1);
  }
  for (let t = 0; t < 3; t++)
    for (let slot = 0; slot < 4; slot++)
      if (s.market[t]![slot] === id) s.market[t]![slot] = s.decks[t]!.shift() ?? null;
  for (const p of s.players)
    for (const list of [p.purchased, p.reserved]) {
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
    }
}
export function own(s: FixtureState, index: number, cardIds: string[], reserved = false): void {
  for (const id of cardIds) {
    detachCard(s, id);
    (reserved ? s.players[index]!.reserved : s.players[index]!.purchased).push(id);
  }
}
export function giveBonuses(
  s: FixtureState,
  index: number,
  amounts: Partial<Record<GemColor, number>>,
  exclude: string[] = [],
): void {
  const occupied = new Set([
    ...s.players.flatMap((p) => [...p.purchased, ...p.reserved]),
    ...exclude,
  ]);
  for (const [color, count] of Object.entries(amounts)) {
    const selected = kahrobaCards
      .filter((c) => c.bonus === color && c.prestige === 0 && !occupied.has(c.id))
      .slice(0, count)
      .map((c) => c.id);
    if (selected.length !== count) throw new Error("fixture inventory exhausted");
    own(s, index, selected);
  }
}
export function holdings(s: FixtureState, index: number, tokens: Partial<TokenVector>): void {
  const p = s.players[index]!;
  for (const c of TOKEN_COLORS) {
    s.bank[c] += p.tokens[c];
    p.tokens[c] = tokens[c] ?? 0;
    s.bank[c] -= p.tokens[c];
  }
}
export function selectNobles(s: FixtureState, preferred: string[]): void {
  const all = [
    ...preferred,
    ...kahrobaNobles.map((n) => n.id).filter((id) => !preferred.includes(id)),
  ];
  s.nobles = all.slice(0, s.players.length + 1);
  s.unusedNobles = all.slice(s.players.length + 1);
}
export function expose(s: FixtureState, id: string): void {
  const tier = kahrobaCards.find((c) => c.id === id)!.tier - 1;
  if (s.market[tier]!.includes(id)) return;
  detachCard(s, id);
  const displaced = s.market[tier]![0];
  if (displaced) s.decks[tier]!.unshift(displaced);
  s.market[tier]![0] = id;
}
export function validated(s: KahrobaState) {
  return migrateKahrobaState(s, 1);
}
export function card(id: number) {
  return `kahroba-card-${String(id).padStart(2, "0")}`;
}
export function noble(id: number) {
  return `kahroba-noble-${String(id).padStart(2, "0")}`;
}
export function pay(tokens: Partial<TokenVector>): TokenVector {
  return { ...zeroTokens(), ...tokens };
}
