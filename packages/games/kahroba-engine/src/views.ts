import { z } from "zod";
import {
  GEM_COLORS,
  TOKEN_COLORS,
  kahrobaCommandSchema,
  developmentCardSchema,
  nobleSchema,
  playerIdSchema,
  countSchema,
  timeSchema,
  tokenVectorSchema,
  gemVectorSchema,
  kahrobaStateSchema,
  zeroTokens,
  totalTokens,
  freeze,
  fail,
  type KahrobaState,
  type KahrobaCommand,
  type KahrobaResult,
  type TokenVector,
  type ReadonlyDeep,
} from "./model.js";
import { bonuses, prestige, getKahrobaCard, getKahrobaNoble, eligibleNobles } from "./catalog.js";
import { migrateKahrobaState } from "./state.js";
import { defaultPayment, effectiveCost, marketIds, hasLegalPrimaryAction } from "./turn.js";

export const kahrobaResultSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    winnerId: playerIdSchema.nullable(),
    winnerIds: z.array(playerIdSchema).min(1).max(4),
    placements: z
      .array(z.strictObject({ playerId: playerIdSchema, place: countSchema.min(1).max(4) }))
      .min(2)
      .max(4),
    reason: z.enum(["PRESTIGE_TARGET_REACHED", "SHARED_VICTORY"]),
    scores: z
      .array(
        z.strictObject({
          playerId: playerIdSchema,
          prestige: countSchema,
          purchasedCards: countSchema.max(90),
          place: countSchema.min(1).max(4),
        }),
      )
      .min(2)
      .max(4),
    metrics: z.strictObject({
      turns: countSchema,
      passes: countSchema,
      timeouts: countSchema,
      elapsedMs: timeSchema,
    }),
  })
  .refine((r) => {
    const winners = r.scores.filter((p) => p.place === 1).map((p) => p.playerId);
    return (
      new Set(r.scores.map((p) => p.playerId)).size === r.scores.length &&
      r.placements.length === r.scores.length &&
      r.placements.every((p) =>
        r.scores.some((s) => s.playerId === p.playerId && s.place === p.place),
      ) &&
      new Set(r.placements.map((p) => p.playerId)).size === r.placements.length &&
      winners.length === r.winnerIds.length &&
      winners.every((id, i) => id === r.winnerIds[i]) &&
      r.winnerId === (winners.length === 1 ? winners[0] : null) &&
      r.reason === (winners.length === 1 ? "PRESTIGE_TARGET_REACHED" : "SHARED_VICTORY")
    );
  });
