import { createCoupMatchGame, createAnarchistCoupMatchGame } from "./coup-match.js";
/** Personal-only settings, pinned on creation; not a public game activation. */
const personalRules = Object.freeze({
  copiesPerRole: 3,
  cardsPerPlayer: 2,
  startingCoins: 2,
  incomeCoins: 1,
  foreignAidCoins: 2,
  coupCost: 7,
  mandatoryCoupAt: 10,
  taxCoins: 3,
  stealCoins: 2,
  assassinationCost: 3,
  actionTimeoutMs: 30000,
  responseTimeoutMs: 15000,
  decisionTimeoutMs: 20000,
});
/** Retained executable adapter for every previously pinned personal Match. */
export function createPersonalCoupGame() {
  return createCoupMatchGame({ ...personalRules, rulesetVersion: "coup-provisional-complete-v1" });
}
export function createPersonalAnarchistCoupGame() {
  return createAnarchistCoupMatchGame({
    ...personalRules,
    rulesetVersion: "coup-anarchist-v1",
    anarchistCost: 5,
  });
}
export function createPersonalCoupGames() {
  return [createPersonalAnarchistCoupGame(), createPersonalCoupGame()] as const;
}
