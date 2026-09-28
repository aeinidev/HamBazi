import type { GameEngine, StandardGameResult } from "@hambazi/game-core";
import {
  coupCommandSchema,
  coupEventSchema,
  coupCoreDescriptor,
  createCoupInitialState,
  type CoupCommand,
  type CoupEvent,
  type CoupRole,
  type CoupRuleConfig,
  type CoupState,
} from "./model.js";

type CoreCommand = Extract<
  CoupCommand,
  { type: "DECLARE_INCOME" | "DECLARE_FOREIGN_AID" | "DECLARE_COUP" | "SELECT_CARD_TO_LOSE" }
>;
type Player = CoupState["players"][number];
export type CoupErrorCode = "INVALID_INPUT" | "FORBIDDEN" | "GAME_STATE_CONFLICT";

export class CoupError extends Error {
  constructor(readonly code: CoupErrorCode) {
    super(code);
  }
}

function fail(code: CoupErrorCode): never {
  throw new CoupError(code);
}

function player(state: CoupState, id: string): Player {
  return state.players.find((entry) => entry.id === id) ?? fail("FORBIDDEN");
}

function active(state: CoupState): readonly Player[] {
  return state.players.filter((entry) => entry.influence.length > 0);
}

function nextPlayerId(state: CoupState): string {
  const current = player(state, state.turnPlayerId);
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const candidate = state.players[(current.seat + offset) % state.players.length];
    if (candidate && candidate.influence.length > 0) return candidate.id;
  }
  return fail("GAME_STATE_CONFLICT");
}

function readyForNextTurn(state: CoupState): boolean {
  const pending = state.pendingAction;
  if (!pending?.coinsApplied) return false;
  if (pending.kind !== "COUP") return true;
  if (!pending.lossApplied || pending.targetId === null) return false;
  const target = player(state, pending.targetId);
  return target.influence.length > 0 || state.eliminationOrder.includes(target.id);
}

function parsedCoreCommand(input: unknown): CoreCommand {
  const parsed = coupCommandSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  if (
    parsed.data.type !== "DECLARE_INCOME" &&
    parsed.data.type !== "DECLARE_FOREIGN_AID" &&
    parsed.data.type !== "DECLARE_COUP" &&
    parsed.data.type !== "SELECT_CARD_TO_LOSE"
  )
    return fail("GAME_STATE_CONFLICT");
  return parsed.data;
}

function assertVersion(state: CoupState): void {
  if (
    state.engineVersion !== coupCoreDescriptor.engineVersion ||
    state.stateSchemaVersion !== coupCoreDescriptor.stateSchemaVersion ||
    state.rulesetVersion !== coupCoreDescriptor.rulesetVersion ||
    state.rules.rulesetVersion !== coupCoreDescriptor.rulesetVersion
  )
    fail("GAME_STATE_CONFLICT");
}

export function validateCoupCommand(
  state: CoupState,
  input: unknown,
  actorId: string,
): CoreCommand {
  assertVersion(state);
  const command = parsedCoreCommand(input);
  const actor = player(state, actorId);
  if (actor.influence.length === 0 || state.phase === "GAME_OVER") fail("FORBIDDEN");
  if (command.type === "SELECT_CARD_TO_LOSE") {
    const pending = state.pendingAction;
    if (
      state.phase !== "AWAITING_INFLUENCE_LOSS" ||
      pending?.kind !== "COUP" ||
      pending.targetId !== actorId ||
      !pending.coinsApplied ||
      pending.lossApplied ||
      command.cardIndex >= actor.influence.length
    )
      fail("GAME_STATE_CONFLICT");
    return command;
  }
  if (state.phase !== "WAITING_FOR_ACTION" || state.turnPlayerId !== actorId) fail("FORBIDDEN");
  if (actor.coins >= state.rules.mandatoryCoupAt && command.type !== "DECLARE_COUP")
    fail("GAME_STATE_CONFLICT");
  if (command.type === "DECLARE_COUP") {
    if (actor.coins < state.rules.coupCost) fail("GAME_STATE_CONFLICT");
    const target = player(state, command.targetId);
    if (target.id === actorId || target.influence.length === 0) fail("GAME_STATE_CONFLICT");
  }
  return command;
}

function changedPlayer(
  state: CoupState,
  id: string,
  update: (current: Player) => Player,
): CoupState["players"] {
  return Object.freeze(state.players.map((entry) => (entry.id === id ? update(entry) : entry)));
}

