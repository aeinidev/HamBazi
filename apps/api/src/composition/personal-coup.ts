import { createCoupMatchGame } from "./coup-match.js";
/** Temporary personal-test durations; persisted per Match, never applied to active public games. */
export function createPersonalCoupGame() {
  return createCoupMatchGame({
    rulesetVersion: "coup-provisional-complete-v1",
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
}
