import { z } from "zod";
import { gameVersionDescriptorSchema } from "@hambazi/game-core";
import { coupRuleConfigSchema, type CoupState } from "./model.js";

export const coupClaimsDescriptor = Object.freeze(
  gameVersionDescriptorSchema.parse({
    engineVersion: "coup-claims-v1",
    stateSchemaVersion: 3,
    rulesetVersion: "coup-provisional-claims-v1",
    commandSchemaVersion: 2,
    eventSchemaVersion: 2,
  }),
);
export const coupClaimsRulesSchema = coupRuleConfigSchema.safeExtend({
  rulesetVersion: z.literal("coup-provisional-claims-v1"),
  taxCoins: z.number().int().min(1).max(5),
  stealCoins: z.number().int().min(1).max(5),
  assassinationCost: z.number().int().min(1).max(20),
});
export type CoupClaimsRules = Readonly<z.infer<typeof coupClaimsRulesSchema>>;
const role = z.enum(["DUKE", "ASSASSIN", "CAPTAIN", "AMBASSADOR", "CONTESSA"]);
const id = z.uuid().transform((value) => value.toLowerCase());
const windowId = z.number().int().positive();
export const coupClaimsCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("DECLARE_INCOME") }),
  z.strictObject({ type: z.literal("DECLARE_FOREIGN_AID") }),
  z.strictObject({ type: z.literal("DECLARE_TAX") }),
  z.strictObject({ type: z.literal("DECLARE_COUP"), targetId: id }),
  z.strictObject({ type: z.literal("DECLARE_STEAL"), targetId: id }),
  z.strictObject({ type: z.literal("DECLARE_ASSASSINATION"), targetId: id }),
  z.strictObject({ type: z.literal("PASS_CHALLENGE"), windowId }),
  z.strictObject({ type: z.literal("PASS_BLOCK"), windowId }),
  z.strictObject({ type: z.literal("CHALLENGE"), windowId }),
  z.strictObject({ type: z.literal("BLOCK"), windowId, role }),
  z.strictObject({
    type: z.literal("PROVE_CLAIM"),
    windowId,
    cardIndex: z.number().int().nonnegative(),
  }),
  z.strictObject({ type: z.literal("CONCEDE_CLAIM"), windowId }),
  z.strictObject({
    type: z.literal("SELECT_CARD_TO_LOSE"),
    windowId,
    cardIndex: z.number().int().nonnegative(),
  }),
]);
export type CoupClaimsCommand = z.infer<typeof coupClaimsCommandSchema>;
export const coupClaimsEventSchema = z.strictObject({
  type: z.literal("COMMAND_RESOLVED"),
  schemaVersion: z.literal(2),
  expectedRevision: z.number().int().nonnegative(),
  actorId: id,
  command: coupClaimsCommandSchema,
  replacement: z.strictObject({ card: role, deck: z.array(role) }).optional(),
});
export type CoupClaimsEvent = z.infer<typeof coupClaimsEventSchema>;
export type Claim = Readonly<{
  kind: "ACTION" | "BLOCK";
  claimantId: string;
  role: z.infer<typeof role>;
}>;
export type Continuation = "VERIFIED" | "RESOLVE" | "END";
export interface CoupClaimsState extends Omit<
  CoupState,
  "stateSchemaVersion" | "phase" | "rules" | "pendingAction"
> {
  readonly stateSchemaVersion: 3;
  readonly revision: number;
  readonly rules: CoupClaimsRules;
  readonly phase: "WAITING_FOR_ACTION" | "CHALLENGE" | "BLOCK" | "PROOF" | "LOSS" | "GAME_OVER";
  readonly pendingAction: Readonly<{
    actorId: string;
    kind: "INCOME" | "FOREIGN_AID" | "COUP" | "TAX" | "STEAL" | "ASSASSINATION";
    targetId: string | null;
  }> | null;
  readonly window: Readonly<{
    id: number;
    eligibleIds: readonly string[];
    passedIds: readonly string[];
    claim: Claim | null;
  }> | null;
  readonly proof: Readonly<{ claim: Claim; challengerId: string }> | null;
  readonly loss: Readonly<{
    playerId: string;
    reason: "CHALLENGE" | "COUP" | "ASSASSINATION";
    resume: Continuation;
  }> | null;
}
