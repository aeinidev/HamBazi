import type { Clock, RandomSource, GameEngine, StandardGameResult } from "@hambazi/game-core";

import { createCoupInitialState, coupCoreDescriptor, type CoupRole } from "./model.js";
import {
  coupDescriptor,
  coupRulesSchema,
  coupModuleEventSchema,
  type CoupModuleState as State,
  type CoupRules,
  type CoupModuleEvent as Event,
  type Claim,
  type Continuation,
} from "./module-model.js";

import {
  conflict as fail,
  freeze,
  assertCoupVersion as version,
  CoupModuleError,
} from "./module-model.js";
import {
  getCoupModulePlayerView,
  getCoupModuleSpectatorView,
  timeoutDecision,
} from "./module-views.js";
import { validateCoupModuleCommand } from "./module-validation.js";
import { migrateCoupState } from "./module-compatibility.js";

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
    exchange: null,
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
    exchange: null,
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
  if (a.kind === "EXCHANGE") {
    if (live(s).length === 1) return end(s);
    if (s.deck.length < 2) fail();
    return {
      ...window(s, "EXCHANGE", [a.actorId]),
      deck: s.deck.slice(2),
      exchange: { playerId: a.actorId, drawn: s.deck.slice(0, 2) },
    };
  }
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
export function createCoupModuleState(
  input: unknown,
  deps: { clock: Clock; random: RandomSource; rules: CoupRules },
): State {
  const parsed = coupRulesSchema.safeParse(deps.rules);
  if (!parsed.success) throw new CoupModuleError("INVALID_INPUT");
  const rules = parsed.data;
  const {
    taxCoins: _tax,
    stealCoins: _steal,
    assassinationCost: _cost,
    actionTimeoutMs: _action,
    responseTimeoutMs: _response,
    decisionTimeoutMs: _decision,
    ...baseRules
  } = rules;
  const base = createCoupInitialState(input, {
    ...deps,
    rules: { ...baseRules, rulesetVersion: coupCoreDescriptor.rulesetVersion },
  });
  if (base.deck.length < 2) throw new CoupModuleError("INVALID_INPUT");
  return freeze({
    ...base,
    engineVersion: coupDescriptor.engineVersion,
    stateSchemaVersion: 4,
    lastCommandAt: base.createdAt,
    deadlineAt: deadline(base.createdAt, rules.actionTimeoutMs),
    metrics: {
      challenges: 0,
      claimsProved: 0,
      claimsConceded: 0,
      blocks: 0,
      exchanges: 0,
      timeouts: 0,
    },
    rulesetVersion: rules.rulesetVersion,
    rules,
    revision: 0,
    phase: "WAITING_FOR_ACTION",
    pendingAction: null,
    window: null,
    proof: null,
    loss: null,
    exchange: null,
  });
}
function sameCards(a: readonly CoupRole[], b: readonly CoupRole[]) {
  return [...a].sort().join() === [...b].sort().join();
}
function reduceEvent(state: State, e: Event): State {
  version(state);
  const c = validateCoupModuleCommand(state, e.command, e.actorId);
  if ((c.type === "PROVE_CLAIM") !== (e.replacement !== undefined)) fail();
  if ((c.type === "SELECT_EXCHANGE") !== (e.returnedDeck !== undefined)) fail();
  let s: State = {
    ...state,
    revision: state.revision + 1,
    lastCommandAt: e.occurredAt,
    metrics: {
      ...state.metrics,
      timeouts: state.metrics.timeouts + (e.source === "TIMEOUT" ? 1 : 0),
    },
  };
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
          role:
            kind === "TAX"
              ? "DUKE"
              : kind === "STEAL"
                ? "CAPTAIN"
                : kind === "EXCHANGE"
                  ? "AMBASSADOR"
                  : "ASSASSIN",
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
      s = { ...s, metrics: { ...s.metrics, blocks: s.metrics.blocks + 1 } };
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
      s = { ...s, metrics: { ...s.metrics, challenges: s.metrics.challenges + 1 } };
      const claim = state.window!.claim!;
      s = { ...window(s, "PROOF", [claim.claimantId]), proof: { claim, challengerId: e.actorId } };
      break;
    }
    case "PROVE_CLAIM": {
      s = { ...s, metrics: { ...s.metrics, claimsProved: s.metrics.claimsProved + 1 } };
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
      s = { ...s, metrics: { ...s.metrics, claimsConceded: s.metrics.claimsConceded + 1 } };
      const claim = state.proof!.claim;
      if (claim.kind === "ACTION" && s.pendingAction!.kind === "ASSASSINATION")
        s = coins(s, claim.claimantId, s.rules.assassinationCost);
      s = loss(s, claim.claimantId, "CHALLENGE", claim.kind === "ACTION" ? "END" : "RESOLVE");
      break;
    }
    case "SELECT_EXCHANGE": {
      const p = player(s, e.actorId),
        pool = [...p.influence, ...s.exchange!.drawn];
      const kept = c.cardIndices.map((i) => pool[i]!);
      const returned = pool.filter((_, i) => !c.cardIndices.includes(i));
      if (!sameCards([...s.deck, ...returned], e.returnedDeck!)) fail();
      s = end({
        ...s,
        deck: e.returnedDeck!,
        exchange: null,
        metrics: { ...s.metrics, exchanges: s.metrics.exchanges + 1 },
        players: s.players.map((entry) =>
          entry.id === p.id ? { ...entry, influence: kept } : entry,
        ),
      });
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
function deadline(now: number, duration: number): number {
  const result = now + duration;
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(result)) fail();
  return result;
}
function nextDeadline(before: State, after: State, at: number): number | null {
  if (after.phase === "GAME_OVER") return null;
  if (
    before.phase === after.phase &&
    before.turnNumber === after.turnNumber &&
    before.window?.id === after.window?.id
  )
    return before.deadlineAt;
  return deadline(
    at,
    after.phase === "WAITING_FOR_ACTION"
      ? after.rules.actionTimeoutMs
      : after.phase === "CHALLENGE" || after.phase === "BLOCK"
        ? after.rules.responseTimeoutMs
        : after.rules.decisionTimeoutMs,
  );
}
function verifyTiming(s: State, at: number, source: Event["source"]): void {
  if (
    !Number.isSafeInteger(at) ||
    at < s.lastCommandAt ||
    s.deadlineAt === null ||
    (source === "TIMEOUT" ? at < s.deadlineAt : at >= s.deadlineAt)
  )
    fail();
}
export function applyCoupModuleEvent(state: State, input: unknown): State {
  version(state);
  const parsed = coupModuleEventSchema.safeParse(input);
  if (!parsed.success) throw new CoupModuleError("INVALID_INPUT");
  const e = parsed.data;
  if (e.expectedRevision !== state.revision) fail();
  verifyTiming(state, e.occurredAt, e.source);
  if (e.source === "TIMEOUT") {
    const choice = timeoutDecision(state);
    if (
      !choice ||
      choice.actorId !== e.actorId ||
      JSON.stringify(choice.command) !== JSON.stringify(e.command)
    )
      fail();
  }
  const result = reduceEvent(state, e);
  if (e.deadlineAt !== nextDeadline(state, result, e.occurredAt)) fail();
  return freeze({ ...result, deadlineAt: e.deadlineAt });
}
function shuffled(cards: readonly CoupRole[], random: RandomSource): CoupRole[] {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random.nextInt(i + 1);
    if (!Number.isSafeInteger(j) || j < 0 || j > i) fail();
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
function execute(
  s: State,
  input: unknown,
  actorId: string,
  deps: { clock: Clock; random: RandomSource },
  source: Event["source"],
): readonly Event[] {
  const command = validateCoupModuleCommand(s, input, actorId);
  const occurredAt = deps.clock.now();
  verifyTiming(s, occurredAt, source);
  let replacement: Event["replacement"], returnedDeck: Event["returnedDeck"];
  if (command.type === "PROVE_CLAIM") {
    const cards = shuffled(
      [...s.deck, player(s, actorId).influence[command.cardIndex]!],
      deps.random,
    );
    replacement = { card: cards[0]!, deck: cards.slice(1) };
  }
  if (command.type === "SELECT_EXCHANGE") {
    const pool = [...player(s, actorId).influence, ...s.exchange!.drawn];
    returnedDeck = shuffled(
      [...s.deck, ...pool.filter((_, i) => !command.cardIndices.includes(i))],
      deps.random,
    );
  }
  const draft: Event = {
    type: "COMMAND_RESOLVED",
    schemaVersion: 3,
    expectedRevision: s.revision,
    actorId,
    command,
    source,
    occurredAt,
    deadlineAt: null,
    ...(replacement ? { replacement } : {}),
    ...(returnedDeck ? { returnedDeck } : {}),
  };
  const result = reduceEvent(s, draft);
  const event = { ...draft, deadlineAt: nextDeadline(s, result, occurredAt) };
  applyCoupModuleEvent(s, event);
  return freeze([event]);
}
export function executeCoupModuleCommand(
  s: State,
  input: unknown,
  actorId: string,
  deps: { clock: Clock; random: RandomSource },
): readonly Event[] {
  return execute(s, input, actorId, deps, "PLAYER");
}
export function executeCoupTimeout(
  s: State,
  guard: { expectedRevision: number; deadlineAt: number },
  deps: { clock: Clock; random: RandomSource },
): readonly Event[] {
  version(s);
  if (
    s.phase === "GAME_OVER" ||
    guard.expectedRevision !== s.revision ||
    guard.deadlineAt !== s.deadlineAt
  )
    return [];
  const at = deps.clock.now();
  if (!Number.isSafeInteger(at) || at < s.lastCommandAt) fail();
  if (at < s.deadlineAt!) return [];
  const choice = timeoutDecision(s) ?? fail();
  return execute(
    s,
    choice.command,
    choice.actorId,
    { ...deps, clock: { now: () => at } },
    "TIMEOUT",
  );
}
export function getCoupModuleResult(s: State): StandardGameResult | null {
  version(s);
  if (s.phase !== "GAME_OVER" || !s.winnerId) return null;
  return freeze({
    winnerId: s.winnerId,
    reason: "LAST_PLAYER_STANDING",
    placements: [s.winnerId, ...[...s.eliminationOrder].reverse()].map((playerId, i) => ({
      playerId,
      place: i + 1,
    })),
    metrics: {
      turnsPlayed: s.turnNumber,
      actionsDeclared: s.actionCount,
      durationMs: s.lastCommandAt - s.createdAt,
      ...s.metrics,
    },
  });
}
export const coupEngine: GameEngine<
  State,
  unknown,
  unknown,
  Event,
  ReturnType<typeof getCoupModulePlayerView>,
  CoupRules,
  ReturnType<typeof getCoupModuleSpectatorView>
> = Object.freeze({
  descriptor: coupDescriptor,
  createInitialState: createCoupModuleState,
  validateCommand(s: State, c: unknown, id: string) {
    validateCoupModuleCommand(s, c, id);
  },
  execute(s: State, c: unknown, id: string, deps: { clock: Clock; random: RandomSource }) {
    return executeCoupModuleCommand(s, c, id, deps);
  },
  applyEvent: applyCoupModuleEvent,
  getPlayerView: getCoupModulePlayerView,
  getSpectatorView: getCoupModuleSpectatorView,
  getResult: getCoupModuleResult,
  migrateState: migrateCoupState,
});