export function applyCoupEvent(state: CoupState, input: unknown): CoupState {
  assertVersion(state);
  const parsed = coupEventSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const event = parsed.data;
  if (state.phase === "GAME_OVER") fail("GAME_STATE_CONFLICT");

  switch (event.type) {
    case "ACTION_DECLARED": {
      if (state.phase !== "WAITING_FOR_ACTION") fail("GAME_STATE_CONFLICT");
      if (event.action !== "INCOME" && event.action !== "FOREIGN_AID" && event.action !== "COUP")
        fail("GAME_STATE_CONFLICT");
      const command =
        event.action === "COUP"
          ? { type: "DECLARE_COUP" as const, targetId: event.targetId }
          : { type: `DECLARE_${event.action}` as "DECLARE_INCOME" | "DECLARE_FOREIGN_AID" };
      validateCoupCommand(state, command, event.playerId);
      if (event.action !== "COUP" && event.targetId !== undefined) fail("GAME_STATE_CONFLICT");
      const pending = Object.freeze({
        actorId: event.playerId,
        kind: event.action,
        targetId: event.action === "COUP" ? event.targetId! : null,
        coinsApplied: false,
        lossApplied: false,
      });
      return Object.freeze({
        ...state,
        phase: "RESOLVING_ACTION",
        pendingAction: pending,
        actionCount: state.actionCount + 1,
      });
    }
    case "COINS_CHANGED": {
      const pending = state.pendingAction;
      if (
        state.phase !== "RESOLVING_ACTION" ||
        !pending ||
        pending.coinsApplied ||
        event.playerId !== pending.actorId
      )
        fail("GAME_STATE_CONFLICT");
      const expected =
        pending.kind === "INCOME"
          ? state.rules.incomeCoins
          : pending.kind === "FOREIGN_AID"
            ? state.rules.foreignAidCoins
            : -state.rules.coupCost;
      const actor = player(state, event.playerId);
      const coins = actor.coins + event.delta;
      if (event.delta !== expected || !Number.isSafeInteger(coins) || coins < 0)
        fail("GAME_STATE_CONFLICT");
      return Object.freeze({
        ...state,
        phase: pending.kind === "COUP" ? "AWAITING_INFLUENCE_LOSS" : "RESOLVING_ACTION",
        pendingAction: Object.freeze({ ...pending, coinsApplied: true }),
        players: changedPlayer(state, actor.id, (current) => Object.freeze({ ...current, coins })),
      });
    }
    case "INFLUENCE_LOST": {
      const pending = state.pendingAction;
      if (
        state.phase !== "AWAITING_INFLUENCE_LOSS" ||
        pending?.kind !== "COUP" ||
        !pending.coinsApplied ||
        pending.lossApplied ||
        event.playerId !== pending.targetId
      )
        fail("GAME_STATE_CONFLICT");
      const target = player(state, event.playerId);
      if (target.influence[event.cardIndex] !== event.role) fail("GAME_STATE_CONFLICT");
      return Object.freeze({
        ...state,
        pendingAction: Object.freeze({ ...pending, lossApplied: true }),
        players: changedPlayer(state, target.id, (current) =>
          Object.freeze({
            ...current,
            influence: Object.freeze(
              current.influence.filter((_, index) => index !== event.cardIndex),
            ),
            revealed: Object.freeze([...current.revealed, event.role]),
          }),
        ),
      });
    }
    case "PLAYER_ELIMINATED": {
      const pending = state.pendingAction;
      if (
        state.phase !== "AWAITING_INFLUENCE_LOSS" ||
        pending?.kind !== "COUP" ||
        !pending.lossApplied ||
        event.playerId !== pending.targetId ||
        state.eliminationOrder.includes(event.playerId) ||
        player(state, event.playerId).influence.length !== 0
      )
        fail("GAME_STATE_CONFLICT");
      return Object.freeze({
        ...state,
        eliminationOrder: Object.freeze([...state.eliminationOrder, event.playerId]),
      });
    }
    case "TURN_STARTED": {
      if (
        !readyForNextTurn(state) ||
        active(state).length < 2 ||
        event.turnNumber !== state.turnNumber + 1 ||
        event.playerId !== nextPlayerId(state)
      )
        fail("GAME_STATE_CONFLICT");
      return Object.freeze({
        ...state,
        phase: "WAITING_FOR_ACTION",
        turnNumber: event.turnNumber,
        turnPlayerId: event.playerId,
        pendingAction: null,
      });
    }
    case "GAME_ENDED": {
      if (
        !readyForNextTurn(state) ||
        state.pendingAction?.kind !== "COUP" ||
        active(state).length !== 1 ||
        active(state)[0]?.id !== event.winnerId ||
        event.reason !== "LAST_PLAYER_STANDING"
      )
        fail("GAME_STATE_CONFLICT");
      return Object.freeze({
        ...state,
        phase: "GAME_OVER",
        winnerId: event.winnerId,
        pendingAction: null,
      });
    }
  }
}

