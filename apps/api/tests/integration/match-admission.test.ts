import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createDatabase } from "@hambazi/database";
import {
  createMatchAdmissionPort,
  type AdmissionOutcome,
  type AdmissionTicket,
} from "../../src/matches/index.js";
import { createAdmissionRepository } from "../../src/matches/infrastructure/repositories/admission.js";
import { createAccountCreationPort, createUserIdentityPort } from "../../src/users/index.js";
import { createCatalogPort, type CatalogPort } from "../../src/games/index.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed" ||
  !process.env.TEST_DATABASE_URL ||
  !process.env.API_DATABASE_URL ||
  !process.env.WORKER_DATABASE_URL
)
  throw new Error("Use isolated test:auth-http:local harness");
const config = {
  poolMax: 8,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 5000,
};
const admin = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL! },
});
const a = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
});
const b = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
});
const worker = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
});
beforeAll(async () => {
  await Promise.all([admin.connect(), a.connect(), b.connect(), worker.connect()]);
});
afterAll(async () => {
  await Promise.all([admin.disconnect(), a.disconnect(), b.disconnect(), worker.disconnect()]);
});
const descriptor = {
  engineVersion: "isolated-fixture-v1",
  stateSchemaVersion: 1,
  rulesetVersion: "isolated-fixture-v1",
};
const games: Pick<CatalogPort, "find"> = {
  find: async () => ({
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
  }),
};
let seq = 990000;
function value<T>(result: AdmissionOutcome<T>): T {
  if (!result.ok) throw new Error(`Synthetic fixture failed: ${result.error.code}`);
  return result.value;
}
async function fixture() {
  const users: string[] = [];
  for (let i = 0; i < 3; i++) {
    const result = await createAccountCreationPort(a).createForVerifiedTelegramIdentity(
      String(++seq),
      "Match admission fixture",
    );
    if (!result.ok) throw new Error("Account fixture failed");
    users.push(result.account.userId);
  }
  const clock = {
    value: Date.parse("2032-01-01T00:00:00Z"),
    nowMs() {
      return this.value;
    },
  };
  const options = { clock, ticketTtlSeconds: 120, reservationTtlSeconds: 10 };
  const ports = { users: createUserIdentityPort(a), games, descriptor: async () => descriptor };
  const first = createMatchAdmissionPort(a, options, ports);
  const second = createMatchAdmissionPort(b, options, {
    ...ports,
    users: createUserIdentityPort(b),
  });
  const input = () => ({
    schemaVersion: 1 as const,
    commandId: randomUUID(),
    gameId: "coup",
    mode: "classic",
    capacity: 2,
  });
  const tickets: AdmissionTicket[] = [];
  for (const user of users.slice(0, 2)) tickets.push(value(await first.register(user, input())));
  const reserve = (rows = tickets) => ({
    schemaVersion: 1 as const,
    reservationId: randomUUID(),
    tickets: rows.map((t) => ({ ticketId: t.ticketId, generation: t.generation })),
  });
  const ref = (ticket = tickets[0]!) => ({ schemaVersion: 1 as const, ticketId: ticket.ticketId });
  const group = (reservationId: string) => ({ schemaVersion: 1 as const, reservationId });
  return { users, first, second, options, ports, clock, input, tickets, reserve, ref, group };
}
it("deduplicates concurrent registration and rejects competing capacity/intent", async () => {
  const f = await fixture();
  const input = f.input();
  const actor = f.users[2]!;
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => (i % 2 ? f.first : f.second).register(actor, input)),
  );
  for (const r of results) expect(r).toEqual(results[0]);
  expect(results[0]!.ok).toBe(true);
  expect(await f.first.register(actor, { ...input, capacity: 3 })).toMatchObject({
    error: { code: "MATCHMAKING_CONFLICT" },
  });
  expect(await f.first.register(actor, { ...f.input(), capacity: 3 })).toMatchObject({
    error: { code: "MATCHMAKING_CONFLICT" },
  });
});
it("races distinct commands for the same active user/game/mode across capacities", async () => {
  const f = await fixture();
  const results = await Promise.all([
    f.first.register(f.users[2]!, f.input()),
    f.second.register(f.users[2]!, { ...f.input(), capacity: 3 }),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok)).toHaveLength(1);
});
it("commits Match, seats, ticket dispositions and one token-free outbox intent atomically", async () => {
  const f = await fixture();
  const claim = f.reserve();
  const claimed = await f.first.reserve(claim);
  expect(claimed.ok).toBe(true);
  expect(await f.second.reserve(claim)).toEqual(claimed);
  const requestId = randomUUID();
  const traceparent = "00-11111111111111111111111111111111-2222222222222222-01";
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? f.first : f.second).commit({
        ...f.group(claim.reservationId),
        requestId,
        traceparent,
      }),
    ),
  );
  const matchId = value(results[0]!).matchId;
  for (const result of results) expect(value(result).matchId).toBe(matchId);
  const rows = await admin.forModule("matches").execute(async (db) => ({
    match: await db.match.findUnique({ where: { id: matchId } }),
    players: await db.matchPlayer.findMany({ where: { matchId }, orderBy: { seat: "asc" } }),
    events: await db.outboxEvent.findMany({ where: { aggregateId: matchId } }),
  }));
  expect(rows.match).toMatchObject({
    status: "CREATED",
    ...descriptor,
    stateJsonb: null,
    stateVersion: 0,
    lastEventSeq: 0,
  });
  expect(rows.players.map((p) => p.seat)).toEqual([0, 1]);
  expect(rows.events).toHaveLength(1);
  expect(rows.events[0]).toMatchObject({ requestId, traceparent });
  expect(rows.events[0]!.payloadJsonb).toEqual({
    schemaVersion: 1,
    reservationId: claim.reservationId,
    matchId,
  });
  expect(await f.first.cancel(f.users[0]!, f.ref())).toMatchObject({
    value: { status: "MATCHED", matchId },
  });
  expect(await f.second.release(f.group(claim.reservationId))).toEqual({
    ok: true,
    value: { matchId },
  });
});
it("cancellation before creation wins and releases the unaffected group member", async () => {
  const f = await fixture();
  const claim = f.reserve();
  value(await f.first.reserve(claim));
  const cancelled = await f.second.cancel(f.users[0]!, f.ref());
  expect(cancelled).toMatchObject({ value: { status: "CANCELLED" } });
  expect(await f.first.commit(f.group(claim.reservationId))).toMatchObject({
    error: { code: "MATCHMAKING_CONFLICT" },
  });
  value(await f.first.release(f.group(claim.reservationId)));
  expect(await f.first.cancel(f.users[0]!, f.ref())).toEqual(cancelled);
  expect(await f.first.read(f.users[1]!, f.ref(f.tickets[1]!))).toMatchObject({
    value: { status: "SEARCHING", generation: 2 },
  });
  expect(await f.first.reserve(claim)).toMatchObject({ error: { code: "MATCHMAKING_CONFLICT" } });
});
it.each(Array.from({ length: 20 }, (_, index) => index + 1))(
  "two-client cancel-versus-commit race %i has exactly one durable winner",
  async () => {
    const f = await fixture();
    const claim = f.reserve();
    value(await f.first.reserve(claim));
    const [cancel, commit] = await Promise.all([
      f.second.cancel(f.users[0]!, f.ref()),
      f.first.commit(f.group(claim.reservationId)),
    ]);
    const final = value(await f.first.read(f.users[0]!, f.ref()));
    expect(["CANCELLED", "MATCHED"]).toContain(final.status);
    expect(value(cancel).status).toBe(final.status);
    expect(commit.ok).toBe(final.status === "MATCHED");
    const group = value(await f.second.inspect(f.group(claim.reservationId)));
    expect(Boolean(group.matchId)).toBe(final.status === "MATCHED");
    if (commit.ok) expect(commit.value.matchId).toBe(final.matchId);
  },
);
it("release versus commit cannot return an aborted reservation that later commits", async () => {
  const f = await fixture();
  const claim = f.reserve();
  value(await f.first.reserve(claim));
  const [release, commit] = await Promise.all([
    f.second.release(f.group(claim.reservationId)),
    f.first.commit(f.group(claim.reservationId)),
  ]);
  expect(Boolean(value(release).matchId)).toBe(commit.ok);
  if (!commit.ok)
    expect(await f.first.commit(f.group(claim.reservationId))).toMatchObject({
      error: { code: "MATCHMAKING_CONFLICT" },
    });
});
it("fences superseded claimants at the exact reservation deadline", async () => {
  const f = await fixture();
  const old = f.reserve();
  const rows = value(await f.first.reserve(old));
  f.clock.value += 10000;
  expect(await f.first.commit(f.group(old.reservationId))).toMatchObject({
    error: { code: "MATCHMAKING_CONFLICT" },
  });
  const next = f.reserve(rows);
  value(await f.second.reserve(next));
  value(await f.first.release(f.group(old.reservationId)));
  expect(await f.first.commit(f.group(old.reservationId))).toMatchObject({
    error: { code: "MATCHMAKING_CONFLICT" },
  });
  expect((await f.second.commit(f.group(next.reservationId))).ok).toBe(true);
});
it("expires tickets without reopening old commands and permits a fresh command", async () => {
  const f = await fixture();
  const ticket = f.tickets[0]!;
  f.clock.value += 120000;
  expect(await f.first.cancel(f.users[0]!, f.ref())).toMatchObject({
    value: { status: "EXPIRED" },
  });
  expect(
    await f.first.register(f.users[0]!, { ...f.input(), commandId: ticket.commandId }),
  ).toMatchObject({ value: { status: "EXPIRED", ticketId: ticket.ticketId } });
  expect(await f.first.register(f.users[0]!, f.input())).toMatchObject({
    value: { status: "SEARCHING" },
  });
  expect(await f.first.reserve(f.reserve())).toMatchObject({
    error: { code: "MATCHMAKING_CONFLICT" },
  });
});
it("caps reservation expiry by ticket expiry", async () => {
  const f = await fixture();
  f.clock.value += 119000;
  const rows = value(await f.first.reserve(f.reserve()));
  expect(rows[0]!.reservationUntil).toBe(rows[0]!.expiresAt);
});
it("binds reservations to their exact ticket generations and rejects partial/mixed groups", async () => {
  const f = await fixture();
  const claim = f.reserve();
  value(await f.first.reserve(claim));
  expect(
    await f.first.reserve({
      ...claim,
      tickets: claim.tickets.map((t) => ({ ...t, generation: 1 })),
    }),
  ).toMatchObject({ error: { code: "MATCHMAKING_CONFLICT" } });
  const fresh = await fixture();
  const third = value(
    await fresh.first.register(fresh.users[2]!, { ...fresh.input(), capacity: 3 }),
  );
  expect(await fresh.first.reserve(fresh.reserve([fresh.tickets[0]!, third]))).toMatchObject({
    error: { code: "MATCHMAKING_CONFLICT" },
  });
  expect(await fresh.first.read(fresh.users[0]!, fresh.ref())).toMatchObject({
    value: { generation: 0, status: "SEARCHING" },
  });
});
it("denies other actors and current inactive users; the real catalog stays disabled", async () => {
  const f = await fixture();
  expect(await f.first.cancel(f.users[1]!, f.ref())).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  const production = createMatchAdmissionPort(a, f.options, {
    ...f.ports,
    games: createCatalogPort(a),
  });
  expect(await production.register(f.users[2]!, f.input())).toMatchObject({
    error: { code: "GAME_UNAVAILABLE" },
  });
  expect(
    value(
      await production.register(f.users[0]!, { ...f.input(), commandId: f.tickets[0]!.commandId }),
    ).ticketId,
  ).toBe(f.tickets[0]!.ticketId);
  const claim = f.reserve();
  value(await f.first.reserve(claim));
  await admin
    .forModule("users")
    .execute((db) => db.user.update({ where: { id: f.users[1]! }, data: { status: "BANNED" } }));
  expect(await f.first.commit(f.group(claim.reservationId))).toMatchObject({
    error: { code: "UNAUTHENTICATED" },
  });
});
it("rolls back all assignments/Match/seats when outbox insertion fails after writes", async () => {
  const f = await fixture();
  const claim = f.reserve();
  value(await f.first.reserve(claim));
  const scope = a.forModule("matches");
  type Client = Parameters<Parameters<typeof scope.transaction>[0]>[0];
  const broken = {
    ...a,
    forModule: () => ({
      ...scope,
      transaction: <T>(operation: (db: Client) => Promise<T>, isolation?: "Serializable") =>
        scope.transaction(
          (db) =>
            operation({
              ...db,
              outboxEvent: {
                ...db.outboxEvent,
                create: () => {
                  throw new Error("synthetic secret failure");
                },
              },
            }),
          isolation,
        ),
    }),
  } as unknown as typeof a;
  const port = createMatchAdmissionPort(broken, f.options, f.ports);
  expect(await port.commit(f.group(claim.reservationId))).toMatchObject({
    error: { code: "MATCHMAKING_UNAVAILABLE", retryable: true },
  });
  expect(value(await f.first.inspect(f.group(claim.reservationId))).matchId).toBeNull();
  for (const ticket of f.tickets)
    expect(value(await f.first.read(ticket.actorUserId, f.ref(ticket))).status).toBe("RESERVED");
  expect(
    await admin
      .forModule("matches")
      .execute((db) => db.matchPlayer.count({ where: { userId: f.users[0]! } })),
  ).toBe(0);
  expect((await f.second.commit(f.group(claim.reservationId))).ok).toBe(true);
});
it("recovers a committed match after losing the transaction response", async () => {
  const f = await fixture();
  const claim = f.reserve();
  value(await f.first.reserve(claim));
  const scope = a.forModule("matches");
  type Client = Parameters<Parameters<typeof scope.transaction>[0]>[0];
  const uncertain = {
    ...a,
    forModule: () => ({
      ...scope,
      transaction: async <T>(operation: (db: Client) => Promise<T>, isolation?: "Serializable") => {
        await scope.transaction(operation, isolation);
        throw new Error("synthetic response lost");
      },
    }),
  } as unknown as typeof a;
  const repository = createAdmissionRepository(uncertain, f.options);
  await expect(repository.commit(claim.reservationId, descriptor)).rejects.toThrow();
  const recovered = value(await f.second.commit(f.group(claim.reservationId)));
  expect(value(await f.second.cancel(f.users[0]!, f.ref())).matchId).toBe(recovered.matchId);
  expect(value(await f.first.release(f.group(claim.reservationId))).matchId).toBe(
    recovered.matchId,
  );
});
it("keeps metadata immutable, restricts Worker access, and denies terminal reopening/deletion", async () => {
  const f = await fixture();
  const claim = f.reserve();
  value(await f.first.reserve(claim));
  await expect(
    worker.forModule("matches").execute((db) => db.matchAdmission.findMany()),
  ).rejects.toThrow();
  await expect(
    worker.forModule("matches").execute((db) => db.matchReservation.findMany()),
  ).rejects.toThrow();
  await expect(
    a
      .forModule("matches")
      .execute((db) => db.matchAdmission.deleteMany({ where: { id: f.tickets[0]!.ticketId } })),
  ).rejects.toThrow();
  await expect(
    a
      .forModule("matches")
      .execute((db) =>
        db.matchAdmission.update({ where: { id: f.tickets[0]!.ticketId }, data: { capacity: 3 } }),
      ),
  ).rejects.toThrow();
  value(await f.first.cancel(f.users[0]!, f.ref()));
  await expect(
    a.forModule("matches").execute((db) =>
      db.matchAdmission.update({
        where: { id: f.tickets[0]!.ticketId },
        data: { status: "SEARCHING", activeKey: "invalid", generation: { increment: 1 } },
      }),
    ),
  ).rejects.toThrow();
  value(await f.first.release(f.group(claim.reservationId)));
  await expect(
    a.forModule("matches").execute((db) =>
      db.matchReservation.update({
        where: { id: claim.reservationId },
        data: { releasedAt: null },
      }),
    ),
  ).rejects.toThrow();
});
it("fails closed without guessing a cancellation outcome when the database is unavailable", async () => {
  const f = await fixture();
  const closed = createDatabase({
    ...config,
    databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
  });
  const port = createMatchAdmissionPort(closed, f.options, f.ports);
  await closed.disconnect();
  expect(await port.cancel(f.users[0]!, f.ref())).toMatchObject({
    error: { code: "MATCHMAKING_UNAVAILABLE", retryable: true },
  });
  expect(value(await f.first.read(f.users[0]!, f.ref())).status).toBe("SEARCHING");
});
