import { z } from "zod";
import type { ErrorEnvelope } from "@hambazi/contracts";
import type { AdmissionTicket } from "../../matches/index.js";
const uuid = z.uuid().transform((v) => v.toLowerCase());
const name = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const partitionSchema = z.strictObject({
  gameId: name,
  mode: name,
  capacity: z.number().int().min(2).max(64),
});
export const searchSchema = partitionSchema.extend({
  schemaVersion: z.literal(1),
  commandId: uuid,
});
export const ticketSchema = z.strictObject({ schemaVersion: z.literal(1), ticketId: uuid });
export const admissionSchema = ticketSchema.extend({ admissionToken: z.string().min(1).max(4096) });
export const ticketViewSchema = z.object({
  schemaVersion: z.literal(1),
  ticketId: uuid,
  status: z.enum(["SEARCHING", "RESERVED", "MATCHED", "CANCELLED", "EXPIRED"]),
  expiresAt: z.number().int().nonnegative(),
  matchId: uuid.nullable(),
});
export const foundSchema = z.object({
  schemaVersion: z.literal(1),
  ticketId: uuid,
  matchId: uuid,
  admissionToken: z.string().min(1).max(4096),
  expiresAt: z.number().int().nonnegative(),
});
export type Partition = z.infer<typeof partitionSchema>;
export type TicketView = z.infer<typeof ticketViewSchema>;
export type Session = { schemaVersion: 1; userId: string; sessionId: string; expiresAt: number };
export type Outcome<T> = { ok: true; value: T } | ErrorEnvelope;
export type Claim = { reservationId: string; tickets: AdmissionTicket[]; expiresAt: number };
export interface Queue {
  enqueue(ticket: AdmissionTicket): Promise<void>;
  remove(ticket: AdmissionTicket): Promise<void>;
  claim(partition: Partition): Promise<Claim | null>;
  expired(partition: Partition): Promise<Claim | null>;
  finish(partition: Partition, claim: Claim, tickets: AdmissionTicket[]): Promise<void>;
  consume(userId: string, kind: "search" | "read" | "cancel"): Promise<boolean>;
}
export interface Credentials {
  issue(
    session: Session,
    ticket: AdmissionTicket,
  ): Promise<{ token: { reveal(): string }; expiresAt: number }>;
  verify(token: string, session: Session, ticket: AdmissionTicket): Promise<boolean>;
}
