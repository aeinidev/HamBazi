import { createErrorEnvelope, type ErrorEnvelope } from "@hambazi/contracts";
import type { AdmissionOutcome, AdmissionTicket, MatchAdmissionPort } from "../../matches/index.js";
import {
  admissionSchema,
  partitionSchema,
  searchSchema,
  ticketSchema,
  type Claim,
  type Credentials,
  type Outcome,
  type Partition,
  type Queue,
  type Session,
  type TicketView,
} from "./contracts.js";
class Fault extends Error {
  constructor(readonly failure: ErrorEnvelope) {
    super(failure.error.code);
  }
}
export function createMatchmaking(options: {
  matches: MatchAdmissionPort;
  queue: Queue;
  credentials: Credentials;
  clock: { nowMs(): number };
  authenticate(token: unknown): Promise<{ ok: true; session: Session } | ErrorEnvelope>;
}) {
  const { matches, queue } = options;
  const rateFailures = { search: 0, read: 0, cancel: 0 };
  const ref = (t: AdmissionTicket) => ({ schemaVersion: 1 as const, ticketId: t.ticketId });
  const group = (id: string) => ({ schemaVersion: 1 as const, reservationId: id });
  function unwrap<T>(outcome: AdmissionOutcome<T>): T {
    if (!outcome.ok) throw new Fault(outcome);
    return outcome.value;
  }
  async function safe<T>(operation: () => Promise<T>): Promise<Outcome<T>> {
    try {
      return { ok: true, value: await operation() };
    } catch (e) {
      return e instanceof Fault ? e.failure : createErrorEnvelope("MATCHMAKING_UNAVAILABLE");
    }
  }
  async function limit(userId: string, kind: "search" | "read" | "cancel") {
    let allowed: boolean;
    try {
      allowed = await queue.consume(userId, kind);
    } catch {
      rateFailures[kind]++;
      if (kind === "search") throw new Fault(createErrorEnvelope("MATCHMAKING_UNAVAILABLE"));
      return; // Durable cancellation/recovery remain available during Redis loss.
    }
    if (!allowed) throw new Fault(createErrorEnvelope("RATE_LIMITED"));
  }
  async function session(token: unknown) {
    const result = await options.authenticate(token);
    if (!result.ok) throw new Fault(result);
    if (result.session.expiresAt * 1000 <= options.clock.nowMs())
      throw new Fault(createErrorEnvelope("UNAUTHENTICATED"));
    return result.session;
  }
  function view(t: AdmissionTicket): TicketView {
    return {
      schemaVersion: 1,
      ticketId: t.ticketId,
      status: t.status,
      expiresAt: t.expiresAt,
      matchId: t.matchId,
    };
  }
  async function refresh(t: AdmissionTicket) {
    return unwrap(await matches.read(t.actorUserId, ref(t)));
  }
  async function sync(t: AdmissionTicket): Promise<AdmissionTicket> {
    if (t.status === "RESERVED" && t.reservationUntil! <= options.clock.nowMs()) {
      unwrap(await matches.release(group(t.reservationId!)));
      t = await refresh(t);
    }
    if (t.status === "SEARCHING") await queue.enqueue(t);
    else if (t.status !== "RESERVED") await queue.remove(t);
    return t;
  }
  // A release, not a negative read, fences a delayed commit. On uncertainty retain
  // the Redis claim for reconciliation; never acknowledge a guessed disposition.
  async function settle(partition: Partition, claim: Claim, commit: boolean) {
    const reservation = group(claim.reservationId);
    const reserved = await matches.reserve({
      ...reservation,
      tickets: claim.tickets.map((t) => ({ ticketId: t.ticketId, generation: t.generation })),
    });
    if (!reserved.ok && reserved.error.code !== "MATCHMAKING_CONFLICT") throw new Fault(reserved);
    let matchId: string | null = null;
    if (reserved.ok && commit && claim.expiresAt > options.clock.nowMs()) {
      const committed = await matches.commit(reservation);
      if (committed.ok) matchId = committed.value.matchId;
      // Even an unavailable commit can have succeeded. Release serializes with it.
    }
    const released = await matches.release(reservation);
    if (released.ok) matchId = released.value.matchId;
    else if (!(
      released.error.code === "NOT_FOUND" &&
      !reserved.ok &&
      reserved.error.code === "MATCHMAKING_CONFLICT"
    ))
      throw new Fault(released);
    // NOT_FOUND is safe only after reserve proved the expected generations cannot
    // succeed. Generations and terminal outcomes never roll back.
    const tickets: AdmissionTicket[] = [];
    for (const ticket of claim.tickets) {
      const current = await matches.read(ticket.actorUserId, ref(ticket));
      if (current.ok) tickets.push(current.value);
      else if (current.error.code !== "UNAUTHENTICATED") throw new Fault(current);
    }
    await queue.finish(partition, claim, tickets);
    return { schemaVersion: 1 as const, matchId };
  }
  return Object.freeze({
    rateFailures: () => ({ ...rateFailures }),
    search: (token: unknown, input: unknown) =>
      safe(async () => {
        const parsed = searchSchema.safeParse(input);
        if (!parsed.success) throw new Fault(createErrorEnvelope("INVALID_INPUT"));
        const actor = await session(token);
        await limit(actor.userId, "search");
        let ticket = unwrap(await matches.register(actor.userId, parsed.data));
        ticket = await sync(ticket);
        await session(token);
        return view(ticket);
      }),
    read: (token: unknown, input: unknown) =>
      safe(async () => {
        const parsed = ticketSchema.safeParse(input);
        if (!parsed.success) throw new Fault(createErrorEnvelope("INVALID_INPUT"));
        const actor = await session(token);
        await limit(actor.userId, "read");
        const ticket = unwrap(await matches.read(actor.userId, parsed.data));
        return view(ticket);
      }),
    cancel: (token: unknown, input: unknown) =>
      safe(async () => {
        const parsed = ticketSchema.safeParse(input);
        if (!parsed.success) throw new Fault(createErrorEnvelope("INVALID_INPUT"));
        const actor = await session(token);
        await limit(actor.userId, "cancel");
        const ticket = unwrap(await matches.cancel(actor.userId, parsed.data));
        // Redis cleanup is advisory. A durable terminal ticket can never match again.
        try {
          await queue.remove(ticket);
        } catch {
          /* Retried by claim reconciliation. */
        }
        return view(ticket);
      }),
    // Bounded, trusted tick: recover one expired claim, then select at most one group.
    run: (input: unknown) =>
      safe(async () => {
        const parsed = partitionSchema.safeParse(input);
        if (!parsed.success) throw new Fault(createErrorEnvelope("INVALID_INPUT"));
        const stale = await queue.expired(parsed.data);
        if (stale) return settle(parsed.data, stale, false);
        const claim = await queue.claim(parsed.data);
        return claim
          ? settle(parsed.data, claim, true)
          : { schemaVersion: 1 as const, matchId: null };
      }),
    found: (token: unknown, input: unknown) =>
      safe(async () => {
        const parsed = ticketSchema.safeParse(input);
        if (!parsed.success) throw new Fault(createErrorEnvelope("INVALID_INPUT"));
        const actor = await session(token);
        await limit(actor.userId, "read");
        const ticket = unwrap(await matches.read(actor.userId, parsed.data));
        const membership = unwrap(await matches.authorize(actor.userId, parsed.data));
        const credential = await options.credentials.issue(actor, ticket);
        await session(token);
        if (credential.expiresAt * 1000 <= options.clock.nowMs())
          throw new Fault(createErrorEnvelope("UNAUTHENTICATED"));
        return {
          schemaVersion: 1 as const,
          ticketId: ticket.ticketId,
          matchId: membership.matchId,
          admissionToken: credential.token,
          expiresAt: credential.expiresAt,
        };
      }),
    admit: (token: unknown, input: unknown) =>
      safe(async () => {
        const parsed = admissionSchema.safeParse(input);
        if (!parsed.success) throw new Fault(createErrorEnvelope("INVALID_INPUT"));
        const actor = await session(token);
        const reference = { schemaVersion: 1 as const, ticketId: parsed.data.ticketId };
        await limit(actor.userId, "read");
        const ticket = unwrap(await matches.read(actor.userId, reference));
        if (!(await options.credentials.verify(parsed.data.admissionToken, actor, ticket)))
          throw new Fault(createErrorEnvelope("UNAUTHENTICATED"));
        const membership = unwrap(await matches.authorize(actor.userId, reference));
        await session(token);
        if (!(await options.credentials.verify(parsed.data.admissionToken, actor, ticket)))
          throw new Fault(createErrorEnvelope("UNAUTHENTICATED"));
        return { schemaVersion: 1 as const, matchId: membership.matchId };
      }),
  });
}
