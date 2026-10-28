import { z } from "zod";
const id = z.uuid();
export const adminUserQuerySchema = z.strictObject({
  cursor: id.optional(),
  limit: z
    .string()
    .regex(/^[1-9][0-9]?$/)
    .transform(Number)
    .pipe(z.number().max(50))
    .optional(),
  search: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((value) => !value.includes(String.fromCharCode(0)))
    .optional(),
  status: z.enum(["ACTIVE", "BANNED"]).optional(),
});
export const adminUserProfileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  displayName: z.string(),
  publicHandle: z.string(),
  status: z.string(),
  profileVersion: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  registrationCompletedAt: z.iso.datetime().nullable(),
});
export const adminUserRestrictionsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  active: z.strictObject({ id, expiresAt: z.iso.datetime().nullable() }).nullable(),
  items: z
    .array(
      z.strictObject({
        id,
        reasonCode: z.string(),
        duration: z.string(),
        createdAt: z.iso.datetime(),
        expiresAt: z.iso.datetime().nullable(),
        endedAt: z.iso.datetime().nullable(),
        endKind: z.enum(["EXPIRED", "REVOKED"]).nullable(),
        endedByOperationId: id.nullable(),
      }),
    )
    .max(50),
  nextCursor: id.nullable(),
});
export const adminUserHistorySchema = z.strictObject({
  schemaVersion: z.literal(1),
  items: z
    .array(
      z.strictObject({
        id,
        gameId: z.string(),
        status: z.string(),
        startedAt: z.iso.datetime().nullable(),
        finishedAt: z.iso.datetime().nullable(),
        placement: z.number().int().nullable(),
        winner: z.boolean().nullable(),
      }),
    )
    .max(50),
  nextCursor: id.nullable(),
});
export const adminPrivateNoteSchema = z.strictObject({
  schemaVersion: z.literal(1),
  privateNote: z.string().max(2000).nullable(),
});