export function getKahrobaResult(input: KahrobaState): KahrobaResult | null {
  const s = migrateKahrobaState(input, 1);
  if (s.phase !== "GAME_OVER") return null;
  const ranked = s.players
    .map((p) => ({
      playerId: p.id,
      prestige: prestige(p),
      purchasedCards: p.purchased.length,
      seat: p.seat,
    }))
    .sort(
      (a, b) => b.prestige - a.prestige || a.purchasedCards - b.purchasedCards || a.seat - b.seat,
    );
  const scores: z.infer<typeof kahrobaResultSchema>["scores"] = [];
  for (const [i, p] of ranked.entries()) {
    const previous = ranked[i - 1];
    const place =
      previous && previous.prestige === p.prestige && previous.purchasedCards === p.purchasedCards
        ? scores[i - 1]!.place
        : i + 1;
    scores.push({
      playerId: p.playerId,
      prestige: p.prestige,
      purchasedCards: p.purchasedCards,
      place,
    });
  }
  const winnerIds = scores.filter((p) => p.place === 1).map((p) => p.playerId);
  return freeze(
    kahrobaResultSchema.parse({
      schemaVersion: 1,
      winnerIds,
      winnerId: winnerIds.length === 1 ? winnerIds[0] : null,
      placements: scores.map(({ playerId, place }) => ({ playerId, place })),
      scores,
      reason: winnerIds.length === 1 ? "PRESTIGE_TARGET_REACHED" : "SHARED_VICTORY",
      metrics: { turns: s.revision, ...s.metrics, elapsedMs: s.lastCommandAt - s.createdAt },
    }),
  );
}
const publicPlayer = z.strictObject({
  id: playerIdSchema,
  seat: countSchema.max(3),
  tokens: tokenVectorSchema,
  bonuses: gemVectorSchema,
  prestige: countSchema,
  reservedCount: countSchema.max(3),
  purchased: z.array(developmentCardSchema).max(90),
  nobles: z.array(nobleSchema).max(5),
  turnsTaken: countSchema,
});
const marketRow = z.array(developmentCardSchema.nullable()).length(4);
export const kahrobaPurchaseOptionSchema = z.strictObject({
  source: z.enum(["MARKET", "RESERVED"]),
  cardId: developmentCardSchema.shape.id,
  effectiveCost: gemVectorSchema,
  affordable: z.boolean(),
  eligibleNobleIds: z.array(nobleSchema.shape.id).max(5),
});
const publicBase = {
  engineVersion: z.literal("kahroba-v1"),
  stateSchemaVersion: z.literal(1),
  rulesetVersion: z.literal("kahroba-base-v1"),
  viewSchemaVersion: z.literal(1),
  phase: z.enum(["WAITING_FOR_ACTION", "GAME_OVER"]),
  revision: countSchema,
  turnNumber: countSchema.positive(),
  firstPlayerId: playerIdSchema,
  turnPlayerId: playerIdSchema,
  deadlineAt: timeSchema.nullable(),
  players: z.array(publicPlayer).min(2).max(4),
  bank: tokenVectorSchema,
  market: z.tuple([marketRow, marketRow, marketRow]),
  deckCounts: z.tuple([countSchema.max(40), countSchema.max(30), countSchema.max(20)]),
  nobles: z.array(nobleSchema).max(5),
  finalRound: kahrobaStateSchema.shape.finalRound,
  result: kahrobaResultSchema.nullable(),
};
function coherentPublicView(v: z.infer<typeof kahrobaSpectatorViewBase>): boolean {
  const ids = v.players.map((p) => p.id);
  return (
    new Set(ids).size === ids.length &&
    v.players.every((p, i) => p.seat === i) &&
    ids.includes(v.firstPlayerId) &&
    ids.includes(v.turnPlayerId) &&
    (v.phase === "GAME_OVER") === (v.result !== null)
  );
}
const kahrobaSpectatorViewBase = z.strictObject({
  ...publicBase,
  kind: z.literal("SPECTATOR"),
});
export const kahrobaSpectatorViewSchema = kahrobaSpectatorViewBase.refine(coherentPublicView);
export const kahrobaPlayerViewSchema = z
  .strictObject({
    ...publicBase,
    kind: z.literal("PLAYER"),
    viewerId: playerIdSchema,
    myReserved: z.array(developmentCardSchema).max(3),
    purchaseOptions: z.array(kahrobaPurchaseOptionSchema).max(15),
    // Complete safe defaults per primary choice, not an exhaustive payment/return enumeration.
    legalCommands: z.array(kahrobaCommandSchema).max(256),
  })
  .refine((v) => {
    const owner = v.players.find((p) => p.id === v.viewerId);
    return (
      coherentPublicView({ ...v, kind: "SPECTATOR" }) &&
      owner !== undefined &&
      owner.reservedCount === v.myReserved.length &&
      new Set(v.myReserved.map((c) => c.id)).size === v.myReserved.length &&
      (v.phase === "GAME_OVER" || v.turnPlayerId !== v.viewerId
        ? v.legalCommands.length === 0
        : true)
    );
  });
