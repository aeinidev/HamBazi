import type { Clock, RandomSource, GameEngine, StandardGameResult } from "@hambazi/game-core";
import { CoupError } from "./engine.js";
import { createCoupInitialState, coupCoreDescriptor, type CoupRole } from "./model.js";
import {
  coupClaimsDescriptor,
  coupClaimsRulesSchema,
  coupClaimsCommandSchema,
  coupClaimsEventSchema,
  type CoupClaimsState as State,
  type CoupClaimsRules,
  type CoupClaimsCommand as Command,
  type CoupClaimsEvent as Event,
  type Claim,
  type Continuation,
} from "./claims-model.js";

function fail(): never {
  throw new CoupError("GAME_STATE_CONFLICT");
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}
function version(s: State) {
  if (
    s.engineVersion !== coupClaimsDescriptor.engineVersion ||
    s.stateSchemaVersion !== 3 ||
    s.rulesetVersion !== coupClaimsDescriptor.rulesetVersion ||
    s.rules.rulesetVersion !== s.rulesetVersion
  )
    fail();
}
function player(s: State, id: string) {
  return s.players.find((p) => p.id === id) ?? fail();
}
function live(s: State) {
  return s.players.filter((p) => p.influence.length > 0);
}
function coins(s: State, id: string, delta: number): State {
  const amount = player(s, id).coins + delta;
  if (!Number.isSafeInteger(amount) || amount < 0) fail();
  return { ...s, players: s.players.map((p) => (p.id === id ? { ...p, coins: amount } : p)) };
}
function window(
  s: State,
  phase: State["phase"],
  eligibleIds: readonly string[],
  claim: Claim | null = null,
): State {
  return {
    ...s,
    phase,
    window: { id: s.revision, eligibleIds, passedIds: [], claim },
    proof: null,
    loss: null,
  };
}
function end(s: State): State {
  const remaining = live(s);
  const cleared = {
    ...s,
    pendingAction: null,
    window: null,
    proof: null,
    loss: null,
    players: s.players.map((p) => (p.influence.length ? p : { ...p, coins: 0 })),
  };
  if (remaining.length === 1) return { ...cleared, phase: "GAME_OVER", winnerId: remaining[0]!.id };
  const seat = player(s, s.turnPlayerId).seat;
  for (let i = 1; i <= s.players.length; i++) {
    const next = s.players[(seat + i) % s.players.length]!;
    if (next.influence.length)
      return {
        ...cleared,
        phase: "WAITING_FOR_ACTION",
        turnPlayerId: next.id,
        turnNumber: s.turnNumber + 1,
      };
  }
  return fail();
}
function loss(
  s: State,
  playerId: string,
  reason: NonNullable<State["loss"]>["reason"],
  resume: Continuation,
): State {
  if (!player(s, playerId).influence.length) return resumeAt(s, resume);
  return { ...window(s, "LOSS", [playerId]), loss: { playerId, reason, resume } };
}
function resolve(s: State): State {
  const a = s.pendingAction ?? fail();
  if (a.kind === "COUP" || a.kind === "ASSASSINATION") return loss(s, a.targetId!, a.kind, "END");
  if (a.kind === "STEAL") {
    const amount = Math.min(s.rules.stealCoins, player(s, a.targetId!).coins);
    return end(coins(coins(s, a.targetId!, -amount), a.actorId, amount));
  }
  return end(
    coins(
      s,
      a.actorId,
      a.kind === "INCOME"
        ? s.rules.incomeCoins
        : a.kind === "TAX"
          ? s.rules.taxCoins
          : s.rules.foreignAidCoins,
    ),
  );
}
function verified(s: State): State {
  const a = s.pendingAction ?? fail();
  const eligible =
    a.kind === "FOREIGN_AID"
      ? live(s)
          .filter((p) => p.id !== a.actorId)
          .map((p) => p.id)
      : (a.kind === "STEAL" || a.kind === "ASSASSINATION") &&
          player(s, a.targetId!).influence.length
        ? [a.targetId!]
        : [];
  return eligible.length ? window(s, "BLOCK", eligible) : resolve(s);
}
function resumeAt(s: State, next: Continuation): State {
  return next === "END" ? end(s) : next === "VERIFIED" ? verified(s) : resolve(s);
}
export function createCoupClaimsState(
  input: unknown,
  deps: { clock: Clock; random: RandomSource; rules: CoupClaimsRules },
): State {
  const parsed = coupClaimsRulesSchema.safeParse(deps.rules);
  if (!parsed.success) throw new CoupError("INVALID_INPUT");
  const rules = parsed.data;
  const { taxCoins: _tax, stealCoins: _steal, assassinationCost: _cost, ...baseRules } = rules;
  const base = createCoupInitialState(input, {
    ...deps,
    rules: { ...baseRules, rulesetVersion: coupCoreDescriptor.rulesetVersion },
  });
  return freeze({
    ...base,
    engineVersion: coupClaimsDescriptor.engineVersion,
    stateSchemaVersion: 3,
    rulesetVersion: rules.rulesetVersion,
    rules,
    revision: 0,
    phase: "WAITING_FOR_ACTION",
    pendingAction: null,
    window: null,
    proof: null,
    loss: null,
  });
}
export function validateCoupClaimsCommand(s: State, input: unknown, actorId: string): Command {
  version(s);
  const parsed = coupClaimsCommandSchema.safeParse(input);
  if (!parsed.success) throw new CoupError("INVALID_INPUT");
  const c = parsed.data,
    p = player(s, actorId);
  if (!p.influence.length || s.phase === "GAME_OVER") fail();
  if (!("windowId" in c)) {
    if (s.phase !== "WAITING_FOR_ACTION" || s.turnPlayerId !== actorId) fail();
    if (p.coins >= s.rules.mandatoryCoupAt && c.type !== "DECLARE_COUP") fail();
    if ("targetId" in c && (c.targetId === actorId || !player(s, c.targetId).influence.length))
      fail();
    if (c.type === "DECLARE_COUP" && p.coins < s.rules.coupCost) fail();
    if (c.type === "DECLARE_ASSASSINATION" && p.coins < s.rules.assassinationCost) fail();
    return c;
  }
  const w = s.window;
  if (
    !w ||
    c.windowId !== w.id ||
    !w.eligibleIds.includes(actorId) ||
    w.passedIds.includes(actorId)
  )
    fail();
  switch (c.type) {
    case "PASS_CHALLENGE":
    case "CHALLENGE":
      if (s.phase !== "CHALLENGE") fail();
      break;
    case "PASS_BLOCK":
      if (s.phase !== "BLOCK") fail();
      break;
    case "BLOCK": {
      const kind = s.pendingAction?.kind;
      if (
        s.phase !== "BLOCK" ||
        !(kind === "FOREIGN_AID"
          ? c.role === "DUKE"
          : kind === "STEAL"
            ? c.role === "CAPTAIN" || c.role === "AMBASSADOR"
            : kind === "ASSASSINATION" && c.role === "CONTESSA")
      )
        fail();
      break;
    }
    case "PROVE_CLAIM":
      if (s.phase !== "PROOF" || p.influence[c.cardIndex] !== s.proof?.claim.role) fail();
      break;
    case "CONCEDE_CLAIM":
      if (s.phase !== "PROOF") fail();
      break;
    case "SELECT_CARD_TO_LOSE":
      if (s.phase !== "LOSS" || c.cardIndex >= p.influence.length) fail();
      break;
  }
  return c;
}
function sameCards(a: readonly CoupRole[], b: readonly CoupRole[]) {
  return [...a].sort().join() === [...b].sort().join();
}
export function applyCoupClaimsEvent(state: State, input: unknown): State {
  version(state);
  const parsed = coupClaimsEventSchema.safeParse(input);
  if (!parsed.success) throw new CoupError("INVALID_INPUT");
  const e = parsed.data;
  if (e.expectedRevision !== state.revision) fail();
  const c = validateCoupClaimsCommand(state, e.command, e.actorId);
  if ((c.type === "PROVE_CLAIM") !== (e.replacement !== undefined)) fail();
  let s: State = { ...state, revision: state.revision + 1 };
  if (!("windowId" in c)) {
    const kind = c.type.slice(8) as NonNullable<State["pendingAction"]>["kind"];
    s = {
      ...s,
      actionCount: s.actionCount + 1,
      pendingAction: { actorId: e.actorId, kind, targetId: "targetId" in c ? c.targetId : null },
    };
    if (kind === "COUP") s = coins(s, e.actorId, -s.rules.coupCost);
    if (kind === "ASSASSINATION") s = coins(s, e.actorId, -s.rules.assassinationCost);
    if (kind === "INCOME" || kind === "COUP") return freeze(resolve(s));
    if (kind === "FOREIGN_AID") return freeze(verified(s));
    return freeze(
      window(
        s,
        "CHALLENGE",
        live(s)
          .filter((p) => p.id !== e.actorId)
          .map((p) => p.id),
        {
          kind: "ACTION",
          claimantId: e.actorId,
          role: kind === "TAX" ? "DUKE" : kind === "STEAL" ? "CAPTAIN" : "ASSASSIN",
        },
      ),
    );
  }
  switch (c.type) {
    case "PASS_CHALLENGE":
    case "PASS_BLOCK": {
      const w = state.window!;
      const passedIds = [...w.passedIds, e.actorId];
      s = { ...s, window: { ...w, passedIds } };
      if (passedIds.length === w.eligibleIds.length)
        s = c.type === "PASS_BLOCK" ? resolve(s) : w.claim!.kind === "BLOCK" ? end(s) : verified(s);
      break;
    }
    case "BLOCK":
      s = window(
        s,
        "CHALLENGE",
        live(s)
          .filter((p) => p.id !== e.actorId)
          .map((p) => p.id),
        { kind: "BLOCK", claimantId: e.actorId, role: c.role },
      );
      break;
    case "CHALLENGE": {
      const claim = state.window!.claim!;
      s = { ...window(s, "PROOF", [claim.claimantId]), proof: { claim, challengerId: e.actorId } };
      break;
    }
    case "PROVE_CLAIM": {
      const proof = state.proof!,
        replacement = e.replacement!;
      const card = player(state, e.actorId).influence[c.cardIndex]!;
      if (!sameCards([...state.deck, card], [...replacement.deck, replacement.card])) fail();
      s = {
        ...s,
        deck: replacement.deck,
        players: s.players.map((p) =>
          p.id === e.actorId
            ? {
                ...p,
                influence: p.influence.map((r, i) => (i === c.cardIndex ? replacement.card : r)),
              }
            : p,
        ),
      };
      s = loss(
        s,
        proof.challengerId,
        "CHALLENGE",
        proof.claim.kind === "ACTION" ? "VERIFIED" : "END",
      );
      break;
    }
    case "CONCEDE_CLAIM": {
      const claim = state.proof!.claim;
      if (claim.kind === "ACTION" && s.pendingAction!.kind === "ASSASSINATION")
        s = coins(s, claim.claimantId, s.rules.assassinationCost);
      s = loss(s, claim.claimantId, "CHALLENGE", claim.kind === "ACTION" ? "END" : "RESOLVE");
      break;
    }
    case "SELECT_CARD_TO_LOSE": {
      const p = player(s, e.actorId),
        role = p.influence[c.cardIndex]!;
      s = {
        ...s,
        players: s.players.map((entry) =>
          entry.id === p.id
            ? {
                ...entry,
                influence: entry.influence.filter((_, i) => i !== c.cardIndex),
                revealed: [...entry.revealed, role],
              }
            : entry,
        ),
        eliminationOrder:
          p.influence.length === 1 ? [...s.eliminationOrder, p.id] : s.eliminationOrder,
      };
      s = resumeAt(s, state.loss!.resume);
      break;
    }
  }
  return freeze(s);
}
export function executeCoupClaimsCommand(
  s: State,
  input: unknown,
  actorId: string,
  random: RandomSource,
): readonly Event[] {
  const command = validateCoupClaimsCommand(s, input, actorId);
  let replacement: Event["replacement"];
  if (command.type === "PROVE_CLAIM") {
    const cards = [...s.deck, player(s, actorId).influence[command.cardIndex]!];
    for (let i = cards.length - 1; i > 0; i--) {
      const j = random.nextInt(i + 1);
      if (!Number.isSafeInteger(j) || j < 0 || j > i) fail();
      [cards[i], cards[j]] = [cards[j]!, cards[i]!];
    }
    replacement = { card: cards[0]!, deck: cards.slice(1) };
  }
  const event: Event = {
    type: "COMMAND_RESOLVED",
    schemaVersion: 2,
    expectedRevision: s.revision,
    actorId,
    command,
    ...(replacement ? { replacement } : {}),
  };
  applyCoupClaimsEvent(s, event);
  return freeze([event]);
}
export function getCoupClaimsSpectatorView(s: State) {
  version(s);
  return freeze({
    engineVersion: s.engineVersion,
    stateSchemaVersion: s.stateSchemaVersion,
    rulesetVersion: s.rulesetVersion,
    revision: s.revision,
    phase: s.phase,
    turnNumber: s.turnNumber,
    turnPlayerId: s.turnPlayerId,
    winnerId: s.winnerId,
    pendingAction: s.pendingAction ? { ...s.pendingAction } : null,
    window: s.window
      ? {
          id: s.window.id,
          eligibleIds: [...s.window.eligibleIds],
          passedIds: [...s.window.passedIds],
          claim: s.window.claim ? { ...s.window.claim } : null,
        }
      : null,
    proof: s.proof ? { claim: { ...s.proof.claim }, challengerId: s.proof.challengerId } : null,
    loss: s.loss ? { playerId: s.loss.playerId, reason: s.loss.reason } : null,
    players: s.players.map((p) => ({
      id: p.id,
      seat: p.seat,
      coins: p.coins,
      cardsRemaining: p.influence.length,
      revealed: [...p.revealed],
    })),
  });
}
export function getCoupClaimsPlayerView(s: State, id: string) {
  return freeze({ ...getCoupClaimsSpectatorView(s), myCards: [...player(s, id).influence] });
}
export function getCoupClaimsResult(s: State): StandardGameResult | null {
  version(s);
  if (s.phase !== "GAME_OVER" || !s.winnerId) return null;
  return freeze({
    winnerId: s.winnerId,
    reason: "LAST_PLAYER_STANDING",
    placements: [s.winnerId, ...[...s.eliminationOrder].reverse()].map((playerId, i) => ({
      playerId,
      place: i + 1,
    })),
    metrics: { turnsPlayed: s.turnNumber, actionsDeclared: s.actionCount },
  });
}
export const coupClaimsEngine: GameEngine<
  State,
  unknown,
  unknown,
  Event,
  ReturnType<typeof getCoupClaimsPlayerView>,
  CoupClaimsRules,
  ReturnType<typeof getCoupClaimsSpectatorView>
> = Object.freeze({
  descriptor: coupClaimsDescriptor,
  createInitialState: createCoupClaimsState,
  validateCommand(s: State, c: unknown, id: string) {
    validateCoupClaimsCommand(s, c, id);
  },
  execute(s: State, c: unknown, id: string, deps: { random: RandomSource }) {
    return executeCoupClaimsCommand(s, c, id, deps.random);
  },
  applyEvent: applyCoupClaimsEvent,
  getPlayerView: getCoupClaimsPlayerView,
  getSpectatorView: getCoupClaimsSpectatorView,
  getResult: getCoupClaimsResult,
});
