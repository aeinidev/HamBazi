import { z } from "zod";
import { coupClaimsCommandSchema, coupClaimsRulesSchema } from "./claims-model.js";

export const coupDescriptor = Object.freeze({
  engineVersion: "coup-v1",
  stateSchemaVersion: 4,
  rulesetVersion: "coup-provisional-complete-v1",
  commandSchemaVersion: 3,
  eventSchemaVersion: 3,
});
export const roleSchema = z.enum(["DUKE", "ASSASSIN", "CAPTAIN", "AMBASSADOR", "CONTESSA"]);
export const idSchema = z.uuid().transform((value) => value.toLowerCase());
const count = z.number().int().nonnegative();
const duration = z.number().int().positive().max(86_400_000);
export const coupRulesSchema = z
  .strictObject({
    ...coupClaimsRulesSchema.shape,
    rulesetVersion: z.literal("coup-provisional-complete-v1"),
    actionTimeoutMs: duration,
    responseTimeoutMs: duration,
    decisionTimeoutMs: duration,
  })
  .refine((value) => value.mandatoryCoupAt >= value.coupCost);
export type CoupRules = Readonly<z.infer<typeof coupRulesSchema>>;
export const coupModuleCommandSchema = z.discriminatedUnion("type", [
  ...coupClaimsCommandSchema.options,
  z.strictObject({ type: z.literal("DECLARE_EXCHANGE") }),
  z.strictObject({
    type: z.literal("SELECT_EXCHANGE"),
    windowId: count.positive(),
    cardIndices: z.array(count).min(1).max(3),
  }),
]);
export type CoupModuleCommand = z.infer<typeof coupModuleCommandSchema>;
export const coupModuleEventSchema = z.strictObject({
  type: z.literal("COMMAND_RESOLVED"),
  schemaVersion: z.literal(3),
  expectedRevision: count,
  actorId: idSchema,
  command: coupModuleCommandSchema,
  source: z.enum(["PLAYER", "TIMEOUT"]),
  occurredAt: count,
  deadlineAt: count.nullable(),
  replacement: z.strictObject({ card: roleSchema, deck: z.array(roleSchema).max(50) }).optional(),
  returnedDeck: z.array(roleSchema).max(50).optional(),
});
export type CoupModuleEvent = z.infer<typeof coupModuleEventSchema>;
const claimSchema = z.strictObject({
  kind: z.enum(["ACTION", "BLOCK"]),
  claimantId: idSchema,
  role: roleSchema,
});
export type Claim = Readonly<z.infer<typeof claimSchema>>;
export type Continuation = "VERIFIED" | "RESOLVE" | "END";
export const coupModuleStateSchema = z.strictObject({
  engineVersion: z.literal("coup-v1"),
  stateSchemaVersion: z.literal(4),
  rulesetVersion: z.literal("coup-provisional-complete-v1"),
  phase: z.enum([
    "WAITING_FOR_ACTION",
    "CHALLENGE",
    "BLOCK",
    "PROOF",
    "LOSS",
    "EXCHANGE",
    "GAME_OVER",
  ]),
  rules: coupRulesSchema,
  createdAt: count,
  lastCommandAt: count,
  deadlineAt: count.nullable(),
  revision: count,
  turnNumber: count.positive(),
  turnPlayerId: idSchema,
  winnerId: idSchema.nullable(),
  actionCount: count,
  eliminationOrder: z.array(idSchema).max(5),
  players: z
    .array(
      z.strictObject({
        id: idSchema,
        seat: count.max(5),
        coins: count,
        influence: z.array(roleSchema).max(3),
        revealed: z.array(roleSchema).max(3),
      }),
    )
    .min(2)
    .max(6),
  deck: z.array(roleSchema).max(50),
  pendingAction: z
    .strictObject({
      actorId: idSchema,
      kind: z.enum(["INCOME", "FOREIGN_AID", "COUP", "TAX", "STEAL", "ASSASSINATION", "EXCHANGE"]),
      targetId: idSchema.nullable(),
    })
    .nullable(),
  window: z
    .strictObject({
      id: count.positive(),
      eligibleIds: z.array(idSchema).min(1).max(5),
      passedIds: z.array(idSchema).max(5),
      claim: claimSchema.nullable(),
    })
    .nullable(),
  proof: z.strictObject({ claim: claimSchema, challengerId: idSchema }).nullable(),
  loss: z
    .strictObject({
      playerId: idSchema,
      reason: z.enum(["CHALLENGE", "COUP", "ASSASSINATION"]),
      resume: z.enum(["VERIFIED", "RESOLVE", "END"]),
    })
    .nullable(),
  exchange: z.strictObject({ playerId: idSchema, drawn: z.array(roleSchema).length(2) }).nullable(),
  metrics: z.strictObject({
    challenges: count,
    claimsProved: count,
    claimsConceded: count,
    blocks: count,
    exchanges: count,
    timeouts: count,
  }),
});
type ReadonlyDeep<T> = T extends object ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> } : T;
export type CoupModuleState = ReadonlyDeep<z.infer<typeof coupModuleStateSchema>>;
export class CoupModuleError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "GAME_STATE_CONFLICT" | "INCOMPATIBLE_GAME_VERSION",
  ) {
    super(code);
  }
}
export function conflict(): never {
  throw new CoupModuleError("GAME_STATE_CONFLICT");
}
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function assertCoupVersion(s: CoupModuleState): void {
  if (
    s.engineVersion !== coupDescriptor.engineVersion ||
    s.stateSchemaVersion !== 4 ||
    s.rulesetVersion !== coupDescriptor.rulesetVersion ||
    s.rules.rulesetVersion !== s.rulesetVersion
  )
    throw new CoupModuleError("INCOMPATIBLE_GAME_VERSION");
}
