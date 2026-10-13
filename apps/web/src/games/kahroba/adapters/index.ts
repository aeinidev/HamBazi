import { z } from "zod";
import type { Snapshot } from "../../../platform/contracts.js";
// Public transport projection only. No engine, dataset, reducer or hidden-state schema.
export const GEM_COLORS = ["diamond", "sapphire", "emerald", "ruby", "onyx"] as const;
export const TOKEN_COLORS = [...GEM_COLORS, "gold"] as const;
const gemSchema = z.enum(GEM_COLORS);
const playerIdSchema = z.uuid();
const countSchema = z.number().int().min(0).max(2147483647);
const timeSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const tierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const cardIdSchema = z.string().regex(/^kahroba-card-(?:[0-8][0-9])$/);
const nobleIdSchema = z.string().regex(/^kahroba-noble-0[0-9]$/);
export const gemVectorSchema = z.strictObject({
  diamond: countSchema,
  sapphire: countSchema,
  emerald: countSchema,
  ruby: countSchema,
  onyx: countSchema,
});
export const tokenVectorSchema = gemVectorSchema.extend({ gold: countSchema });
export const developmentCardSchema = z.strictObject({
  id: cardIdSchema,
  tier: tierSchema,
  bonus: gemSchema,
  prestige: countSchema,
  cost: gemVectorSchema,
});
const nobleSchema = z.strictObject({
  id: nobleIdSchema,
  prestige: z.literal(3),
  requirements: gemVectorSchema,
});
const choices = { nobleId: nobleIdSchema.optional() };
export const commandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("TAKE_TOKENS"),
    selection: z.discriminatedUnion("mode", [
      z.strictObject({ mode: z.literal("DISTINCT"), colors: z.array(gemSchema).min(1).max(3) }),
      z.strictObject({ mode: z.literal("DOUBLE"), color: gemSchema }),
    ]),
    returnTokens: tokenVectorSchema.optional(),
    ...choices,
  }),
  z.strictObject({
    type: z.literal("BUY_CARD"),
    source: z.enum(["MARKET", "RESERVED"]),
    cardId: cardIdSchema,
    payment: tokenVectorSchema,
    ...choices,
  }),
  z.strictObject({
    type: z.literal("RESERVE_CARD"),
    source: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("MARKET"), cardId: cardIdSchema }),
      z.strictObject({ kind: z.literal("DECK"), tier: tierSchema }),
    ]),
    returnTokens: tokenVectorSchema.optional(),
    ...choices,
  }),
  z.strictObject({ type: z.literal("PASS"), ...choices }),
]);
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
  finalRound: z
    .strictObject({
      triggerPlayerId: playerIdSchema,
      triggerTurnNumber: countSchema.positive(),
      endTurnNumber: countSchema.positive(),
    })
    .nullable(),
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
    legalCommands: z.array(commandSchema).max(256),
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

export type GemColor = (typeof GEM_COLORS)[number];
export type TokenColor = (typeof TOKEN_COLORS)[number];
export type TokenVector = z.infer<typeof tokenVectorSchema>;
export type GemVector = z.infer<typeof gemVectorSchema>;
export type KahrobaCommand = z.infer<typeof commandSchema>;
export type DevelopmentCard = z.infer<typeof developmentCardSchema>;
export type Noble = z.infer<typeof nobleSchema>;
export type KahrobaView = z.infer<typeof kahrobaViewSchema>;
export type KahrobaPlayerView = Extract<KahrobaView, { kind: "PLAYER" }>;
export type PublicPlayer = KahrobaView["players"][number];
export function toKahrobaView(snapshot: Snapshot, viewerId: string): KahrobaView | null {
  if (
    snapshot.gameId !== "kahroba" ||
    snapshot.engineVersion !== "kahroba-v1" ||
    snapshot.stateSchemaVersion !== 1 ||
    snapshot.rulesetVersion !== "kahroba-base-v1"
  )
    return null;
  const parsed = kahrobaViewSchema.safeParse(snapshot.view);
  if (!parsed.success) return null;
  const v = parsed.data;
  if (
    v.kind !== snapshot.role ||
    !v.players.some((p) => p.id === viewerId) ||
    (v.kind === "PLAYER" && v.viewerId !== viewerId) ||
    (snapshot.status === "FINISHED" && v.phase !== "GAME_OVER") ||
    (snapshot.status === "ACTIVE" && v.phase !== "WAITING_FOR_ACTION")
  )
    return null;
  return v;
}
export function publicKahrobaSnapshot(snapshot: Snapshot, viewerId: string): Snapshot {
  return { ...snapshot, view: z.json().parse(toKahrobaView(snapshot, viewerId)) };
}
export const zeroTokens = (): TokenVector => ({
  diamond: 0,
  sapphire: 0,
  emerald: 0,
  ruby: 0,
  onyx: 0,
  gold: 0,
});
