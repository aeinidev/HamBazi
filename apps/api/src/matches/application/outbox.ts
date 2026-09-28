import { z } from "zod";
import { matchmakingFoundIntentSchema } from "./admission.js";
import { matchChangedIntentSchema } from "./processing.js";
import { matchCorrelationSchema } from "./correlation.js";
import { matchFinishedInputSchema } from "./result-input.js";
const uuid = z.uuid();
const metadata = {
  schemaVersion: z.literal(1),
  eventId: uuid,
  aggregateId: uuid,
  occurredAt: z.number().int().nonnegative(),
  correlation: matchCorrelationSchema,
};
export const matchDomainEventSchema = z
  .discriminatedUnion("type", [
    z.strictObject({
      ...metadata,
      type: z.literal("matchmaking.found"),
      payload: matchmakingFoundIntentSchema,
    }),
    z.strictObject({
      ...metadata,
      type: z.literal("MATCH_CHANGED_V1"),
      payload: matchChangedIntentSchema,
    }),
    z.strictObject({
      ...metadata,
      type: z.literal("MATCH_FINISHED_V1"),
      payload: matchFinishedInputSchema,
    }),
  ])
  .refine((event) => event.aggregateId === event.payload.matchId);
export type MatchDomainEvent = z.infer<typeof matchDomainEventSchema>;
export interface OutboxClaim {
  eventId: string;
  attempt: number;
  event: MatchDomainEvent | null;
}
export interface MatchOutboxPort {
  claim(limit: number): Promise<readonly OutboxClaim[]>;
  published(eventId: string, attempt: number): Promise<boolean>;
  failed(eventId: string, attempt: number, permanent?: boolean): Promise<boolean>;
  /** Trusted recovery only: one more attempt; retains event identity and fencing counter. */
  redrive(eventId: string): Promise<boolean>;
}
export const outboxPolicySchema = z
  .strictObject({
    leaseMs: z.number().int().min(1000).max(300000),
    maxAttempts: z.number().int().min(1).max(20),
    backoffMs: z.number().int().min(100).max(60000),
    maxBackoffMs: z.number().int().min(100).max(3600000),
  })
  .refine((v) => v.maxBackoffMs >= v.backoffMs);
export type OutboxPolicy = z.infer<typeof outboxPolicySchema>;
