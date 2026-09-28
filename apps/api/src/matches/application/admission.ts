import { z } from "zod";
import { createErrorEnvelope, type ErrorEnvelope } from "@hambazi/contracts";
import type { UserIdentityPort } from "../../users/index.js";
import type { CatalogPort } from "../../games/index.js";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const name = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const ticketIntentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: uuid,
  gameId: name,
  mode: name,
  capacity: z.number().int().min(2).max(64),
});
export const ticketReferenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ticketId: uuid,
});
export const reservationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    reservationId: uuid,
    tickets: z
      .array(
        z.strictObject({ ticketId: uuid, generation: z.number().int().min(0).max(2147483645) }),
      )
      .min(2)
      .max(64),
  })
  .refine((value) => new Set(value.tickets.map((t) => t.ticketId)).size === value.tickets.length);
export const reservationReferenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  reservationId: uuid,
});
export const commitReservationSchema = reservationReferenceSchema.extend({
  requestId: z.uuid().optional(),
  traceparent: z
    .string()
    .regex(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/)
    .refine((v) => !v.startsWith("00-" + "0".repeat(32)) && v.slice(36, 52) !== "0".repeat(16))
    .optional(),
});
export const matchmakingFoundIntentSchema = z.object({
  schemaVersion: z.literal(1),
  matchId: uuid,
  reservationId: uuid,
});
export const executableDescriptorSchema = z.strictObject({
  engineVersion: z.string().min(1).max(64),
  stateSchemaVersion: z.number().int().min(1).max(2147483647),
  rulesetVersion: z.string().min(1).max(64),
});
export type TicketIntent = z.infer<typeof ticketIntentSchema>;
export type ReservationIntent = z.infer<typeof reservationSchema>;
export type ExecutableDescriptor = z.infer<typeof executableDescriptorSchema>;
export interface AdmissionTicket {
  schemaVersion: 1;
  ticketId: string;
  actorUserId: string;
  commandId: string;
  gameId: string;
  mode: string;
  capacity: number;
  status: "SEARCHING" | "RESERVED" | "MATCHED" | "CANCELLED" | "EXPIRED";
  generation: number;
  expiresAt: number;
  reservationId: string | null;
  reservationUntil: number | null;
  matchId: string | null;
}
export type AdmissionCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "GAME_UNAVAILABLE"
  | "MATCHMAKING_CONFLICT"
  | "MATCHMAKING_UNAVAILABLE";
