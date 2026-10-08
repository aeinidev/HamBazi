import { z } from "zod";
import { matchLifecycleSchema } from "./processing.js";
export const personalStartSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: z.uuid(),
});
export const personalReadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  matchId: z.uuid(),
});
export const personalCloseSchema = matchLifecycleSchema.omit({ operation: true });
export const personalCurrentSchema = z.strictObject({ schemaVersion: z.literal(1) });
export const personalCurrentResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  matchId: z.uuid().nullable(),
});
