import { z } from "zod";
import type { StandardGameResult } from "@hambazi/game-core";

export const GEM_COLORS = ["diamond", "sapphire", "emerald", "ruby", "onyx"] as const;
export const TOKEN_COLORS = [...GEM_COLORS, "gold"] as const;
export type GemColor = (typeof GEM_COLORS)[number];
export type TokenColor = (typeof TOKEN_COLORS)[number];
export const kahrobaDescriptor = Object.freeze({
  engineVersion: "kahroba-v1",
  stateSchemaVersion: 1,
  rulesetVersion: "kahroba-base-v1",
  commandSchemaVersion: 1,
  eventSchemaVersion: 1,
});
export const kahrobaManifest = Object.freeze({
  id: "kahroba",
  slug: "kahroba",
  title: "کهربا",
  minPlayers: 2,
  maxPlayers: 4,
  modes: Object.freeze(["standard"]),
  matchmakingEnabled: false,
  privateRoomsEnabled: false,
  chatEnabled: false,
  voiceEnabled: false,
  status: "DISABLED" as const,
});
export const countSchema = z.number().int().nonnegative().max(2147483647);
export const timeSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const playerIdSchema = z.uuid().transform((v) => v.toLowerCase());
export const cardIdSchema = z.string().regex(/^kahroba-card-[0-9]{2}$/);
export const nobleIdSchema = z.string().regex(/^kahroba-noble-[0-9]{2}$/);
export const gemSchema = z.enum(GEM_COLORS);
export const tierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const gemVectorSchema = z.strictObject({
  diamond: countSchema.max(90),
  sapphire: countSchema.max(90),
  emerald: countSchema.max(90),
  ruby: countSchema.max(90),
  onyx: countSchema.max(90),
});
export const tokenVectorSchema = gemVectorSchema.extend({ gold: countSchema.max(10) });
export type GemVector = z.infer<typeof gemVectorSchema>;
export type TokenVector = z.infer<typeof tokenVectorSchema>;
export const developmentCardSchema = z.strictObject({
  id: cardIdSchema,
  tier: tierSchema,
  bonus: gemSchema,
  prestige: countSchema.max(5),
  cost: gemVectorSchema,
});
export const nobleSchema = z.strictObject({
  id: nobleIdSchema,
  prestige: z.literal(3),
  requirements: gemVectorSchema,
});
export type ReadonlyDeep<T> = T extends object
  ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
  : T;
export type DevelopmentCard = ReadonlyDeep<z.infer<typeof developmentCardSchema>>;
export type Noble = ReadonlyDeep<z.infer<typeof nobleSchema>>;
export const kahrobaRulesSchema = z
  .strictObject({
    rulesetVersion: z.literal("kahroba-base-v1"),
    datasetVersion: z.literal("kahroba-economy-v1"),
    turnDurationMs: z.number().int().positive().max(86400000).nullable(),
    timeoutPolicyVersion: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,63}$/)
      .nullable(),
  })
  .refine((v) => (v.turnDurationMs === null) === (v.timeoutPolicyVersion === null));
export type KahrobaRules = Readonly<z.infer<typeof kahrobaRulesSchema>>;
const choices = { nobleId: nobleIdSchema.optional() };
export const kahrobaCommandSchema = z.discriminatedUnion("type", [
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
export type KahrobaCommand = ReadonlyDeep<z.infer<typeof kahrobaCommandSchema>>;
export const kahrobaEventSchema = z.strictObject({
  type: z.literal("TURN_RESOLVED"),
  schemaVersion: z.literal(1),
  expectedRevision: countSchema,
  actorId: playerIdSchema,
  command: kahrobaCommandSchema,
  occurredAt: timeSchema,
  source: z.enum(["PLAYER", "TIMEOUT"]),
  timeoutPolicyVersion: z.string().max(64).nullable(),
  deadlineAt: timeSchema.nullable(),
});
export type KahrobaEvent = ReadonlyDeep<z.infer<typeof kahrobaEventSchema>>;
const cardList = z.array(cardIdSchema).max(90);
const marketRow = z.array(cardIdSchema.nullable()).length(4);
export const kahrobaStateSchema = z.strictObject({
  engineVersion: z.literal("kahroba-v1"),
  stateSchemaVersion: z.literal(1),
  rulesetVersion: z.literal("kahroba-base-v1"),
  rules: kahrobaRulesSchema,
  phase: z.enum(["WAITING_FOR_ACTION", "GAME_OVER"]),
  createdAt: timeSchema,
  lastCommandAt: timeSchema,
  deadlineAt: timeSchema.nullable(),
  revision: countSchema,
  turnNumber: countSchema.positive(),
  firstPlayerIndex: countSchema.max(3),
  turnPlayerIndex: countSchema.max(3),
  players: z
    .array(
      z.strictObject({
        id: playerIdSchema,
        seat: countSchema.max(3),
        tokens: tokenVectorSchema,
        purchased: cardList,
        reserved: cardList.max(3),
        nobles: z.array(nobleIdSchema).max(5),
        turnsTaken: countSchema,
      }),
    )
    .min(2)
    .max(4),
  bank: tokenVectorSchema,
  decks: z.tuple([cardList, cardList, cardList]),
  market: z.tuple([marketRow, marketRow, marketRow]),
  nobles: z.array(nobleIdSchema).max(5),
  unusedNobles: z.array(nobleIdSchema).max(7),
  finalRound: z
    .strictObject({
      triggerPlayerId: playerIdSchema,
      triggerTurnNumber: countSchema.positive(),
      endTurnNumber: countSchema.positive(),
    })
    .nullable(),
  metrics: z.strictObject({ passes: countSchema, timeouts: countSchema }),
});
export type MutableKahrobaState = z.infer<typeof kahrobaStateSchema>;
export type KahrobaState = ReadonlyDeep<MutableKahrobaState>;
export interface KahrobaResult extends StandardGameResult {
  readonly schemaVersion: 1;
  readonly winnerIds: readonly string[];
  readonly scores: readonly {
    readonly playerId: string;
    readonly prestige: number;
    readonly purchasedCards: number;
    readonly place: number;
  }[];
}
export class KahrobaError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "GAME_STATE_CONFLICT" | "INCOMPATIBLE_GAME_VERSION",
  ) {
    super(code);
  }
}
export function fail(code: KahrobaError["code"]): never {
  throw new KahrobaError(code);
}
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function zeroGems(): GemVector {
  return { diamond: 0, sapphire: 0, emerald: 0, ruby: 0, onyx: 0 };
}
export function zeroTokens(): TokenVector {
  return { ...zeroGems(), gold: 0 };
}
export function totalTokens(v: TokenVector): number {
  return TOKEN_COLORS.reduce((n, c) => n + v[c], 0);
}