export function executeCoupCommand(
  state: CoupState,
  input: unknown,
  actorId: string,
): readonly CoupEvent[] {
  const command = validateCoupCommand(state, input, actorId);
  const events: CoupEvent[] = [];
  let working = state;
  const emit = (event: CoupEvent) => {
    working = applyCoupEvent(working, event);
    events.push(event);
  };
  if (command.type === "SELECT_CARD_TO_LOSE") {
    const role = player(working, actorId).influence[command.cardIndex]!;
    emit({ type: "INFLUENCE_LOST", playerId: actorId, cardIndex: command.cardIndex, role });
    if (player(working, actorId).influence.length === 0)
      emit({ type: "PLAYER_ELIMINATED", playerId: actorId });
    if (active(working).length === 1)
      emit({
        type: "GAME_ENDED",
        winnerId: active(working)[0]!.id,
        reason: "LAST_PLAYER_STANDING",
      });
    else
      emit({
        type: "TURN_STARTED",
        playerId: nextPlayerId(working),
        turnNumber: working.turnNumber + 1,
      });
  } else {
    const action = command.type.slice("DECLARE_".length) as "INCOME" | "FOREIGN_AID" | "COUP";
    emit({
      type: "ACTION_DECLARED",
      playerId: actorId,
      action,
      ...(command.type === "DECLARE_COUP" ? { targetId: command.targetId } : {}),
    });
    emit({
      type: "COINS_CHANGED",
      playerId: actorId,
      delta:
        action === "INCOME"
          ? state.rules.incomeCoins
          : action === "FOREIGN_AID"
            ? state.rules.foreignAidCoins
            : -state.rules.coupCost,
    });
    if (action !== "COUP")
      emit({
        type: "TURN_STARTED",
        playerId: nextPlayerId(working),
        turnNumber: working.turnNumber + 1,
      });
  }
  return Object.freeze(events.map((event) => Object.freeze(event)));
}

export interface CoupPublicPlayer {
  readonly id: string;
  readonly seat: number;
  readonly coins: number;
  readonly cardsRemaining: number;
  readonly revealed: readonly CoupRole[];
}
export interface CoupSpectatorView {
  readonly engineVersion: string;
  readonly stateSchemaVersion: number;
  readonly rulesetVersion: string;
  readonly phase: CoupState["phase"];
  readonly turnNumber: number;
  readonly turnPlayerId: string;
  readonly pendingLossTargetId: string | null;
  readonly winnerId: string | null;
  readonly players: readonly CoupPublicPlayer[];
}
export interface CoupPlayerView extends CoupSpectatorView {
  readonly myCards: readonly CoupRole[];
}

export function getCoupSpectatorView(state: CoupState): CoupSpectatorView {
  assertVersion(state);
  return Object.freeze({
    engineVersion: state.engineVersion,
    stateSchemaVersion: state.stateSchemaVersion,
    rulesetVersion: state.rulesetVersion,
    phase: state.phase,
    turnNumber: state.turnNumber,
    turnPlayerId: state.turnPlayerId,
    pendingLossTargetId: state.pendingAction?.kind === "COUP" ? state.pendingAction.targetId : null,
    winnerId: state.winnerId,
    players: Object.freeze(
      state.players.map((entry) =>
        Object.freeze({
          id: entry.id,
          seat: entry.seat,
          coins: entry.coins,
          cardsRemaining: entry.influence.length,
          revealed: Object.freeze([...entry.revealed]),
        }),
      ),
    ),
  });
}

export function getCoupPlayerView(state: CoupState, playerId: string): CoupPlayerView {
  const own = player(state, playerId);
  return Object.freeze({
    ...getCoupSpectatorView(state),
    myCards: Object.freeze([...own.influence]),
  });
}

export function getCoupResult(state: CoupState): StandardGameResult | null {
  assertVersion(state);
  if (state.phase !== "GAME_OVER" || state.winnerId === null) return null;
  const order = [state.winnerId, ...[...state.eliminationOrder].reverse()];
  return Object.freeze({
    placements: Object.freeze(
      order.map((playerId, index) => Object.freeze({ playerId, place: index + 1 })),
    ),
    winnerId: state.winnerId,
    reason: "LAST_PLAYER_STANDING",
    metrics: Object.freeze({ turnsPlayed: state.turnNumber, actionsDeclared: state.actionCount }),
  });
}

export const coupCoreEngine: GameEngine<
  CoupState,
  unknown,
  unknown,
  CoupEvent,
  CoupPlayerView,
  CoupRuleConfig,
  CoupSpectatorView
> = Object.freeze({
  descriptor: coupCoreDescriptor,
  createInitialState: createCoupInitialState,
  validateCommand(state: CoupState, command: unknown, actorId: string) {
    validateCoupCommand(state, command, actorId);
  },
  execute(state: CoupState, command: unknown, actorId: string) {
    return executeCoupCommand(state, command, actorId);
  },
  applyEvent: applyCoupEvent,
  getPlayerView: getCoupPlayerView,
  getSpectatorView: getCoupSpectatorView,
  getResult: getCoupResult,
});