export class AdmissionFault extends Error {
  constructor(readonly code: AdmissionCode) {
    super(code);
  }
}
export interface AdmissionRepository {
  receipt(actor: string, input: TicketIntent): Promise<AdmissionTicket | null>;
  register(actor: string, input: TicketIntent): Promise<AdmissionTicket>;
  read(actor: string, ticketId: string): Promise<AdmissionTicket>;
  cancel(actor: string, ticketId: string): Promise<AdmissionTicket>;
  authorize(actor: string, ticketId: string): Promise<{ matchId: string }>;
  reserve(input: ReservationIntent): Promise<AdmissionTicket[]>;
  release(reservationId: string): Promise<{ matchId: string | null }>;
  inspect(reservationId: string): Promise<{ matchId: string | null; tickets: AdmissionTicket[] }>;
  commit(
    reservationId: string,
    descriptor: ExecutableDescriptor,
    correlation?: { requestId?: string; traceparent?: string },
  ): Promise<{ matchId: string }>;
}
export type AdmissionOutcome<T> = { ok: true; value: T } | ErrorEnvelope<AdmissionCode>;
export function admissionService(deps: {
  repository: AdmissionRepository;
  users: UserIdentityPort;
  games: Pick<CatalogPort, "find">;
  // Trusted server registry; never a descriptor supplied by the client.
  descriptor(input: {
    gameId: string;
    mode: string;
    capacity: number;
  }): Promise<ExecutableDescriptor | null>;
}) {
  async function safe<T>(operation: () => Promise<T>): Promise<AdmissionOutcome<T>> {
    try {
      return { ok: true, value: await operation() };
    } catch (error) {
      return createErrorEnvelope(
        error instanceof AdmissionFault ? error.code : "MATCHMAKING_UNAVAILABLE",
      );
    }
  }
  function parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new AdmissionFault("INVALID_INPUT");
    return result.data;
  }
  async function actor(input: unknown) {
    const id = uuid.safeParse(input);
    if (!id.success || !(await deps.users.findActiveById(id.data)))
      throw new AdmissionFault("UNAUTHENTICATED");
    return id.data;
  }
  async function eligible(input: { gameId: string; mode: string; capacity: number }) {
    const game = await deps.games.find(input.gameId);
    if (!game.ok)
      throw new AdmissionFault(
        game.error.code === "INTERNAL_ERROR" ? "MATCHMAKING_UNAVAILABLE" : "GAME_UNAVAILABLE",
      );
    if (
      game.game.id !== input.gameId ||
      game.game.status !== "ACTIVE" ||
      !game.game.playable ||
      !game.game.matchmakingEnabled ||
      input.capacity < game.game.minPlayers ||
      input.capacity > game.game.maxPlayers
    )
      throw new AdmissionFault("GAME_UNAVAILABLE");
    const descriptor = await deps.descriptor({
      gameId: input.gameId,
      mode: input.mode,
      capacity: input.capacity,
    });
    if (descriptor === null) throw new AdmissionFault("GAME_UNAVAILABLE");
    const parsed = executableDescriptorSchema.safeParse(descriptor);
    if (!parsed.success) throw new AdmissionFault("MATCHMAKING_UNAVAILABLE");
    return parsed.data;
  }
  return {
    register: (identity: unknown, input: unknown) =>
      safe(async () => {
        const user = await actor(identity);
        const intent = parse(ticketIntentSchema, input);
        const previous = await deps.repository.receipt(user, intent);
        if (previous) return previous;
        await eligible(intent);
        return deps.repository.register(user, intent);
      }),
    read: (identity: unknown, input: unknown) =>
      safe(async () => {
        const user = await actor(identity);
        return deps.repository.read(user, parse(ticketReferenceSchema, input).ticketId);
      }),
    cancel: (identity: unknown, input: unknown) =>
      safe(async () => {
        const user = await actor(identity);
        return deps.repository.cancel(user, parse(ticketReferenceSchema, input).ticketId);
      }),
    authorize: (identity: unknown, input: unknown) =>
      safe(async () => {
        const user = await actor(identity);
        return deps.repository.authorize(user, parse(ticketReferenceSchema, input).ticketId);
      }),
    // Trusted orchestration ports only. They are never directly exposed to clients.
    reserve: (input: unknown) =>
      safe(() => deps.repository.reserve(parse(reservationSchema, input))),
    release: (input: unknown) =>
      safe(() => deps.repository.release(parse(reservationReferenceSchema, input).reservationId)),
    inspect: (input: unknown) =>
      safe(() => deps.repository.inspect(parse(reservationReferenceSchema, input).reservationId)),
    commit: (input: unknown) =>
      safe(async () => {
        const command = parse(commitReservationSchema, input);
        const id = command.reservationId;
        const existing = await deps.repository.inspect(id);
        if (existing.matchId) return { matchId: existing.matchId };
        const first = existing.tickets[0];
        if (!first) throw new AdmissionFault("MATCHMAKING_CONFLICT");
        for (const ticket of existing.tickets) await actor(ticket.actorUserId);
        const descriptor = await eligible(first);
        return deps.repository.commit(id, descriptor, {
          ...(command.requestId === undefined ? {} : { requestId: command.requestId }),
          ...(command.traceparent === undefined ? {} : { traceparent: command.traceparent }),
        });
      }),
  };
}
export type MatchAdmissionPort = ReturnType<typeof admissionService>;
