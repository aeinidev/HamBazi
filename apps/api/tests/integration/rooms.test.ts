import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createDatabase } from "@hambazi/database";
import { createMiniAppOnboarding, createAuthSessions } from "../../src/auth/index.js";
import { initData, signing, telegram } from "../auth/session-fixtures.js";
import { parseRoomStartParam } from "@hambazi/contracts";
import { createRoomsPort, createRoomsRate } from "../../src/rooms/index.js";
import { createRoomsRepository } from "../../src/rooms/infrastructure/repositories/rooms.js";
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
// The production catalog remains disabled. Only this isolated test port grants
// eligibility, without modifying Games storage or bypassing runtime admission.
const games: CatalogPort = {
  list: async () => ({ ok: true, games: [] }),
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
      privateRoomsEnabled: true,
      matchmakingEnabled: false,
      chatEnabled: false,
      voiceEnabled: false,
      readiness: "NOT_IMPLEMENTED",
      descriptor: null,
    },
  }),
};
const invites = {
  target: { botUsername: "HamBaziBot", appName: "play" },
  consume: async () => ({ allowed: true as const }),
};
let seq = 980000;
async function fixture(capacity = 3) {
  const users: string[] = [];
  for (let i = 0; i < 8; i++) {
    const result = await createAccountCreationPort(a).createForVerifiedTelegramIdentity(
      String(++seq),
      "Room test",
    );
    if (!result.ok) throw new Error("Fixture failed");
    users.push(result.account.userId);
  }
  const clock = {
    value: Date.parse("2031-01-01T00:00:00Z"),
    nowMs() {
      return this.value;
    },
  };
  const first = createRoomsPort(
    a,
    { clock, ttlSeconds: 900 },
    { users: createUserIdentityPort(a), games, invites },
  );
  const second = createRoomsPort(
    b,
    { clock, ttlSeconds: 900 },
    { users: createUserIdentityPort(b), games, invites },
  );
  const input = { schemaVersion: 1 as const, commandId: randomUUID(), gameId: "coup", capacity };
  const result = await first.create(users[0]!, input);
  if (!result.ok) throw new Error("Room fixture failed");
  const command = (expectedVersion: number) => ({
    schemaVersion: 1 as const,
    commandId: randomUUID(),
    roomId: result.roomId,
    expectedVersion,
  });
  const invitation = await first.shareInvite(users[0]!, result.roomId);
  if (!invitation.ok) throw new Error("Invite fixture failed");
  const inviteCode = invitation.invite.startParam.slice(5);
  const joinCommand = (version: number) => ({ ...command(version), inviteCode });
  return {
    invitation,
    inviteCode,
    joinCommand,
    users,
    host: users[0]!,
    first,
    second,
    clock,
    input,
    roomId: result.roomId,
    command,
    created: result,
  };
}
it("creates durable host membership, private invite material and stable concurrent create acknowledgements", async () => {
  const f = await fixture();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => (i % 2 ? f.first : f.second).create(f.host, f.input)),
  );
  for (const result of results) expect(result).toEqual(f.created);
  const rooms = await admin
    .forModule("rooms")
    .execute((db) => db.room.findMany({ where: { hostUserId: f.host } }));
  expect(rooms).toHaveLength(1);
  expect(rooms[0]!.inviteCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const read = await f.first.read(f.host, f.roomId);
  expect(read).toMatchObject({
    room: { status: "WAITING", version: 0, members: [{ userId: f.host, seat: 0 }] },
  });
  expect(JSON.stringify(read)).not.toContain(rooms[0]!.inviteCode);
  expect(await f.first.create(f.host, { ...f.input, capacity: 4 })).toMatchObject({
    error: { code: "ROOM_CONFLICT" },
  });
});
it("races two fresh creates with the same command before any receipt exists", async () => {
  const f = await fixture();
  const input = { ...f.input, commandId: randomUUID() };
  const results = await Promise.all([
    f.first.create(f.host, input),
    f.second.create(f.host, input),
  ]);
  expect(results[0]).toMatchObject({ ok: true });
  expect(results[0]).toEqual(results[1]);
  expect(
    await admin
      .forModule("rooms")
      .execute((db) =>
        db.roomCommandReceipt.count({ where: { actorUserId: f.host, commandId: input.commandId } }),
      ),
  ).toBe(1);
});
it("concurrent last-seat joins never exceed capacity; losers can resync", async () => {
  const f = await fixture(2);
  const results = await Promise.all(
    f.users.slice(1).map((user, i) => (i % 2 ? f.first : f.second).join(user, f.joinCommand(0))),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok)).toHaveLength(6);
  const read = await f.first.read(f.host, f.roomId);
  expect(read).toMatchObject({ room: { status: "FULL", version: 1 } });
  if (read.ok) expect(read.room.members).toHaveLength(2);
});
it("duplicate joins have one effect; delayed retries cannot rejoin a departed member", async () => {
  const f = await fixture();
  const user = f.users[1]!;
  const input = f.joinCommand(0);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => (i % 2 ? f.first : f.second).join(user, input)),
  );
  for (const r of results) expect(r).toEqual(results[0]);
  expect(results[0]).toMatchObject({ ok: true, appliedVersion: 1 });
  const leave = f.command(1);
  expect(await f.first.leave(user, leave)).toMatchObject({ ok: true, appliedVersion: 2 });
  expect(await f.second.join(user, input)).toEqual(results[0]);
  expect(await f.second.leave(user, leave)).toMatchObject({ ok: true, appliedVersion: 2 });
  expect(await f.first.join(user, { ...input, commandId: randomUUID() })).toMatchObject({
    error: { code: "ROOM_CONFLICT" },
  });
  expect(await f.first.read(user, f.roomId)).toMatchObject({ error: { code: "NOT_FOUND" } });
  const read = await f.first.read(f.host, f.roomId);
  if (read.ok) expect(read.room.members).toHaveLength(1);
});
it("host departure transfers to oldest remaining join, then closes empty room", async () => {
  const f = await fixture();
  await f.first.join(f.users[1]!, f.joinCommand(0));
  await f.first.join(f.users[2]!, f.joinCommand(1));
  expect(await f.first.start(f.users[1]!, f.command(2))).toMatchObject({
    error: { code: "FORBIDDEN" },
  });
  await f.first.leave(f.host, f.command(2));
  expect(await f.first.read(f.users[1]!, f.roomId)).toMatchObject({
    room: { hostUserId: f.users[1], status: "WAITING" },
  });
  await f.first.leave(f.users[1]!, f.command(3));
  await f.first.leave(f.users[2]!, f.command(4));
  expect(
    await admin.forModule("rooms").execute((db) =>
      db.room.findUnique({
        where: { id: f.roomId },
        select: { status: true, stateVersion: true },
      }),
    ),
  ).toEqual({ status: "CLOSED", stateVersion: 5 });
});
it("start versus leave has one winner, and never leaves a partial starting roster", async () => {
  const f = await fixture(2);
  await f.first.join(f.users[1]!, f.joinCommand(0));
  const results = await Promise.all([
    f.first.start(f.host, f.command(1)),
    f.second.leave(f.users[1]!, f.command(1)),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  const read = await f.first.read(f.host, f.roomId);
  expect(read.ok).toBe(true);
  if (read.ok) {
    expect(read.room.version).toBe(2);
    expect(read.room.members.length).toBe(read.room.status === "STARTING" ? 2 : 1);
  }
});
it("last-seat join versus stale start cannot start an incomplete roster", async () => {
  const f = await fixture(2);
  const results = await Promise.all([
    f.first.join(f.users[1]!, f.joinCommand(0)),
    f.second.start(f.host, f.command(0)),
  ]);
  expect(results[0]).toMatchObject({ ok: true });
  expect(results[1]).toMatchObject({ error: { code: "ROOM_CONFLICT" } });
  expect(await f.first.read(f.host, f.roomId)).toMatchObject({
    room: { status: "FULL", version: 1 },
  });
});
it("expiry wins at the deadline; late/duplicate expiry cannot change STARTING", async () => {
  for (const atDeadline of [false, true]) {
    const f = await fixture(2);
    await f.first.join(f.users[1]!, f.joinCommand(0));
    f.clock.value += atDeadline ? 900000 : 899999;
    const [start] = await Promise.all([
      f.first.start(f.host, f.command(1)),
      f.second.expire(f.roomId),
    ]);
    expect(start.ok).toBe(!atDeadline);
    f.clock.value += 10;
    await f.first.expire(f.roomId);
    await f.second.expire(f.roomId);
    expect(await f.first.read(f.host, f.roomId)).toMatchObject({
      room: { status: atDeadline ? "EXPIRED" : "STARTING", version: 2 },
    });
  }
});
it("confirms and closes only the committed workflow identity; receipts survive service reconstruction", async () => {
  const f = await fixture(2);
  await f.first.join(f.users[1]!, f.joinCommand(0));
  const input = f.command(1);
  const start = await f.first.start(f.host, input);
  const matchId = randomUUID();
  expect(await f.first.confirmStarted(f.roomId, 2, matchId)).toEqual({ ok: true });
  expect(await f.second.confirmStarted(f.roomId, 2, matchId)).toEqual({ ok: true });
  expect(await f.second.confirmStarted(f.roomId, 2, randomUUID())).toMatchObject({
    error: { code: "ROOM_CONFLICT" },
  });
  expect(await f.second.closeStarted(f.roomId, matchId)).toEqual({ ok: true });
  expect(await f.second.closeStarted(f.roomId, matchId)).toEqual({ ok: true });
  expect(await f.second.start(f.host, input)).toEqual(start);
  expect(await f.first.read(f.host, f.roomId)).toMatchObject({
    room: { status: "CLOSED", version: 4, startedMatchId: matchId },
  });
});
it("checks current eligibility even for retries; production catalog cannot admit rooms", async () => {
  const f = await fixture();
  const production = createRoomsPort(
    a,
    { clock: f.clock, ttlSeconds: 900 },
    { users: createUserIdentityPort(a), games: createCatalogPort(a) },
  );
  expect(await production.create(f.host, { ...f.input, commandId: randomUUID() })).toMatchObject({
    error: { code: "GAME_UNAVAILABLE" },
  });
  expect(await production.create(f.host, f.input)).toEqual(f.created);
  await admin
    .forModule("users")
    .execute((db) => db.user.update({ where: { id: f.host }, data: { status: "BANNED" } }));
  expect(await f.first.create(f.host, f.input)).toMatchObject({
    error: { code: "UNAUTHENTICATED" },
  });
});
it("rolls back room and membership if receipt insertion fails after writes", async () => {
  const f = await fixture();
  const scope = a.forModule("rooms");
  type Client = Parameters<Parameters<typeof scope.transaction>[0]>[0];
  const wrapped = {
    ...a,
    forModule: () => ({
      ...scope,
      transaction: <T>(operation: (db: Client) => Promise<T>, isolation?: "Serializable") =>
        scope.transaction(
          (db) =>
            operation({
              ...db,
              roomCommandReceipt: {
                ...db.roomCommandReceipt,
                create: () => {
                  throw new Error("synthetic receipt failure");
                },
              },
            }),
          isolation,
        ),
    }),
  } as unknown as typeof a;
  const repo = createRoomsRepository(wrapped, { clock: f.clock, ttlSeconds: 900 });
  const input = { ...f.input, commandId: randomUUID() };
  await expect(repo.create(f.host, input)).rejects.toThrow("Database operation failed");
  expect(
    await admin
      .forModule("rooms")
      .execute((db) => db.room.count({ where: { hostUserId: f.host } })),
  ).toBe(1);
  expect(
    await admin
      .forModule("rooms")
      .execute((db) =>
        db.roomCommandReceipt.count({ where: { actorUserId: f.host, commandId: input.commandId } }),
      ),
  ).toBe(0);
});
it("restricts receipt access and mutation; database failure exposes no internals", async () => {
  const f = await fixture();
  await expect(
    worker.forModule("rooms").execute((db) => db.roomCommandReceipt.findMany()),
  ).rejects.toThrow();
  await expect(
    a
      .forModule("rooms")
      .execute((db) => db.roomCommandReceipt.deleteMany({ where: { roomId: f.roomId } })),
  ).rejects.toThrow();
  await expect(
    a.forModule("rooms").execute((db) =>
      db.roomCommandReceipt.updateMany({
        where: { roomId: f.roomId },
        data: { appliedVersion: 99 },
      }),
    ),
  ).rejects.toThrow();
  const closed = createDatabase({
    ...config,
    databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
  });
  const port = createRoomsPort(
    closed,
    { clock: f.clock, ttlSeconds: 900 },
    { users: createUserIdentityPort(a), games, invites },
  );
  await closed.disconnect();
  expect(await port.read(f.host, f.roomId)).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
});
it.skipIf(!process.env.TEST_AUTH_REDIS_URL)(
  "atomically enforces independent create/read budgets and fails closed when unavailable",
  async () => {
    const options = {
      url: { reveal: () => process.env.TEST_AUTH_REDIS_URL! },
      namespace: randomUUID(),
      readLimit: 5,
      createLimit: 2,
      inviteLimit: 3,
    };
    const one = createRoomsRate(options);
    const two = createRoomsRate(options);
    try {
      await Promise.all([one.connect(), two.connect()]);
      const user = randomUUID();
      const decisions = await Promise.all(
        Array.from({ length: 10 }, (_, i) => (i % 2 ? one : two).consume("create", user)),
      );
      expect(decisions.filter((d) => d.allowed)).toHaveLength(2);
      expect(await one.consume("read", user)).toEqual({ allowed: true });
      const invites = await Promise.all(
        Array.from({ length: 10 }, (_, i) => (i % 2 ? one : two).consume("invite", user)),
      );
      expect(invites.filter((d) => d.allowed)).toHaveLength(3);
      one.close();
      expect(await one.consume("read", user)).toEqual({ allowed: false, reason: "unavailable" });
    } finally {
      one.close();
      two.close();
    }
  },
);

it("requires the matching opaque code even for cached joins and never leaks the roster in previews", async () => {
  const f = await fixture();
  const input = f.joinCommand(0);
  const user = f.users[1]!;
  const resolve = { schemaVersion: 1, startParam: f.invitation.invite.startParam };
  const preview = await f.second.resolveInvite(user, resolve);
  expect(preview).toMatchObject({ ok: true, room: { id: f.roomId, version: 0 } });
  expect(JSON.stringify(preview)).not.toContain(f.host);
  expect(await f.first.read(user, f.roomId)).toMatchObject({ error: { code: "NOT_FOUND" } });
  expect(await f.first.join(user, { ...input, inviteCode: "A".repeat(43) })).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  expect(await f.first.join(user, input)).toMatchObject({ ok: true, appliedVersion: 1 });
  expect(await f.second.join(user, { ...input, inviteCode: "A".repeat(43) })).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  const other = await fixture();
  expect(await f.first.join(user, { ...input, inviteCode: other.inviteCode })).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
});
it("expiry invalidates previews and fresh joins, while committed retries preserve one effect", async () => {
  const f = await fixture();
  const input = f.joinCommand(0);
  const joined = await f.first.join(f.users[1]!, input);
  f.clock.value += 900000;
  expect(
    await f.second.resolveInvite(f.users[2]!, {
      schemaVersion: 1,
      startParam: f.invitation.invite.startParam,
    }),
  ).toMatchObject({ error: { code: "NOT_FOUND" } });
  expect(await f.first.shareInvite(f.host, f.roomId)).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  expect((await f.first.join(f.users[2]!, f.joinCommand(1))).ok).toBe(false);
  expect(await f.second.join(f.users[1]!, input)).toEqual(joined);
  expect(await f.first.read(f.host, f.roomId)).toMatchObject({
    room: { status: "EXPIRED", members: [{ userId: f.host }, { userId: f.users[1] }] },
  });
});
it("host transfer changes sharing authority and start closes invitation resolution", async () => {
  const f = await fixture(2);
  await f.first.join(f.users[1]!, f.joinCommand(0));
  const request = { schemaVersion: 1, startParam: f.invitation.invite.startParam };
  expect(await f.first.resolveInvite(f.users[2]!, request)).toMatchObject({
    room: { status: "FULL" },
  });
  expect(await f.first.shareInvite(f.users[1]!, f.roomId)).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  await f.first.leave(f.host, f.command(1));
  expect(await f.first.shareInvite(f.host, f.roomId)).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  expect(await f.first.shareInvite(f.users[1]!, f.roomId)).toEqual(f.invitation);
  await f.first.join(f.users[2]!, f.joinCommand(2));
  await f.first.start(f.users[1]!, f.command(3));
  expect(await f.second.resolveInvite(f.users[3]!, request)).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
});

it("preserves a signed invite through real account/session persistence and authenticated idempotent admission", async () => {
  const f = await fixture();
  const users = createUserIdentityPort(a);
  const auth = createAuthSessions({
    database: a,
    users,
    telegram,
    clock: f.clock,
    lifetimeSeconds: 300,
    signing,
  });
  const onboarding = createMiniAppOnboarding({
    accounts: createAccountCreationPort(a),
    users,
    telegram,
    clock: f.clock,
  });
  const startParam = new URL(f.invitation.invite.deepLink).searchParams.get("startapp")!;
  const signed = initData(++seq, f.clock.value / 1000, startParam);
  expect(await auth.issue(signed, randomUUID())).toMatchObject({
    error: { code: "UNAUTHENTICATED" },
  });
  const created = await onboarding.create(signed, randomUUID(), "Invite newcomer");
  if (!created.ok) throw new Error("Synthetic account failed");
  expect(created.startParam).toBe(startParam);
  expect(await f.first.read(created.account.userId, f.roomId)).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  const issued = await auth.issue(signed, randomUUID());
  if (!issued.ok) throw new Error("Synthetic session failed");
  const authenticated = await auth.authenticate(issued.accessToken.reveal());
  if (!authenticated.ok) throw new Error("Synthetic authentication failed");
  const actor = authenticated.session.userId;
  expect(actor).toBe(created.account.userId);
  const preview = await f.second.resolveInvite(actor, {
    schemaVersion: 1,
    startParam: created.startParam,
  });
  if (!preview.ok) throw new Error("Synthetic preview failed");
  const join = {
    ...f.command(preview.room.version),
    inviteCode: parseRoomStartParam(created.startParam),
  };
  const joined = await f.first.join(actor, join);
  expect(joined).toMatchObject({ ok: true, appliedVersion: 1 });
  expect(await f.second.join(actor, join)).toEqual(joined);
  expect(await f.second.read(actor, f.roomId)).toMatchObject({
    room: { members: [{ userId: f.host }, { userId: actor }] },
  });
});
