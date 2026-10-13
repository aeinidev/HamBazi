import type { GameBotPolicy } from "@hambazi/game-core";
import {
  GEM_COLORS,
  TOKEN_COLORS,
  zeroTokens,
  totalTokens,
  freeze,
  type KahrobaCommand,
  type GemVector,
  type TokenVector,
} from "./model.js";
import { kahrobaPlayerViewSchema, type KahrobaPlayerView } from "./views.js";
import { getKahrobaCard } from "./catalog.js";

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function coverage(tokens: TokenVector, cost: GemVector): number {
  const colored = GEM_COLORS.reduce((sum, c) => sum + Math.min(tokens[c], cost[c]), 0);
  return colored + Math.min(tokens.gold, GEM_COLORS.reduce((sum, c) => sum + cost[c], 0) - colored);
}
function returnsFor(tokens: TokenVector, cost: GemVector): TokenVector {
  const working = { ...tokens },
    result = zeroTokens();
  for (let n = Math.max(0, totalTokens(tokens) - 10); n > 0; n--) {
    const options = TOKEN_COLORS.filter((c) => working[c] > 0).map((c) => ({
      c,
      score: coverage({ ...working, [c]: working[c] - 1 }, cost),
    }));
    options.sort(
      (a, b) =>
        b.score - a.score ||
        (a.c === "gold" ? 1 : 0) - (b.c === "gold" ? 1 : 0) ||
        TOKEN_COLORS.indexOf(a.c) - TOKEN_COLORS.indexOf(b.c),
    );
    const color = options[0]!.c;
    working[color]--;
    result[color]++;
  }
  return result;
}
export const kahrobaBotPolicy = freeze({
  strategyVersion: "kahroba-bot-v1",
  chooseCommand(input: KahrobaPlayerView): KahrobaCommand | null {
    const parsed = kahrobaPlayerViewSchema.safeParse(input);
    if (!parsed.success) return null;
    const view = parsed.data,
      own = view.players.find((p) => p.id === view.viewerId);
    if (!own || view.phase === "GAME_OVER" || view.turnPlayerId !== view.viewerId) return null;
    const buys = view.legalCommands.filter((c) => c.type === "BUY_CARD");
    buys.sort(
      (a, b) =>
        getKahrobaCard(b.cardId).prestige +
          (b.nobleId ? 3 : 0) -
          (getKahrobaCard(a.cardId).prestige + (a.nobleId ? 3 : 0)) ||
        compareIds(a.cardId, b.cardId),
    );
    if (buys[0]) return freeze(buys[0]);
    const targets = [...view.market.flat().filter((c) => c !== null), ...view.myReserved]
      .map((card) => {
        const cost = { ...card.cost };
        for (const c of GEM_COLORS) cost[c] = Math.max(0, cost[c] - own.bonuses[c]);
        return {
          card,
          cost,
          distance: GEM_COLORS.reduce((sum, c) => sum + cost[c], 0) - coverage(own.tokens, cost),
        };
      })
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          b.card.prestige - a.card.prestige ||
          compareIds(a.card.id, b.card.id),
      );
    const target = targets[0];
    if (target) {
      const takes = view.legalCommands
        .filter((c) => c.type === "TAKE_TOKENS")
        .map((command) => {
          const tokens = { ...own.tokens };
          if (command.selection.mode === "DOUBLE") tokens[command.selection.color] += 2;
          else for (const c of command.selection.colors) tokens[c]++;
          const returnTokens = returnsFor(tokens, target.cost);
          for (const c of TOKEN_COLORS) tokens[c] -= returnTokens[c];
          return { command: { ...command, returnTokens }, score: coverage(tokens, target.cost) };
        })
        .sort((a, b) => b.score - a.score);
      if (takes[0] && takes[0].score > coverage(own.tokens, target.cost))
        return freeze(takes[0].command);
      const reserve = view.legalCommands.find(
        (c) =>
          c.type === "RESERVE_CARD" &&
          c.source.kind === "MARKET" &&
          c.source.cardId === target.card.id,
      );
      if (reserve && view.bank.gold > 0) return freeze(reserve);
      if (takes[0]) return freeze(takes[0].command);
    }
    return freeze(view.legalCommands[0] ?? null);
  },
} satisfies GameBotPolicy<KahrobaPlayerView, KahrobaCommand>);
