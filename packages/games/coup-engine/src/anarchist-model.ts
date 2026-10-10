import { z } from "zod";
import {
  coupModuleStateSchema,
  coupModuleCommandSchema,
  coupModuleEventSchema,
  coupRulesSchema,
  idSchema,
} from "./module-model.js";

/** Separate pins keep all existing v1 matches and replay semantics intact. */
export const coupAnarchistDescriptor = Object.freeze({
  engineVersion: "coup-anarchist-v1",
  stateSchemaVersion: 5,
  rulesetVersion: "coup-anarchist-v1",
  commandSchemaVersion: 4,
  eventSchemaVersion: 4,
});
export const coupAnarchistRulesSchema = z
  .strictObject({
    ...coupRulesSchema.shape,
    rulesetVersion: z.literal("coup-anarchist-v1"),
    anarchistCost: z.literal(5),
  })
  .refine((r) => r.mandatoryCoupAt >= r.coupCost);
export const coupAnarchistCommandSchema = z.discriminatedUnion("type", [
  ...coupModuleCommandSchema.options,
  z.strictObject({ type: z.literal("DECLARE_ANARCHIST"), targetId: idSchema }),
]);
const kind = z.enum([
  "INCOME",
  "FOREIGN_AID",
  "COUP",
  "TAX",
  "STEAL",
  "ASSASSINATION",
  "EXCHANGE",
  "ANARCHIST",
]);
export const coupPublicActionSchema = z.strictObject({
  revision: z.number().int().positive(),
  occurredAt: z.number().int().nonnegative(),
  actorId: idSchema,
  targetId: idSchema.nullable(),
  kind,
  outcome: z.enum(["DECLARED", "RESOLVED", "DEFENDED"]),
});
export const coupAnarchistStateSchema = z.strictObject({
  ...coupModuleStateSchema.shape,
  engineVersion: z.literal("coup-anarchist-v1"),
  stateSchemaVersion: z.literal(5),
  rulesetVersion: z.literal("coup-anarchist-v1"),
  rules: coupAnarchistRulesSchema,
  pendingAction: z
    .strictObject({ actorId: idSchema, kind, targetId: idSchema.nullable() })
    .nullable(),
  loss: z
    .strictObject({
      playerId: idSchema,
      reason: z.enum(["CHALLENGE", "COUP", "ASSASSINATION", "ANARCHIST"]),
      resume: z.enum(["VERIFIED", "RESOLVE", "END"]),
    })
    .nullable(),
  lastAction: coupPublicActionSchema.nullable(),
  lastDefense: z
    .strictObject({
      revision: z.number().int().positive(),
      occurredAt: z.number().int().nonnegative(),
      targetId: idSchema,
    })
    .nullable(),
});
export const coupAnarchistEventSchema = z.strictObject({
  ...coupModuleEventSchema.shape,
  schemaVersion: z.literal(4),
  command: coupAnarchistCommandSchema,
});
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type CoupAnarchistState = DeepReadonly<z.infer<typeof coupAnarchistStateSchema>>;
export type CoupAnarchistRules = Readonly<z.infer<typeof coupAnarchistRulesSchema>>;
export type CoupAnarchistCommand = z.infer<typeof coupAnarchistCommandSchema>;
export type CoupAnarchistEvent = z.infer<typeof coupAnarchistEventSchema>;
