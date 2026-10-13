import { matchFinishedV2Schema } from "@hambazi/validation";
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
    z.strictObject({
      ...metadata,
      schemaVersion: z.literal(2),
      type: z.literal("MATCH_FINISHED_V2"),
      payload: matchFinishedV2Schema,
    }),
  ])
  .refine((event) => event.aggregateId === event.payload.matchId);
export type MatchDomainEvent = z.infer<typeof matchDomainEventSchema>;
export interface OutboxEvent {
  schemaVersion: 1 | 2;
  eventId: string;
  aggregateId: string;
  occurredAt: number;
  type: string;
  payload: Readonly<{ matchId: string }>;
  correlation: Readonly<{ requestId?: string | undefined; traceparent?: string | undefined }>;
}
export interface OutboxClaim<T extends OutboxEvent = MatchDomainEvent> {
  eventId: string;
  attempt: number;
  event: T | null;
}
export interface MatchOutboxPort<T extends OutboxEvent = MatchDomainEvent> {
  claim(limit: number): Promise<readonly OutboxClaim<T>[]>;
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
