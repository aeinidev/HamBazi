import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  admissionService,
  commitReservationSchema,
  matchmakingFoundIntentSchema,
  ticketIntentSchema,
  reservationSchema,
  type AdmissionRepository,
  type AdmissionTicket,
} from "../../src/matches/application/admission.js";
import type { CatalogPort } from "../../src/games/index.js";
const actor = randomUUID();
const intent = {
  schemaVersion: 1,
  commandId: randomUUID(),
  gameId: "coup",
  mode: "classic",
  capacity: 2,
};
const descriptor = {
  engineVersion: "fixture-v1",
  stateSchemaVersion: 1,
  rulesetVersion: "fixture-v1",
};
function fixture() {
  const ticket: AdmissionTicket = {
    schemaVersion: 1,
    ticketId: randomUUID(),
    actorUserId: actor,
    commandId: intent.commandId,
    gameId: "coup",
    mode: "classic",
    capacity: 2,
    status: "SEARCHING",
    generation: 0,
    expiresAt: 900000,
    reservationId: null,
    reservationUntil: null,
    matchId: null,
  };
  const repository: AdmissionRepository = {
    authorize: vi.fn(async () => ({ matchId: randomUUID() })),
    receipt: vi.fn(async () => null),
    register: vi.fn(async () => ticket),
    read: vi.fn(async () => ticket),
    cancel: vi.fn(async () => ticket),
    reserve: vi.fn(async () => [ticket]),
    release: vi.fn(async () => ({ matchId: null })),
    inspect: vi.fn(async () => ({ matchId: null, tickets: [ticket] })),
    commit: vi.fn(async () => ({ matchId: randomUUID() })),
  };
  const users = {
    findActiveById: vi.fn(async (id: string) => ({ userId: id })),
    findActiveByTelegramId: vi.fn(),
  };
  const games: Pick<CatalogPort, "find"> = {
    find: vi.fn<CatalogPort["find"]>(async () => ({
      ok: true,
      game: {
        id: "coup",
        slug: "coup",
        title: "Coup",
        minPlayers: 2,
        maxPlayers: 6,
        status: "ACTIVE",
        playable: true,
        readiness: "NOT_IMPLEMENTED",
        descriptor: null,
        matchmakingEnabled: true,
        privateRoomsEnabled: false,
        chatEnabled: false,
        voiceEnabled: false,
      },
    })),
  };
  const resolve = vi.fn(async () => descriptor as typeof descriptor | null);
  return {
    repository,
    users,
    games,
    resolve,
    ticket,
    service: admissionService({ repository, users, games, descriptor: resolve }),
  };
}
it.each([
  { ...intent, userId: actor },
  { ...intent, capacity: 1 },
  { ...intent, capacity: 65 },
  { ...intent, mode: "../queue" },
  { ...intent, schemaVersion: 2 },
  { ...intent, commandId: "bad" },
  { ...intent, engineVersion: "client-selected" },
  { ...intent, expiresAt: 9999 },
])("rejects malformed/injected ticket intent %#", (input) => {
  expect(ticketIntentSchema.safeParse(input).success).toBe(false);
});
it("rejects duplicate tickets and negative/overflow generations in reservations", () => {
  const ref = { ticketId: randomUUID(), generation: 0 };
  const input = { schemaVersion: 1, reservationId: randomUUID(), tickets: [ref, ref] };
  expect(reservationSchema.safeParse(input).success).toBe(false);
  for (const generation of [-1, 2147483646])
    expect(
      reservationSchema.safeParse({
        ...input,
        tickets: [ref, { ticketId: randomUUID(), generation }],
      }).success,
    ).toBe(false);
});
it("binds identity from the trusted caller and normalizes UUIDs", async () => {
  const f = fixture();
  expect((await f.service.register(actor.toUpperCase(), intent)).ok).toBe(true);
  expect(f.repository.register).toHaveBeenCalledWith(actor, intent);
});
it("checks current user eligibility before touching persistence", async () => {
  const f = fixture();
  f.users.findActiveById.mockResolvedValue(undefined!);
  expect(await f.service.register(actor, intent)).toMatchObject({
    error: { code: "UNAUTHENTICATED" },
  });
  expect(f.repository.register).not.toHaveBeenCalled();
});
it("fails closed on disabled production readiness before consulting executable versions", async () => {
  const f = fixture();
  const result = await f.games.find("coup");
  if (!result.ok) throw new Error();
  vi.mocked(f.games.find).mockResolvedValue({
    ok: true,
    game: { ...result.game, playable: false, matchmakingEnabled: false },
  });
  expect(await f.service.register(actor, intent)).toMatchObject({
    error: { code: "GAME_UNAVAILABLE" },
  });
  expect(f.resolve).not.toHaveBeenCalled();
});
it("requires a server descriptor and never accepts client versions", async () => {
  const f = fixture();
  f.resolve.mockResolvedValue(null);
  expect(await f.service.register(actor, intent)).toMatchObject({
    error: { code: "GAME_UNAVAILABLE" },
  });
  expect(f.repository.register).not.toHaveBeenCalled();
});
it("keeps cancellation and read available during maintenance", async () => {
  const f = fixture();
  vi.mocked(f.games.find).mockRejectedValue(new Error("must not be called"));
  const input = { schemaVersion: 1, ticketId: f.ticket.ticketId };
  expect((await f.service.cancel(actor, input)).ok).toBe(true);
  expect((await f.service.read(actor, input)).ok).toBe(true);
  expect(f.games.find).not.toHaveBeenCalled();
});
it("returns durable committed identity on reconciliation without new eligibility or writes", async () => {
  const f = fixture();
  const matchId = randomUUID();
  vi.mocked(f.repository.inspect).mockResolvedValue({ matchId, tickets: [f.ticket] });
  expect(await f.service.commit({ schemaVersion: 1, reservationId: randomUUID() })).toEqual({
    ok: true,
    value: { matchId },
  });
  expect(f.repository.commit).not.toHaveBeenCalled();
  expect(f.games.find).not.toHaveBeenCalled();
});
it("checks every selected participant before creating and pins only server descriptor", async () => {
  const f = fixture();
  vi.mocked(f.repository.inspect).mockResolvedValue({
    matchId: null,
    tickets: [f.ticket, { ...f.ticket, actorUserId: randomUUID() }],
  });
  const reservationId = randomUUID();
  expect((await f.service.commit({ schemaVersion: 1, reservationId })).ok).toBe(true);
  expect(f.users.findActiveById).toHaveBeenCalledTimes(2);
  expect(f.repository.commit).toHaveBeenCalledWith(reservationId, descriptor, {});
});
it("redacts dependency failures and marks uncertain outcomes retryable", async () => {
  const f = fixture();
  vi.mocked(f.repository.cancel).mockRejectedValue(new Error("secret query token"));
  const result = await f.service.cancel(actor, { schemaVersion: 1, ticketId: f.ticket.ticketId });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "MATCHMAKING_UNAVAILABLE", retryable: true },
  });
  expect(JSON.stringify(result)).not.toContain("secret");
});

it("recovers registration receipts during maintenance without extending expiry", async () => {
  const f = fixture();
  vi.mocked(f.repository.receipt).mockResolvedValue(f.ticket);
  vi.mocked(f.games.find).mockRejectedValue(new Error("maintenance"));
  expect(await f.service.register(actor, intent)).toEqual({ ok: true, value: f.ticket });
  expect(f.repository.register).not.toHaveBeenCalled();
  expect(f.games.find).not.toHaveBeenCalled();
});

it("keeps the notification contract additive and strips unknown data", () => {
  const event = { schemaVersion: 1, matchId: randomUUID(), reservationId: randomUUID() };
  expect(matchmakingFoundIntentSchema.parse({ ...event, future: true })).toEqual(event);
  expect(matchmakingFoundIntentSchema.safeParse({ ...event, schemaVersion: 2 }).success).toBe(
    false,
  );
});
it.each([
  "00-00000000000000000000000000000000-2222222222222222-01",
  "00-11111111111111111111111111111111-0000000000000000-01",
  "secret",
])("rejects invalid correlation data %#", (traceparent) => {
  expect(
    commitReservationSchema.safeParse({
      schemaVersion: 1,
      reservationId: randomUUID(),
      traceparent,
    }).success,
  ).toBe(false);
});
