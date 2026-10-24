import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createErrorEnvelope } from "@hambazi/contracts";
import {
  createMatchmaking,
  type Session,
  type Queue,
  type Credentials,
  type Claim,
} from "../../src/matchmaking/index.js";
import type { MatchAdmissionPort, AdmissionTicket } from "../../src/matches/index.js";
function fixture() {
  const session: Session = {
    schemaVersion: 1,
    userId: randomUUID(),
    sessionId: randomUUID(),
    expiresAt: 2000,
  };
  const ticket: AdmissionTicket = {
    schemaVersion: 1,
    ticketId: randomUUID(),
    commandId: randomUUID(),
    actorUserId: session.userId,
    gameId: "coup",
    mode: "fixture",
    capacity: 2,
    status: "SEARCHING",
    generation: 0,
    expiresAt: 1900000,
    reservationId: null,
    reservationUntil: null,
    matchId: null,
  };
  const claim: Claim = {
    reservationId: randomUUID(),
    expiresAt: 1100000,
    tickets: [ticket, { ...ticket, ticketId: randomUUID(), actorUserId: randomUUID() }],
  };
  const matchId = randomUUID();
  const matches: MatchAdmissionPort = {
    register: vi.fn(async () => ({ ok: true as const, value: ticket })),
    read: vi.fn(async () => ({ ok: true as const, value: ticket })),
    cancel: vi.fn(async () => ({
      ok: true as const,
      value: { ...ticket, status: "CANCELLED" as const },
    })),
    reserve: vi.fn(async () => ({ ok: true as const, value: claim.tickets })),
    release: vi.fn(async () => ({ ok: true as const, value: { matchId: null } })),
    commit: vi.fn(async () => ({ ok: true as const, value: { matchId } })),
    inspect: vi.fn(async () => ({
      ok: true as const,
      value: { matchId: null, tickets: claim.tickets },
    })),
    authorize: vi.fn(async () => ({ ok: true as const, value: { matchId } })),
  };
  const queue: Queue = {
    enqueue: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    claim: vi.fn(async () => claim),
    expired: vi.fn(async () => null),
    finish: vi.fn(async () => {}),
    consume: vi.fn(async () => true),
  };
  const credentials: Credentials = {
    issue: vi.fn(async () => ({ token: { reveal: () => "synthetic" }, expiresAt: 1030 })),
    verify: vi.fn(async () => true),
  };
  const authenticate = vi.fn(async () => ({ ok: true as const, session }));
  const clock = { nowMs: () => 1000000 };
  const service = createMatchmaking({ matches, queue, credentials, clock, authenticate });
  const input = {
    schemaVersion: 1,
    commandId: ticket.commandId,
    gameId: ticket.gameId,
    mode: ticket.mode,
    capacity: ticket.capacity,
  };
  const partition = { gameId: ticket.gameId, mode: ticket.mode, capacity: ticket.capacity };
  const ref = { schemaVersion: 1, ticketId: ticket.ticketId };
  return {
    session,
    ticket,
    claim,
    matches,
    queue,
    credentials,
    authenticate,
    service,
    input,
    partition,
    ref,
    matchId,
  };
}
it.each(["search", "read", "cancel", "found", "admit"] as const)(
  "rejects identity injection in %s before authentication or mutation",
  async (method) => {
    const f = fixture();
    expect(
      await f.service[method]("token", { ...f.input, userId: f.session.userId }),
    ).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(f.authenticate).not.toHaveBeenCalled();
    expect(f.matches.register).not.toHaveBeenCalled();
  },
);
it("fails searches closed on quota outages but preserves durable cancellation and records degradation", async () => {
  const f = fixture();
  vi.mocked(f.queue.consume).mockRejectedValue(new Error("synthetic secret"));
  expect(await f.service.search("token", f.input)).toMatchObject({
    error: { code: "MATCHMAKING_UNAVAILABLE" },
  });
  expect(f.matches.register).not.toHaveBeenCalled();
  vi.mocked(f.queue.remove).mockRejectedValue(new Error("synthetic secret"));
  expect(await f.service.cancel("token", f.ref)).toMatchObject({ value: { status: "CANCELLED" } });
  expect(await f.service.read("token", f.ref)).toMatchObject({ value: { status: "SEARCHING" } });
  expect(f.service.rateFailures()).toEqual({ search: 1, read: 1, cancel: 1 });
});
it.each(["search", "read", "cancel"] as const)(
  "returns exhausted %s quota without touching durable state",
  async (method) => {
    const f = fixture();
    vi.mocked(f.queue.consume).mockResolvedValue(false);
    expect(await f.service[method]("token", method === "search" ? f.input : f.ref)).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    expect(f.matches[method === "search" ? "register" : method]).not.toHaveBeenCalled();
  },
);
it("does not return a guessed result or clean up Redis when durable release is unavailable", async () => {
  const f = fixture();
  vi.mocked(f.matches.commit).mockResolvedValue(createErrorEnvelope("MATCHMAKING_UNAVAILABLE"));
  vi.mocked(f.matches.release).mockResolvedValue(createErrorEnvelope("MATCHMAKING_UNAVAILABLE"));
  expect(await f.service.run(f.partition)).toMatchObject({
    error: { code: "MATCHMAKING_UNAVAILABLE" },
  });
  expect(f.queue.finish).not.toHaveBeenCalled();
});
it("reconciles uncertain committed responses through release before reporting match-found", async () => {
  const f = fixture();
  vi.mocked(f.matches.commit).mockResolvedValue(createErrorEnvelope("MATCHMAKING_UNAVAILABLE"));
  vi.mocked(f.matches.release).mockResolvedValue({ ok: true, value: { matchId: f.matchId } });
  expect(await f.service.run(f.partition)).toMatchObject({ value: { matchId: f.matchId } });
  expect(f.queue.finish).toHaveBeenCalledOnce();
});
it("does not commit an expired Redis claim and aborts it durably", async () => {
  const f = fixture();
  f.claim.expiresAt = 1000000;
  expect(await f.service.run(f.partition)).toMatchObject({ value: { matchId: null } });
  expect(f.matches.commit).not.toHaveBeenCalled();
  expect(f.matches.release).toHaveBeenCalledOnce();
});
it("recovers expired durable reservations on client retry after Redis loss", async () => {
  const f = fixture();
  f.ticket.status = "RESERVED";
  f.ticket.reservationId = randomUUID();
  f.ticket.reservationUntil = 999999;
  vi.mocked(f.matches.read).mockResolvedValue({
    ok: true,
    value: {
      ...f.ticket,
      status: "SEARCHING",
      generation: 2,
      reservationId: null,
      reservationUntil: null,
    },
  });
  expect(await f.service.search("token", f.input)).toMatchObject({
    value: { status: "SEARCHING" },
  });
  expect(f.matches.release).toHaveBeenCalledWith({
    schemaVersion: 1,
    reservationId: f.ticket.reservationId,
  });
  expect(f.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ generation: 2 }));
});
it("requires fresh membership before issuance and admission, and never issues for failed membership", async () => {
  const f = fixture();
  vi.mocked(f.matches.authorize).mockResolvedValue(createErrorEnvelope("NOT_FOUND"));
  expect(await f.service.found("token", f.ref)).toMatchObject({ error: { code: "NOT_FOUND" } });
  expect(f.credentials.issue).not.toHaveBeenCalled();
  expect(await f.service.admit("token", { ...f.ref, admissionToken: "synthetic" })).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
});
it("does not clean up a reservation on an unknown reserve failure", async () => {
  const f = fixture();
  vi.mocked(f.matches.reserve).mockResolvedValue(createErrorEnvelope("MATCHMAKING_UNAVAILABLE"));
  expect(await f.service.run(f.partition)).toMatchObject({
    error: { code: "MATCHMAKING_UNAVAILABLE" },
  });
  expect(f.matches.release).not.toHaveBeenCalled();
  expect(f.queue.finish).not.toHaveBeenCalled();
});
it("rejects expired sessions and hides internal dependency errors", async () => {
  const f = fixture();
  f.session.expiresAt = 1000;
  expect(await f.service.search("token", f.input)).toMatchObject({
    error: { code: "UNAUTHENTICATED" },
  });
  f.authenticate.mockRejectedValue(new Error("synthetic secret"));
  const result = await f.service.read("token", f.ref);
  expect(result).toMatchObject({ error: { code: "MATCHMAKING_UNAVAILABLE" } });
  expect(JSON.stringify(result)).not.toContain("synthetic secret");
});

it("re-enqueues a durable searching ticket on status after Redis loses queue state", async () => {
  const f = fixture();
  expect(await f.service.read("token", f.ref)).toMatchObject({ value: { status: "SEARCHING" } });
  expect(f.queue.enqueue).toHaveBeenCalledWith(f.ticket);
  vi.mocked(f.queue.enqueue).mockRejectedValue(new Error("Redis unavailable"));
  expect(await f.service.read("token", f.ref)).toMatchObject({ value: { status: "SEARCHING" } });
});
