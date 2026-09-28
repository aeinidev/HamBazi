import { z } from "zod";
const uuid = z.uuid();
export const matchCorrelationSchema = z.strictObject({
  requestId: uuid.optional(),
  traceparent: z
    .string()
    .regex(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/)
    .refine((v) => v.slice(3, 35) !== "0".repeat(32) && v.slice(36, 52) !== "0".repeat(16))
    .optional(),
});
export type MatchCorrelation = z.infer<typeof matchCorrelationSchema>;
