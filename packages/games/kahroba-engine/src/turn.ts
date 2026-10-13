import {
  GEM_COLORS,
  TOKEN_COLORS,
  kahrobaCommandSchema,
  fail,
  zeroTokens,
  zeroGems,
  totalTokens,
  type KahrobaState,
  type MutableKahrobaState,
  type KahrobaCommand,
  type GemVector,
  type TokenVector,
} from "./model.js";
import { bonuses, getKahrobaCard, eligibleNobles, prestige } from "./catalog.js";
import { nextDeadline } from "./state.js";

export function effectiveCost(s: KahrobaState, playerIndex: number, cardId: string): GemVector {
  const b = bonuses(s.players[playerIndex]!),
    cost = getKahrobaCard(cardId).cost;
  const result = zeroGems();
  for (const c of GEM_COLORS) result[c] = Math.max(0, cost[c] - b[c]);
  return result;
}
export function defaultPayment(
  s: KahrobaState,
  playerIndex: number,
  cardId: string,
): TokenVector | null {
  const tokens = s.players[playerIndex]!.tokens,
    cost = effectiveCost(s, playerIndex, cardId),
    p = zeroTokens();
  for (const c of GEM_COLORS) {
    p[c] = Math.min(tokens[c], cost[c]);
    p.gold += cost[c] - p[c];
  }
  return p.gold <= tokens.gold ? p : null;
}
export function marketIds(s: KahrobaState): string[] {
  return s.market.flat().filter((id): id is string => id !== null);
}
export function hasLegalPrimaryAction(s: KahrobaState, playerIndex: number): boolean {
  const p = s.players[playerIndex]!;
  return (
    GEM_COLORS.some((c) => s.bank[c] > 0) ||
    (p.reserved.length < 3 && (marketIds(s).length > 0 || s.decks.some((d) => d.length > 0))) ||
    [...marketIds(s), ...p.reserved].some((id) => defaultPayment(s, playerIndex, id) !== null)
  );
}
export function parseKahrobaCommand(input: unknown): KahrobaCommand {
  const r = kahrobaCommandSchema.safeParse(input);
  if (!r.success) fail("INVALID_INPUT");
  return r.data;
}
function conflict(condition: boolean): void {
  if (condition) fail("GAME_STATE_CONFLICT");
}
function removeMarket(s: MutableKahrobaState, id: string): void {
  const tier = s.market.findIndex((row) => row.includes(id));
  conflict(tier < 0);
  const slot = s.market[tier]!.indexOf(id);
  s.market[tier]![slot] = s.decks[tier]!.shift() ?? null;
}
function returnExcess(
  s: MutableKahrobaState,
  index: number,
  requested: TokenVector | undefined,
): void {
  const p = s.players[index]!,
    returns = requested ?? zeroTokens();
  conflict(totalTokens(returns) !== Math.max(0, totalTokens(p.tokens) - 10));
  for (const c of TOKEN_COLORS) {
    conflict(returns[c] > p.tokens[c]);
    p.tokens[c] -= returns[c];
    s.bank[c] += returns[c];
  }
}
/** Mutates only the detached, validated working copy owned by this transition. */
export function resolveTurn(
  state: KahrobaState,
  command: KahrobaCommand,
  actorId: string,
  at: number,
  timeout: boolean,
): KahrobaState {
  conflict(
    state.phase !== "WAITING_FOR_ACTION" || state.players[state.turnPlayerIndex]!.id !== actorId,
  );
  const s = kahrobaStateCopy(state),
    index = s.turnPlayerIndex,
    p = s.players[index]!;
  if (command.type === "TAKE_TOKENS") {
    const selection = command.selection;
    if (selection.mode === "DOUBLE") {
      conflict(s.bank[selection.color] < 4);
      s.bank[selection.color] -= 2;
      p.tokens[selection.color] += 2;
    } else {
      const available = GEM_COLORS.filter((c) => s.bank[c] > 0);
      conflict(
        selection.colors.length !== Math.min(3, available.length) ||
          new Set(selection.colors).size !== selection.colors.length ||
          selection.colors.some((c) => s.bank[c] < 1),
      );
      for (const c of selection.colors) {
        s.bank[c]--;
        p.tokens[c]++;
      }
    }
    returnExcess(s, index, command.returnTokens);
  } else if (command.type === "BUY_CARD") {
    conflict(
      command.source === "MARKET"
        ? !marketIds(s).includes(command.cardId)
        : !p.reserved.includes(command.cardId),
    );
    const cost = effectiveCost(s, index, command.cardId),
      payment = command.payment;
    conflict(
      TOKEN_COLORS.some((c) => payment[c] > p.tokens[c]) ||
        GEM_COLORS.some((c) => payment[c] > cost[c]) ||
        payment.gold !== GEM_COLORS.reduce((sum, c) => sum + cost[c] - payment[c], 0),
    );
    for (const c of TOKEN_COLORS) {
      p.tokens[c] -= payment[c];
      s.bank[c] += payment[c];
    }
    if (command.source === "MARKET") removeMarket(s, command.cardId);
    else p.reserved.splice(p.reserved.indexOf(command.cardId), 1);
    p.purchased.push(command.cardId);
  } else if (command.type === "RESERVE_CARD") {
    conflict(p.reserved.length >= 3);
    if (command.source.kind === "MARKET") {
      conflict(!marketIds(s).includes(command.source.cardId));
      p.reserved.push(command.source.cardId);
      removeMarket(s, command.source.cardId);
    } else {
      const id = s.decks[command.source.tier - 1]!.shift();
      conflict(id === undefined);
      p.reserved.push(id!);
    }
    if (s.bank.gold > 0) {
      s.bank.gold--;
      p.tokens.gold++;
    }
    returnExcess(s, index, command.returnTokens);
  } else {
    conflict(hasLegalPrimaryAction(s, index));
    s.metrics.passes++;
  }
  const eligible = eligibleNobles(s, p);
  conflict(
    (eligible.length === 0 && command.nobleId !== undefined) ||
      (eligible.length > 1 && command.nobleId === undefined) ||
      (command.nobleId !== undefined && !eligible.includes(command.nobleId)),
  );
  const nobleId = command.nobleId ?? (eligible.length === 1 ? eligible[0] : undefined);
  if (nobleId) {
    s.nobles.splice(s.nobles.indexOf(nobleId), 1);
    p.nobles.push(nobleId);
  }
  p.turnsTaken++;
  s.revision++;
  s.lastCommandAt = at;
  if (timeout) s.metrics.timeouts++;
  if (s.finalRound === null && prestige(p) >= 15) {
    s.finalRound = {
      triggerPlayerId: p.id,
      triggerTurnNumber: s.revision,
      endTurnNumber: Math.ceil(s.revision / s.players.length) * s.players.length,
    };
  }
  if (s.finalRound && s.revision === s.finalRound.endTurnNumber) {
    s.phase = "GAME_OVER";
    s.deadlineAt = null;
    s.turnNumber = s.revision;
  } else {
    s.turnPlayerIndex = (index + 1) % s.players.length;
    s.turnNumber = s.revision + 1;
    s.deadlineAt = nextDeadline(at, s.rules.turnDurationMs);
  }
  return s;
}
export function kahrobaStateCopy(s: KahrobaState): MutableKahrobaState {
  return {
    ...s,
    rules: { ...s.rules },
    bank: { ...s.bank },
    metrics: { ...s.metrics },
    players: s.players.map((p) => ({
      ...p,
      tokens: { ...p.tokens },
      purchased: [...p.purchased],
      reserved: [...p.reserved],
      nobles: [...p.nobles],
    })),
    decks: [[...s.decks[0]], [...s.decks[1]], [...s.decks[2]]],
    market: [[...s.market[0]], [...s.market[1]], [...s.market[2]]],
    nobles: [...s.nobles],
    unusedNobles: [...s.unusedNobles],
    finalRound: s.finalRound ? { ...s.finalRound } : null,
  };
}
