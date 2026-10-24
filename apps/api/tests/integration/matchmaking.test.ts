import { hash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "redis";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDatabase } from "@hambazi/database";
import { createErrorEnvelope } from "@hambazi/contracts";
import {
  createMatchAdmissionPort,
  type MatchAdmissionPort,
  type AdmissionOutcome,
} from "../../src/matches/index.js";
import {
  createMatchmaking,
  createRedisMatchmakingQueue,
  createAdmissionCredentials,
  type Outcome,
  type Queue,
} from "../../src/matchmaking/index.js";
import {
  createAccountCreationPort,
  createUserIdentityPort,
  createRegistrationPort,
} from "../../src/users/index.js";
import { createAuthSessions } from "../../src/auth/index.js";
import type { CatalogPort } from "../../src/games/index.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed" ||
  !process.env.API_DATABASE_URL ||
  !process.env.TEST_DATABASE_URL ||
  !process.env.TEST_AUTH_REDIS_URL
)
  throw new Error("Use isolated test:auth-http:local harness");
const config = {
  poolMax: 8,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 5000,
};
const a = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
});
const b = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
});
const admin = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL! },
});
const redis = createClient({ url: process.env.TEST_AUTH_REDIS_URL!, disableOfflineQueue: true });
redis.on("error", () => {});
const queues: ReturnType<typeof createRedisMatchmakingQueue>[] = [];
beforeAll(async () => {
  await Promise.all([a.connect(), b.connect(), admin.connect(), redis.connect()]);
});
afterAll(async () => {
  for (const q of queues) q.close();
  if (redis.isOpen) redis.destroy();
  await Promise.all([a.disconnect(), b.disconnect(), admin.disconnect()]);
});
const descriptor = {
  engineVersion: "isolated-fixture",
  stateSchemaVersion: 1,
  rulesetVersion: "isolated-fixture",
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
function value<T>(result: Outcome<T> | AdmissionOutcome<T>): T {
  if (!result.ok) throw new Error(`Fixture operation failed: ${result.error.code}`);
  return result.value;
}
let sequence = 1500000;
async function fixture(count = 3, lease = 1000, limit = 100, durableLease = 10) {
  const clock = { nowMs: () => Date.now() };
  const namespace = randomUUID();
  const options = {
    url: { reveal: () => process.env.TEST_AUTH_REDIS_URL! },
    namespace,
    reservationMilliseconds: lease,
    searchLimit: limit,
    readLimit: 1000,
    cancelLimit: 1000,
    rateWindowMilliseconds: 1000,
  };
  const qa = createRedisMatchmakingQueue(options),
    qb = createRedisMatchmakingQueue(options);
  queues.push(qa, qb);
  await Promise.all([qa.connect(), qb.connect()]);
  const users = createUserIdentityPort(a);
  const ports = { users, games, descriptor: async () => descriptor };
  const ma = createMatchAdmissionPort(
    a,
    { clock, ticketTtlSeconds: 120, reservationTtlSeconds: durableLease },
    ports,
  );
  const mb = createMatchAdmissionPort(
    b,
    { clock, ticketTtlSeconds: 120, reservationTtlSeconds: durableLease },
    { ...ports, users: createUserIdentityPort(b) },
  );
  const sessions = createAuthSessions({
    database: a,
    users,
    clock,
    lifetimeSeconds: 900,
    telegram: {
      verify: (input, at) => ({
        ok: true,
        identity: { telegramUserId: String(input), authDate: Math.floor(at / 1000) },
      }),
    },
    signing: {
      issuer: "isolated-session",
      audience: "mini",
      activeKeyId: "session",
      keys: [
        { id: "session", secret: { reveal: () => Buffer.alloc(32, 41).toString("base64url") } },
      ],
    },
  });
  const credentials = createAdmissionCredentials({
    clock,
    lifetimeSeconds: 30,
    issuer: "isolated-admission",
    audience: "match",
    activeKeyId: "admission",
    keys: [
      { id: "admission", secret: { reveal: () => Buffer.alloc(32, 42).toString("base64url") } },
    ],
  });
  const actors: { userId: string; token: string; telegram: string }[] = [];
  for (let i = 0; i < count; i++) {
    const telegram = String(++sequence);
    const created = await createAccountCreationPort(a).createForVerifiedTelegramIdentity(
      telegram,
      "Matchmaking fixture",
    );
    if (!created.ok) throw new Error("Account fixture failed");
    await createRegistrationPort(a, clock).complete(telegram, "Matchmaking fixture");
    const issued = await sessions.issue(telegram, randomUUID());
    if (!issued.ok) throw new Error("Session fixture failed");
    actors.push({ userId: created.account.userId, token: issued.accessToken.reveal(), telegram });
  }
  const service = (matches: MatchAdmissionPort, queue: Queue) =>
    createMatchmaking({ matches, queue, credentials, clock, authenticate: sessions.authenticate });
  const first = service(ma, qa.queue),
    second = service(mb, qb.queue);
  const partition = { gameId: "coup", mode: `fixture-${namespace}`, capacity: 2 };
  const input = () => ({ ...partition, schemaVersion: 1 as const, commandId: randomUUID() });
  const ref = (ticketId: string) => ({ schemaVersion: 1 as const, ticketId });
  const enqueue = async (index: number) => value(await first.search(actors[index]!.token, input()));
  const durable = async (index: number, id: string) =>
    value(await ma.read(actors[index]!.userId, ref(id)));
  return {
    clock,
    namespace,
    options,
    qa,
    qb,
    ma,
    mb,
    first,
    second,
    actors,
    partition,
    input,
    ref,
    enqueue,
    durable,
    service,
    sessions,
    credentials,
  };
}
it("deduplicates enqueue across instances, keeps FIFO, and isolates partitions", async () => {
  const f = await fixture(4);
  const intent = f.input();
  const first = value(await f.first.search(f.actors[0]!.token, intent));
  const second = await f.enqueue(1);
  const third = await f.enqueue(2);
  const retries = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? f.first : f.second).search(f.actors[0]!.token, intent),
    ),
  );
  for (const r of retries) expect(value(r).ticketId).toBe(first.ticketId);
  value(await f.first.search(f.actors[3]!.token, { ...f.input(), capacity: 3 }));
  expect(value(await f.second.run({ ...f.partition, capacity: 3 })).matchId).toBeNull();
  const found = value(await f.second.run(f.partition));
  expect(found.matchId).not.toBeNull();
  expect((await f.durable(0, first.ticketId)).matchId).toBe(found.matchId);
  expect((await f.durable(1, second.ticketId)).matchId).toBe(found.matchId);
  expect((await f.durable(2, third.ticketId)).status).toBe("SEARCHING");
  expect(value(await f.first.cancel(f.actors[0]!.token, f.ref(first.ticketId))).status).toBe(
    "MATCHED",
  );
});
it("repeats real Redis/PostgreSQL cancel-versus-match races with one durable winner", async () => {
  const f = await fixture(2);
  for (let i = 0; i < 12; i++) {
    const first = await f.enqueue(0),
      second = await f.enqueue(1);
    const [cancel, run] = await Promise.all([
      f.first.cancel(f.actors[0]!.token, f.ref(first.ticketId)),
      f.second.run(f.partition),
    ]);
    const final = await f.durable(0, first.ticketId);
    expect(value(cancel).status).toBe(final.status);
    expect(["MATCHED", "CANCELLED"]).toContain(final.status);
    if (final.status === "MATCHED") expect(value(run).matchId).toBe(final.matchId);
    else expect(value(run).matchId).toBeNull();
    value(await f.first.cancel(f.actors[1]!.token, f.ref(second.ticketId)));
  }
}, 20000);
it("recovers abandoned Redis claims after TTL and preserves queue order on release", async () => {
  // A real lock/reserve/commit tick must fit inside the fresh claim lease.
  const f = await fixture(3, 500);
  const one = await f.enqueue(0),
    two = await f.enqueue(1);
  const claim = await f.qa.queue.claim(f.partition);
  expect(claim).not.toBeNull();
  await f.enqueue(2);
  await new Promise((r) => setTimeout(r, 550));
  expect(value(await f.second.run(f.partition)).matchId).toBeNull();
  const found = value(await f.second.run(f.partition));
  expect(found.matchId).not.toBeNull();
  expect((await f.durable(0, one.ticketId)).matchId).toBe(found.matchId);
  expect((await f.durable(1, two.ticketId)).matchId).toBe(found.matchId);
  expect(
    await f.ma.commit({ schemaVersion: 1, reservationId: claim!.reservationId }),
  ).toMatchObject({ error: { code: "MATCHMAKING_CONFLICT" } });
});
it("reconciles a lost commit response without duplicate Match or outbox effects", async () => {
  const f = await fixture(2);
  const one = await f.enqueue(0);
  await f.enqueue(1);
  const uncertain = f.service(
    {
      ...f.ma,
      commit: async (input) => {
        value(await f.ma.commit(input));
        return createErrorEnvelope("MATCHMAKING_UNAVAILABLE");
      },
    },
    f.qa.queue,
  );
  const result = value(await uncertain.run(f.partition));
  expect(result.matchId).not.toBeNull();
  expect((await f.durable(0, one.ticketId)).matchId).toBe(result.matchId);
  expect(
    await admin
      .forModule("matches")
      .execute((db) => db.outboxEvent.count({ where: { aggregateId: result.matchId! } })),
  ).toBe(1);
  expect(value(await f.second.run(f.partition)).matchId).toBeNull();
});
it("retains unknown DB outcomes for later recovery instead of returning false match-found", async () => {
  const f = await fixture(2, 100);
  const one = await f.enqueue(0);
  await f.enqueue(1);
  const unavailable = f.service(
    {
      ...f.ma,
      commit: async () => createErrorEnvelope("MATCHMAKING_UNAVAILABLE"),
      release: async () => createErrorEnvelope("MATCHMAKING_UNAVAILABLE"),
    },
    f.qa.queue,
  );
  expect(await unavailable.run(f.partition)).toMatchObject({
    error: { code: "MATCHMAKING_UNAVAILABLE" },
  });
  expect((await f.durable(0, one.ticketId)).status).toBe("RESERVED");
  await new Promise((r) => setTimeout(r, 130));
  expect(value(await f.second.run(f.partition)).matchId).toBeNull();
  expect(value(await f.second.run(f.partition)).matchId).not.toBeNull();
});
it("rejects stale enqueue snapshots and delayed claim release after a newer assignment", async () => {
  const f = await fixture(3, 100);
  const one = await f.enqueue(0),
    two = await f.enqueue(1);
  const oldTicket = await f.durable(0, one.ticketId);
  const old = (await f.qa.queue.claim(f.partition))!;
  value(
    await f.ma.reserve({
      schemaVersion: 1,
      reservationId: old.reservationId,
      tickets: old.tickets.map((t) => ({ ticketId: t.ticketId, generation: t.generation })),
    }),
  );
  value(await f.first.cancel(f.actors[0]!.token, f.ref(one.ticketId)));
  await f.qa.queue.enqueue(oldTicket);
  await new Promise((r) => setTimeout(r, 130));
  value(await f.second.run(f.partition));
  await f.enqueue(2);
  const match = value(await f.second.run(f.partition));
  expect(match.matchId).not.toBeNull();
  await f.qa.queue.finish(f.partition, old, old.tickets);
  expect((await f.durable(0, one.ticketId)).status).toBe("CANCELLED");
  expect((await f.durable(1, two.ticketId)).matchId).toBe(match.matchId);
});
it("authenticates current sessions, binds credentials, and rechecks seat and match state", async () => {
  const f = await fixture(2);
  const one = await f.enqueue(0);
  await f.enqueue(1);
  expect(await f.first.found(f.actors[0]!.token, f.ref(one.ticketId))).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  value(await f.second.run(f.partition));
  const found = value(await f.first.found(f.actors[0]!.token, f.ref(one.ticketId)));
  const input = { ...f.ref(one.ticketId), admissionToken: found.admissionToken.reveal() };
  expect(value(await f.first.admit(f.actors[0]!.token, input)).matchId).toBe(found.matchId);
  expect((await f.first.admit(f.actors[1]!.token, input)).ok).toBe(false);
  const another = await f.sessions.issue(f.actors[0]!.telegram, randomUUID());
  if (!another.ok) throw new Error();
  expect(await f.first.admit(another.accessToken.reveal(), input)).toMatchObject({
    error: { code: "UNAUTHENTICATED" },
  });
  await admin.forModule("matches").execute((db) =>
    db.matchPlayer.updateMany({
      where: { matchId: found.matchId, userId: f.actors[0]!.userId },
      data: { agentType: "BOT" },
    }),
  );
  expect((await f.first.admit(f.actors[0]!.token, input)).ok).toBe(false);
  await admin.forModule("matches").execute((db) =>
    db.matchPlayer.updateMany({
      where: { matchId: found.matchId, userId: f.actors[0]!.userId },
      data: { agentType: "HUMAN" },
    }),
  );
  await admin
    .forModule("matches")
    .execute((db) =>
      db.match.update({ where: { id: found.matchId }, data: { status: "TERMINATED" } }),
    );
  expect((await f.first.admit(f.actors[0]!.token, input)).ok).toBe(false);
  await f.sessions.revoke(f.actors[0]!.token);
  expect(await f.first.read(f.actors[0]!.token, f.ref(one.ticketId))).toMatchObject({
    error: { code: "UNAUTHENTICATED" },
  });
});
it("shares atomic search budgets across nodes and recovers after TTL", async () => {
  const f = await fixture(1, 1000, 3);
  const intent = f.input();
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      (i % 2 ? f.first : f.second).search(f.actors[0]!.token, intent),
    ),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(3);
  expect(results.filter((r) => !r.ok && r.error.code === "RATE_LIMITED")).toHaveLength(7);
  await new Promise((r) => setTimeout(r, 1050));
  expect((await f.first.search(f.actors[0]!.token, intent)).ok).toBe(true);
});
it("rebuilds queue loss from stable receipts while preserving committed results", async () => {
  const f = await fixture(3);
  const one = await f.enqueue(0);
  await f.enqueue(1);
  const intent = f.input();
  const waiting = value(await f.first.search(f.actors[2]!.token, intent));
  const found = value(await f.second.run(f.partition));
  const base = `hambazi:matchmaking:v1:${hash("sha256", f.namespace)}:{${f.partition.gameId}:${f.partition.mode}:${f.partition.capacity}}`;
  const keys = ["tickets", "fifo", "claims", "leases", "sequence", "expiry"].map(
    (suffix) => `${base}:${suffix}`,
  );
  if (keys.length) await redis.del(keys);
  expect(value(await f.first.read(f.actors[0]!.token, f.ref(one.ticketId))).matchId).toBe(
    found.matchId,
  );
  expect(value(await f.first.search(f.actors[2]!.token, intent)).ticketId).toBe(waiting.ticketId);
  expect(value(await f.second.run(f.partition)).matchId).toBeNull();
});
it("recovers an expired durable reservation after complete partition loss using the original commands", async () => {
  const f = await fixture(2, 500, 100, 1);
  const one = await f.enqueue(0),
    two = await f.enqueue(1);
  const original = [await f.durable(0, one.ticketId), await f.durable(1, two.ticketId)];
  const claim = (await f.qa.queue.claim(f.partition))!;
  value(
    await f.ma.reserve({
      schemaVersion: 1,
      reservationId: claim.reservationId,
      tickets: claim.tickets.map((t) => ({ ticketId: t.ticketId, generation: t.generation })),
    }),
  );
  const base = `hambazi:matchmaking:v1:${hash("sha256", f.namespace)}:{${f.partition.gameId}:${f.partition.mode}:${f.partition.capacity}}`;
  await redis.del(
    ["tickets", "fifo", "claims", "leases", "sequence", "expiry"].map(
      (suffix) => `${base}:${suffix}`,
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 1050));
  for (let i = 0; i < 2; i++)
    expect(
      value(
        await f.first.search(f.actors[i]!.token, {
          ...f.input(),
          commandId: original[i]!.commandId,
        }),
      ).ticketId,
    ).toBe(original[i]!.ticketId);
  const found = value(await f.second.run(f.partition));
  expect(found.matchId).not.toBeNull();
  expect(await f.ma.commit({ schemaVersion: 1, reservationId: claim.reservationId })).toMatchObject(
    { error: { code: "MATCHMAKING_CONFLICT" } },
  );
  expect((await f.durable(0, one.ticketId)).matchId).toBe(found.matchId);
});
it("does not let delayed cleanup overwrite newer cancellation metadata", async () => {
  const f = await fixture(2);
  const one = await f.enqueue(0);
  await f.enqueue(1);
  const claim = (await f.qa.queue.claim(f.partition))!;
  value(
    await f.ma.reserve({
      schemaVersion: 1,
      reservationId: claim.reservationId,
      tickets: claim.tickets.map((t) => ({ ticketId: t.ticketId, generation: t.generation })),
    }),
  );
  value(await f.ma.release({ schemaVersion: 1, reservationId: claim.reservationId }));
  const stale = [];
  for (const ticket of claim.tickets)
    stale.push(value(await f.ma.read(ticket.actorUserId, f.ref(ticket.ticketId))));
  value(await f.first.cancel(f.actors[0]!.token, f.ref(one.ticketId)));
  await f.qa.queue.finish(f.partition, claim, stale);
  expect(await f.qa.queue.claim(f.partition)).toBeNull();
  expect((await f.durable(0, one.ticketId)).status).toBe("CANCELLED");
});
it("keeps durable cancellation and found credentials available during actual Redis outage/restart", async () => {
  const name = process.env.TEST_AUTH_REDIS_CONTAINER;
  if (!name || !name.startsWith("hambazi-auth-http-"))
    throw new Error("Expected isolated Redis container");
  const f = await fixture(4);
  const one = await f.enqueue(0);
  await f.enqueue(1);
  const waiting = await f.enqueue(3);
  const recovering = await f.enqueue(2);
  const found = value(await f.second.run(f.partition));
  try {
    await promisify(execFile)("docker", ["stop", "--time", "1", name]);
    expect(value(await f.first.cancel(f.actors[3]!.token, f.ref(waiting.ticketId))).status).toBe(
      "CANCELLED",
    );
    expect(value(await f.first.found(f.actors[0]!.token, f.ref(one.ticketId))).matchId).toBe(
      found.matchId,
    );
    expect(await f.first.search(f.actors[3]!.token, f.input())).toMatchObject({
      error: { code: "MATCHMAKING_UNAVAILABLE" },
    });
  } finally {
    await promisify(execFile)("docker", ["start", name]);
  }
  await expect
    .poll(
      async () => {
        try {
          return await f.qa.queue.consume(f.actors[0]!.userId, "read");
        } catch {
          return false;
        }
      },
      { timeout: 10000 },
    )
    .toBe(true);
  expect(value(await f.first.read(f.actors[0]!.token, f.ref(one.ticketId))).matchId).toBe(
    found.matchId,
  );
  expect(value(await f.first.read(f.actors[2]!.token, f.ref(recovering.ticketId))).status).toBe(
    "SEARCHING",
  );
  const fresh = value(await f.first.search(f.actors[3]!.token, f.input()));
  const restored = value(await f.second.run(f.partition));
  expect(restored.matchId).not.toBeNull();
  expect((await f.durable(2, recovering.ticketId)).matchId).toBe(restored.matchId);
  expect((await f.durable(3, fresh.ticketId)).matchId).toBe(restored.matchId);
}, 20000);
