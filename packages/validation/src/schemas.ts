import { MAX_WIRE_COUNTER, WIRE_SCHEMA_VERSION } from "@hambazi/contracts";
import { ERROR_CODES } from "@hambazi/shared";
import { z } from "zod";

// RFC UUIDs (including nil/max sentinels); no generation or identity authority implied.
export const entityIdSchema = z.uuid();
export const wireSchemaVersionSchema = z.literal(WIRE_SCHEMA_VERSION);
export const stateVersionSchema = z.number().int().min(0).max(MAX_WIRE_COUNTER);
export const lastEventSequenceSchema = stateVersionSchema;
export const eventSequenceSchema = z.number().int().min(1).max(MAX_WIRE_COUNTER);
export const knownErrorCodeSchema = z.enum(ERROR_CODES);

/** Receiver schema: additive fields are stripped, unknown well-formed codes survive. */
export const errorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/),
    message: z.string(),
    retryable: z.boolean(),
  }),
});

// Feature owners must pass an actual payload schema, not unknown/any. Both its
// wire input and parsed output must be JSON data (no Date, BigInt, NaN, etc.).
function jsonPayload<Schema extends z.ZodType>(schema: Schema) {
  return z
    .unknown()
    .refine((value) => z.json().safeParse(value).success)
    .pipe(schema)
    .refine((value) => z.json().safeParse(value).success);
}

export function createGameCommandSchema<Schema extends z.ZodType>(command: Schema) {
  return z.strictObject({
    schemaVersion: wireSchemaVersionSchema,
    actionId: entityIdSchema,
    matchId: entityIdSchema,
    expectedVersion: stateVersionSchema,
    command: jsonPayload(command),
  });
}

/** Client receiver; payload schema should tolerate safe additive server fields. */
export function createMatchEventSchema<Type extends string, Schema extends z.ZodType>(
  type: Type,
  payload: Schema,
) {
  return z.object({
    schemaVersion: wireSchemaVersionSchema,
    eventId: entityIdSchema,
    matchId: entityIdSchema,
    type: z.literal(type),
    seq: eventSequenceSchema,
    stateVersion: stateVersionSchema,
    payload: jsonPayload(payload),
  });
}

export function createMatchSnapshotSchema<Schema extends z.ZodType>(view: Schema) {
  return z.object({
    schemaVersion: wireSchemaVersionSchema,
    matchId: entityIdSchema,
    stateVersion: stateVersionSchema,
    lastEventSeq: lastEventSequenceSchema,
    view: jsonPayload(view),
  });
}

/** Each endpoint owns its maximum; no product pagination default is selected here. */
export function createPageRequestSchema(maxLimit: number) {
  if (!Number.isSafeInteger(maxLimit) || maxLimit < 1) {
    throw new Error("Pagination maximum must be a positive safe integer");
  }
  return z.strictObject({
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(maxLimit),
  });
}

export function createPageSchema<Schema extends z.ZodType>(item: Schema) {
  return z.object({
    items: z.array(jsonPayload(item)),
    nextCursor: z.string().min(1).nullable(),
  });
}