export const kahrobaViewSchema = z.discriminatedUnion("kind", [
  kahrobaPlayerViewSchema,
  kahrobaSpectatorViewSchema,
]);
export type KahrobaPlayerView = ReadonlyDeep<z.infer<typeof kahrobaPlayerViewSchema>>;
export type KahrobaSpectatorView = ReadonlyDeep<z.infer<typeof kahrobaSpectatorViewSchema>>;
export type KahrobaView = ReadonlyDeep<z.infer<typeof kahrobaViewSchema>>;
export function defaultReturns(tokens: TokenVector): TokenVector {
  const result = zeroTokens(),
    working = { ...tokens };
  for (let i = Math.max(0, totalTokens(tokens) - 10); i > 0; i--) {
    const c = [...TOKEN_COLORS].sort(
      (a, b) =>
        (a === "gold" ? 1 : 0) - (b === "gold" ? 1 : 0) ||
        working[b] - working[a] ||
        TOKEN_COLORS.indexOf(a) - TOKEN_COLORS.indexOf(b),
    )[0]!;
    working[c]--;
    result[c]++;
  }
  return result;
}
function combinations<T>(values: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  return values.flatMap((value, i) =>
    combinations(values.slice(i + 1), size - 1).map((tail) => [value, ...tail]),
  );
}
export function getKahrobaLegalCommands(s: KahrobaState, playerIndex: number): KahrobaCommand[] {
  if (s.phase === "GAME_OVER" || s.turnPlayerIndex !== playerIndex) return [];
  const p = s.players[playerIndex]!,
    commands: KahrobaCommand[] = [];
  function add(command: KahrobaCommand) {
    const after =
      command.type === "BUY_CARD" ? { ...p, purchased: [...p.purchased, command.cardId] } : p;
    const nobles = eligibleNobles(s, after);
    if (nobles.length) for (const nobleId of nobles) commands.push({ ...command, nobleId });
    else commands.push(command);
  }
  const available = GEM_COLORS.filter((c) => s.bank[c] > 0);
  if (available.length) {
    for (const colors of combinations(available, Math.min(3, available.length))) {
      const tokens = { ...p.tokens };
      for (const c of colors) tokens[c]++;
      add({
        type: "TAKE_TOKENS",
        selection: { mode: "DISTINCT", colors },
        returnTokens: defaultReturns(tokens),
      });
    }
    for (const color of available.filter((c) => s.bank[c] >= 4)) {
      const tokens = { ...p.tokens, [color]: p.tokens[color] + 2 };
      add({
        type: "TAKE_TOKENS",
        selection: { mode: "DOUBLE", color },
        returnTokens: defaultReturns(tokens),
      });
    }
  }
  for (const source of ["MARKET", "RESERVED"] as const) {
    for (const cardId of source === "MARKET" ? marketIds(s) : p.reserved) {
      const payment = defaultPayment(s, playerIndex, cardId);
      if (payment) add({ type: "BUY_CARD", source, cardId, payment });
    }
  }
  if (p.reserved.length < 3) {
    const tokens = { ...p.tokens, gold: p.tokens.gold + (s.bank.gold > 0 ? 1 : 0) };
    for (const cardId of marketIds(s))
      add({
        type: "RESERVE_CARD",
        source: { kind: "MARKET", cardId },
        returnTokens: defaultReturns(tokens),
      });
    for (const tier of [1, 2, 3] as const)
      if (s.decks[tier - 1]!.length)
        add({
          type: "RESERVE_CARD",
          source: { kind: "DECK", tier },
          returnTokens: defaultReturns(tokens),
        });
  }
  if (!hasLegalPrimaryAction(s, playerIndex)) add({ type: "PASS" });
  return commands;
}
function project(s: KahrobaState) {
  return {
    engineVersion: s.engineVersion,
    stateSchemaVersion: s.stateSchemaVersion,
    rulesetVersion: s.rulesetVersion,
    viewSchemaVersion: 1 as const,
    phase: s.phase,
    revision: s.revision,
    turnNumber: s.turnNumber,
    firstPlayerId: s.players[s.firstPlayerIndex]!.id,
    turnPlayerId: s.players[s.turnPlayerIndex]!.id,
    deadlineAt: s.deadlineAt,
    players: s.players.map((p) => ({
      id: p.id,
      seat: p.seat,
      tokens: { ...p.tokens },
      bonuses: bonuses(p),
      prestige: prestige(p),
      reservedCount: p.reserved.length,
      purchased: p.purchased.map(getKahrobaCard),
      nobles: p.nobles.map(getKahrobaNoble),
      turnsTaken: p.turnsTaken,
    })),
    bank: { ...s.bank },
    market: s.market.map((row) => row.map((id) => (id === null ? null : getKahrobaCard(id)))),
    deckCounts: s.decks.map((d) => d.length),
    nobles: s.nobles.map(getKahrobaNoble),
    finalRound: s.finalRound ? { ...s.finalRound } : null,
    result: getKahrobaResult(s),
  };
}
export function getKahrobaPlayerView(input: KahrobaState, playerId: string): KahrobaPlayerView {
  const s = migrateKahrobaState(input, 1),
    index = s.players.findIndex((p) => p.id === playerId);
  if (index < 0) fail("INVALID_INPUT");
  return freeze(
    kahrobaPlayerViewSchema.parse({
      ...project(s),
      kind: "PLAYER",
      viewerId: playerId,
      myReserved: s.players[index]!.reserved.map(getKahrobaCard),
      purchaseOptions: getKahrobaPurchaseOptions(s, playerId),
      legalCommands: getKahrobaLegalCommands(s, index),
    }),
  );
}
export function getKahrobaSpectatorView(input: KahrobaState): KahrobaSpectatorView {
  return freeze(
    kahrobaSpectatorViewSchema.parse({
      ...project(migrateKahrobaState(input, 1)),
      kind: "SPECTATOR",
    }),
  );
}
export function getKahrobaPurchaseOptions(input: KahrobaState, playerId: string) {
  const s = migrateKahrobaState(input, 1),
    index = s.players.findIndex((p) => p.id === playerId);
  if (index < 0) fail("INVALID_INPUT");
  const p = s.players[index]!;
  return freeze(
    (["MARKET", "RESERVED"] as const).flatMap((source) =>
      (source === "MARKET" ? marketIds(s) : p.reserved).map((cardId) =>
        kahrobaPurchaseOptionSchema.parse({
          source,
          cardId,
          effectiveCost: effectiveCost(s, index, cardId),
          affordable: defaultPayment(s, index, cardId) !== null,
          eligibleNobleIds: eligibleNobles(s, { ...p, purchased: [...p.purchased, cardId] }),
        }),
      ),
    ),
  );
}
