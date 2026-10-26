import { z } from "zod";
export const adminErrorSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: z.string().regex(/^[A-Z_]+$/),
    message: z.string(),
    retryable: z.boolean(),
  }),
});
export const adminAccessSchema = z.strictObject({
  schemaVersion: z.literal(1),
  isOwner: z.boolean(),
  authorizationVersion: z.number().int().positive(),
  policyRevision: z.number().int().positive(),
  permissions: z.array(z.string()).max(100),
  csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const adminLoginResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  next: z.enum(["PIN_REQUIRED", "SIGNED_IN"]),
  csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const adminRowSchema = z.strictObject({
  id: z.string().min(1).max(128),
  label: z.string().max(256),
  status: z.string().max(64),
  gameId: z.string().max(64).nullable(),
  version: z.number().int().nonnegative().nullable(),
  pins: z
    .strictObject({
      engineVersion: z.string().max(128),
      stateSchemaVersion: z.number().int().nonnegative(),
      rulesetVersion: z.string().max(128),
    })
    .optional(),
});
export const adminPageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  items: z.array(adminRowSchema).max(50),
  nextCursor: z.string().max(128).nullable(),
  asOf: z.iso.datetime(),
});
export const adminOverviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  asOf: z.iso.datetime(),
  metrics: z
    .array(
      z.strictObject({
        key: z.string().max(80),
        value: z
          .string()
          .regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/)
          .nullable(),
        valid: z.boolean(),
        source: z.string().max(64),
      }),
    )
    .max(100),
});
export const adminAuditPageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  asOf: z.iso.datetime(),
  items: z
    .array(
      z.strictObject({ id: z.uuid(), event: z.string().max(64), occurredAt: z.iso.datetime() }),
    )
    .max(50),
});
