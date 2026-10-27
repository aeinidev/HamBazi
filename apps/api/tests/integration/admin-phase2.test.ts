import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createDatabase } from "@hambazi/database";
import {
  createAdminCrypto,
  createAdminModule,
  createAdminProvisioningModule,
} from "../../src/admin/index.js";
import {
  createUsersAdminOperations,
  createUsersAdminRead,
  createUserIdentityPort,
} from "../../src/users/index.js";
import {
  createGamesAdminOperations,
  createGamesAdminRead,
  createPrivateRegistrationCatalog,
} from "../../src/games/index.js";
import {
  createRoomsAdminOperations,
  createRoomsAdminRead,
  createRoomsPort,
} from "../../src/rooms/index.js";
import {
  createMatchesAdminOperations,
  createMatchesAdminRead,
  createMatchProcessingPort,
} from "../../src/matches/index.js";
import { createAdminHttpApplication } from "../../src/composition/admin-http.js";
import { createAuthSessions } from "../../src/auth/index.js";
import type { AdminAction } from "@hambazi/validation";

if (
  process.env.TEST_ADMIN_CONFIRM !== "owned-disposable-admin" ||
  !/^hambazi-admin-test-[0-9a-f]+$/.test(process.env.TEST_ADMIN_CONTAINER ?? "") ||
  !process.env.TEST_ADMIN_DATABASE_URL ||
  new URL(process.env.TEST_ADMIN_DATABASE_URL).hostname !== "127.0.0.1"
)
  throw new Error("Use test:admin:local only");
const require = createRequire(
  new URL("../../../../packages/database/package.json", import.meta.url),
);
const { Client } = require("pg") as {
  Client: new (options: { connectionString: string }) => {
    connect(): Promise<void>;
    end(): Promise<void>;
    query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
};
const root = new Client({ connectionString: process.env.TEST_ADMIN_DATABASE_URL });
const options = {
  poolMax: 4,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 5000,
};
const runtime = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.TEST_ADMIN_RUNTIME_URL! },
});
const bootstrap = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.TEST_ADMIN_BOOTSTRAP_URL! },
});
const writes = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.TEST_ADMIN_OPERATIONS_URL! },
});
const reads = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.TEST_ADMIN_READER_URL! },
});
const player = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.TEST_ADMIN_DATABASE_URL! },
});
const clock = { nowMs: () => Date.now() };
const realmId = "phase-two",
  username = "phase_two_owner",
  password = "PhaseTwoSyntheticPassword123",
  pin = "012345";
const crypto = createAdminCrypto({
  signingKey: { reveal: () => Buffer.alloc(32, 41).toString("base64url") },
  pinPepper: { reveal: () => Buffer.alloc(32, 42).toString("base64url") },
  commandKey: { reveal: () => Buffer.alloc(32, 43).toString("base64url") },
  issuer: "urn:hambazi:test:phase-two",
  audience: "urn:hambazi:test:admin",
  realmId,
  clock,
  memoryCost: 19456,
  timeCost: 2,
});
const users = createUsersAdminOperations(writes, clock),
  games = createGamesAdminOperations(writes, clock),
  rooms = createRoomsAdminOperations(writes, clock),
  matches = createMatchesAdminOperations(writes, clock);
let module: ReturnType<typeof createAdminModule>, token: string;
const userId = randomUUID(),
  otherUser = randomUUID();
async function loginOwner() {
  const pending = await module.service.login({
    schemaVersion: 1,
    commandId: randomUUID(),
    username,
    password,
  });
  return (
    await module.service.pin(pending.token, { schemaVersion: 1, commandId: randomUUID(), pin })
  ).token;
}
async function prepare(action: AdminAction) {
  const commandId = randomUUID();
  await module.management!.request(token, {
    schemaVersion: 1,
    commandId,
    action,
    reasonCode: "MAINTENANCE",
  });
  token = (
    await module.management!.approve(token, commandId, {
      schemaVersion: 1,
      commandId: randomUUID(),
      password,
      pin,
      confirmed: true,
    })
  ).token;
  return commandId;
}
async function execute(action: AdminAction) {
  const id = await prepare(action);
  return module.management!.execute(token, id);
}
beforeAll(async () => {
  await Promise.all([
    root.connect(),
    runtime.connect(),
    bootstrap.connect(),
    writes.connect(),
    reads.connect(),
    player.connect(),
  ]);
  module = createAdminModule(
    runtime,
    realmId,
    {
      crypto,
      policy: {
        realmId,
        environment: "test",
        sessionSeconds: 900,
        idleSeconds: 300,
        pendingSeconds: 120,
        maxCryptoInFlight: 2,
      },
      clock,
      newId: randomUUID,
      dummyPasswordVerifier: await crypto.hash("SyntheticUnknownPassword123", "password"),
    },
    {
      USER_DISPLAY_NAME: users,
      GAME_AVAILABILITY: games,
      ROOM_CLOSE: rooms,
      MATCH_TERMINATE: matches,
    },
  );
  await createAdminProvisioningModule(bootstrap, {
    crypto,
    realmId,
    clock,
    newId: randomUUID,
    verifyAuthority: async (value) => value === "synthetic-test-authority",
  }).run(
    {
      schemaVersion: 1,
      commandId: randomUUID(),
      username,
      password,
      pin,
      reasonCode: "INITIAL_OWNER_ENROLLMENT",
      confirmed: true,
    },
    "synthetic-test-authority",
  );
  token = await loginOwner();
  await root.query(
    "INSERT INTO games(id,slug,title,min_players,max_players,status,matchmaking_enabled,private_rooms_enabled,chat_enabled,config_schema_version,config_jsonb,updated_at) VALUES('kahroba','kahroba','Kahroba',2,4,'DISABLED',false,false,false,1,'{}',now()) ON CONFLICT (id) DO NOTHING",
  );
  for (const [id, telegram, handle] of [
    [userId, "920000001", "phase_two_user"],
    [otherUser, "920000002", "phase_two_other"],
  ])
    await root.query(
      "INSERT INTO users(id,telegram_user_id,display_name,public_handle,status,updated_at,registration_completed_at) VALUES($1,$2,'Synthetic',$3,'ACTIVE',now(),now())",
      [id, telegram, handle],
    );
});
afterAll(async () => {
  await Promise.allSettled([
    root.end(),
    ...[runtime, bootstrap, writes, reads, player].map((db) => db.disconnect()),
  ]);
});

describe("phase two on owned PostgreSQL with real database roles", () => {
  it("keeps real player session issuance, retry and revocation compatible with the additive generation column", async () => {
    const auth = createAuthSessions({
      database: player,
      users: createUserIdentityPort(player),
      telegram: {
        verify: () => ({
          ok: true,
          identity: { telegramUserId: "920000001", authDate: Math.floor(Date.now() / 1000) },
        }),
      },
      clock,
      lifetimeSeconds: 900,
      signing: {
        issuer: "urn:hambazi:test:phase-two-player",
        audience: "phase-two-player",
        activeKeyId: "fixture",
        keys: [
          { id: "fixture", secret: { reveal: () => Buffer.alloc(32, 51).toString("base64url") } },
        ],
      },
    });
    const commandId = randomUUID();
    const issued = await auth.issue("synthetic-verified-launch", commandId);
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const retry = await auth.issue("synthetic-verified-launch", commandId);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.session.sessionId).toBe(issued.session.sessionId);
    expect((await auth.authenticate(issued.accessToken.reveal())).ok).toBe(true);
    expect((await auth.revoke(issued.accessToken.reveal())).ok).toBe(true);
    expect((await auth.issue("synthetic-verified-launch", commandId)).ok).toBe(false);
    expect((await auth.authenticate(issued.accessToken.reveal())).ok).toBe(false);
  });
  it("creates ordinary credentials once, persists explicit roles, and protects root in SQL", async () => {
    const id = randomUUID(),
      result = await execute({
        operation: "ADMIN_CREATE",
        targetId: id,
        expectedVersion: 0,
        username: "phase_two_operator",
      });
    expect(result.generatedPassword).toHaveLength(12);
    expect(
      (await module.management!.execute(token, result.commandId)).generatedPassword,
    ).toBeUndefined();
    const login = await module.service.login({
      schemaVersion: 1,
      commandId: randomUUID(),
      username: "phase_two_operator",
      password: result.generatedPassword,
    });
    const roleId = randomUUID();
    await execute({
      operation: "ROLE_SAVE",
      targetId: roleId,
      expectedVersion: 0,
      expectedMemberCount: 0,
      name: "Scoped Operator",
      grants: [
        { permission: "rooms.view", environment: "test", gameIds: ["kahroba"], deny: false },
      ],
    });
    await execute({
      operation: "ADMIN_ACCESS",
      targetId: id,
      expectedVersion: 1,
      roleIds: [roleId],
      grants: [],
    });
    expect((await module.service.access(login.token)).permissions).toContain("rooms.view");
    const before = Date.now();
    await execute({
      operation: "ROLE_SAVE",
      targetId: roleId,
      expectedVersion: 1,
      expectedMemberCount: 1,
      name: "Scoped Operator",
      grants: [],
    });
    expect((await module.service.access(login.token)).permissions).not.toContain("rooms.view");
    expect(Date.now() - before).toBeLessThan(5000);
    await execute({ operation: "ADMIN_RESET_PASSWORD", targetId: id, expectedVersion: 2 });
    await expect(module.service.authenticate(login.token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(
      runtime.forModule("admin").execute((db) =>
        db.adminOperator.update({
          where: { id: module ? result.actorId : "" },
          data: { status: "DISABLED" },
        }),
      ),
    ).rejects.toThrow();
    expect(
      (await module.management!.activity(token, id)).items.some(
        (e) => e.operation === "ADMIN_ACCESS",
      ),
    ).toBe(true);
  });
  it("rejects colliding role and operation IDs from another realm without overwriting them", async () => {
    const foreignRealm = "foreign-phase-two",
      foreignActor = randomUUID(),
      roleId = randomUUID(),
      operationId = randomUUID();
    await root.query("INSERT INTO admin_realms(id) VALUES($1)", [foreignRealm]);
    await root.query(
      "INSERT INTO admin_operators(id,realm_id,username,password_verifier,credential_version,session_epoch,authorization_version,status) VALUES($1,$2,'foreign_fixture',$3,1,1,1,'ACTIVE')",
      [foreignActor, foreignRealm, await crypto.hash(password, "password")],
    );
    await root.query(
      "INSERT INTO admin_roles(id,realm_id,name,version,grants_jsonb) VALUES($1,$2,'Foreign protected role',1,'[]')",
      [roleId, foreignRealm],
    );
    await expect(
      execute({
        operation: "ROLE_SAVE",
        targetId: roleId,
        expectedVersion: 0,
        expectedMemberCount: 0,
        name: "Cross realm overwrite",
        grants: [],
      }),
    ).rejects.toThrow();
    expect(
      (await root.query("SELECT realm_id,name,version FROM admin_roles WHERE id=$1", [roleId]))
        .rows[0],
    ).toEqual({ realm_id: foreignRealm, name: "Foreign protected role", version: 1 });
    const foreignAction = {
      operation: "ADMIN_CREATE",
      targetId: randomUUID(),
      expectedVersion: 0,
      username: "foreign_new",
    };
    await root.query(
      "INSERT INTO admin_operations(id,realm_id,actor_id,session_id,authorization_version,credential_version,session_epoch,policy_revision,ownership_epoch,environment,digest,action,reason_code,state,created_at,expires_at) VALUES($1,$2,$3,$4,1,1,1,1,0,'test',$5,$6::jsonb,'ACCESS_ADMINISTRATION','PENDING',now(),now()+interval '2 minutes')",
      [
        operationId,
        foreignRealm,
        foreignActor,
        randomUUID(),
        "a".repeat(64),
        JSON.stringify(foreignAction),
      ],
    );
    await expect(
      module.management!.request(token, {
        schemaVersion: 1,
        commandId: operationId,
        action: {
          operation: "ADMIN_CREATE",
          targetId: randomUUID(),
          expectedVersion: 0,
          username: "cross_realm_new",
        },
        reasonCode: "ACCESS_ADMINISTRATION",
      }),
    ).rejects.toThrow();
    expect(
      (
        await root.query("SELECT realm_id,actor_id,action FROM admin_operations WHERE id=$1", [
          operationId,
        ])
      ).rows[0],
    ).toEqual({ realm_id: foreignRealm, actor_id: foreignActor, action: foreignAction });
  });
  it("keeps ban/unban disabled for OWNER and the operations role while preserving name correction", async () => {
    await root.query("GRANT UPDATE (status,auth_version) ON users TO hambazi_admin_operations");
    await root.query(
      await readFile(
        new URL(
          "../../../../packages/database/prisma/admin-phase2-permissions.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const command = randomUUID();
    for (const status of ["BANNED", "ACTIVE"] as const)
      await expect(
        module.management!.request(token, {
          schemaVersion: 1,
          commandId: command,
          reasonCode: "INCIDENT_RESPONSE",
          action: { operation: "USER_STATUS", targetId: userId, expectedVersion: 0, status },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const actor = await module.service.authenticate(token);
    await expect(
      users.execute({
        id: command,
        realmId,
        actorId: actor.principal.operatorId,
        digest: "a".repeat(64),
        gameId: null,
        action: {
          operation: "USER_STATUS",
          targetId: userId,
          expectedVersion: 0,
          status: "BANNED",
        },
      }),
    ).rejects.toThrow();
    expect(
      (
        await root.query("SELECT status,profile_version,auth_version FROM users WHERE id=$1", [
          userId,
        ])
      ).rows[0],
    ).toMatchObject({ status: "ACTIVE", profile_version: 0, auth_version: 0 });
    expect(
      (await root.query("SELECT count(*)::int AS n FROM user_admin_effects WHERE id=$1", [command]))
        .rows[0]!.n,
    ).toBe(0);
    expect(
      (
        await root.query(
          "SELECT count(*)::int AS n FROM admin_audit_events WHERE command_id=$1 AND event='OPERATION_ADMITTED'",
          [command],
        )
      ).rows[0]!.n,
    ).toBe(0);
    const rename = await prepare({
      operation: "USER_DISPLAY_NAME",
      targetId: userId,
      expectedVersion: 0,
      displayName: "  نام اصلاح‌شده  ",
    });
    const corrected = await Promise.all([
      module.management!.execute(token, rename),
      module.management!.execute(token, rename),
    ]);
    expect(corrected.every((r) => r.state === "SUCCEEDED")).toBe(true);
    expect(
      (
        await root.query(
          "SELECT display_name,profile_version,auth_version FROM users WHERE id=$1",
          [userId],
        )
      ).rows[0],
    ).toEqual({ display_name: "نام اصلاح‌شده", profile_version: 1, auth_version: 0 });
    expect(
      (await root.query("SELECT count(*)::int AS n FROM user_admin_effects WHERE id=$1", [rename]))
        .rows[0]!.n,
    ).toBe(1);
  });
  it("applies excluded-game filters inside owning read queries before pagination or detail reads", async () => {
    const page = await createGamesAdminRead(reads)({ limit: 1 }, null, ["coup"]);
    expect(page.items.map((row) => row.id)).toEqual(["kahroba"]);
    const denied = await createGamesAdminRead(reads)({ limit: 1, id: "kahroba" }, null, [
      "kahroba",
    ]);
    expect(denied.items).toEqual([]);
  });
  it("closes the persistent admission gate without enabling an unreleased game or changing active matches", async () => {
    const registration = createPrivateRegistrationCatalog(player, {
      id: "kahroba",
      slug: "kahroba",
      title: "Kahroba",
      minPlayers: 2,
      maxPlayers: 4,
      status: "ACTIVE",
      playable: true,
      readiness: "NOT_IMPLEMENTED",
      descriptor: null,
      matchmakingEnabled: true,
      privateRoomsEnabled: true,
      chatEnabled: false,
      voiceEnabled: false,
    });
    // Fixture title follows the existing release registration, not arbitrary Admin input.
    const row = (await root.query("SELECT title FROM games WHERE id='kahroba'")).rows[0]!;
    expect(row).toBeDefined();
    await execute({
      operation: "GAME_AVAILABILITY",
      targetId: "kahroba",
      expectedVersion: 0,
      status: "MAINTENANCE",
    });
    expect(await games.allowsNewMatches("kahroba")).toBe(false);
    const read = await registration.find("kahroba");
    if (read.ok) expect(read.game.playable).toBe(false);
    expect((await root.query("SELECT status FROM games WHERE id='kahroba'")).rows[0]!.status).toBe(
      "DISABLED",
    );
    await execute({
      operation: "GAME_AVAILABILITY",
      targetId: "kahroba",
      expectedVersion: 1,
      status: "ACTIVE",
    });
    expect(await games.allowsNewMatches("kahroba")).toBe(true);
  });
  it("serializes room close against start, preserving membership and refusing STARTING/STARTED closure", async () => {
    const roomId = randomUUID();
    await root.query(
      "INSERT INTO rooms(id,game_id,host_user_id,capacity,status,invite_code,schema_version,state_version,expires_at,updated_at) VALUES($1,'kahroba',$2,2,'FULL',$3,1,0,now()+interval '1 hour',now())",
      [roomId, userId, randomUUID()],
    );
    for (const [seat, id] of [userId, otherUser].entries())
      await root.query(
        "INSERT INTO room_members(room_id,user_id,seat,joined_version) VALUES($1,$2,$3,0)",
        [roomId, id, seat],
      );
    const commandId = await prepare({
      operation: "ROOM_CLOSE",
      targetId: roomId,
      expectedVersion: 0,
    });
    const port = createRoomsPort(
      player,
      { clock, ttlSeconds: 600 },
      {
        users: createUserIdentityPort(player),
        games: {
          list: async () => ({ ok: true, games: [] }),
          find: async () => ({
            ok: true,
            game: {
              id: "kahroba",
              slug: "kahroba",
              title: "Synthetic",
              minPlayers: 2,
              maxPlayers: 4,
              status: "ACTIVE",
              playable: true,
              readiness: "NOT_IMPLEMENTED",
              descriptor: null,
              matchmakingEnabled: true,
              privateRoomsEnabled: true,
              chatEnabled: false,
              voiceEnabled: false,
            },
          }),
        },
      },
    );
    const outcomes = await Promise.all([
      module.management!.execute(token, commandId),
      port.start(userId, { schemaVersion: 1, commandId: randomUUID(), roomId, expectedVersion: 0 }),
    ]);
    const row = (await root.query("SELECT status,state_version FROM rooms WHERE id=$1", [roomId]))
      .rows[0]!;
    expect(["CLOSED", "STARTING"]).toContain(row.status);
    expect(row.state_version).toBe(1);
    expect((outcomes[0].state === "SUCCEEDED") === outcomes[1].ok).toBe(false);
    expect(
      (await root.query("SELECT count(*)::int AS n FROM room_members WHERE room_id=$1", [roomId]))
        .rows[0]!.n,
    ).toBe(2);
  });
  it("uses the Match writer lock, preserves engine pins/private state and never fabricates results", async () => {
    const matchId = randomUUID();
    await root.query(
      "INSERT INTO matches(id,game_id,match_type,status,engine_version,state_schema_version,ruleset_version,state_jsonb,state_version,last_event_seq,updated_at) VALUES($1,'kahroba','STANDARD','ACTIVE','fixture-engine',1,'fixture-rules','{\"privateFixture\":true}',0,0,now())",
      [matchId],
    );
    for (const [seat, id] of [userId, otherUser].entries())
      await root.query(
        "INSERT INTO match_players(match_id,user_id,seat,agent_type,connection_status) VALUES($1,$2,$3,'HUMAN','CONNECTED')",
        [matchId, id, seat],
      );
    const commandId = await prepare({
      operation: "MATCH_TERMINATE",
      targetId: matchId,
      expectedVersion: 0,
    });
    const writer = createMatchProcessingPort(
      player,
      { clock, games: [] },
      createUserIdentityPort(player),
    );
    await Promise.all([
      module.management!.execute(token, commandId),
      writer.lifecycle({
        schemaVersion: 1,
        actionId: randomUUID(),
        matchId,
        expectedVersion: 0,
        operation: "TERMINATE",
      }),
    ]);
    expect(
      (
        await root.query(
          "SELECT status,state_version,last_event_seq,engine_version,ruleset_version,state_jsonb FROM matches WHERE id=$1",
          [matchId],
        )
      ).rows[0],
    ).toMatchObject({
      status: "TERMINATED",
      state_version: 1,
      last_event_seq: 1,
      engine_version: "fixture-engine",
      ruleset_version: "fixture-rules",
      state_jsonb: { privateFixture: true },
    });
    expect(
      (await root.query("SELECT count(*)::int AS n FROM game_events WHERE match_id=$1", [matchId]))
        .rows[0]!.n,
    ).toBe(1);
    expect(
      (
        await root.query("SELECT count(*)::int AS n FROM match_results WHERE match_id=$1", [
          matchId,
        ])
      ).rows[0]!.n,
    ).toBe(0);
    await expect(
      writes
        .forModule("matches")
        .execute((db) =>
          db.match.findUnique({ where: { id: matchId }, select: { stateJsonb: true } }),
        ),
    ).rejects.toThrow();
    await expect(
      writes.forModule("matches").execute((db) => db.matchAdminEffect.deleteMany({})),
    ).rejects.toThrow();
  });
  it("runs the built Persian UI against real TLS Backend, cookies, CSRF, OWNER_FINAL and generated credentials", async () => {
    const allocation = createServer();
    await new Promise<void>((resolve) => allocation.listen(0, "127.0.0.1", resolve));
    const address = allocation.address();
    if (!address || typeof address === "string") throw new Error("ADMIN_TEST_PORT");
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      allocation.close((e) => (e ? reject(e) : resolve())),
    );
    const origin = `https://127.0.0.1:${port}`;
    const sources = {
      users: createUsersAdminRead(reads),
      games: createGamesAdminRead(reads),
      rooms: createRoomsAdminRead(reads),
      matches: createMatchesAdminRead(reads),
    };
    const app = await createAdminHttpApplication(
      {
        service: module.service,
        management: module.management,
        csrf: crypto.csrf,
        cookieSeconds: 900,
        pendingSeconds: 120,
        reads: {
          page: (kind, query, scope, excluded) => sources[kind](query, scope, excluded),
          overview: async () => ({ schemaVersion: 1, asOf: new Date().toISOString(), metrics: [] }),
          audit: module.audit,
        },
      },
      {
        key: await readFile(process.env.TEST_ADMIN_TLS_KEY!),
        cert: await readFile(process.env.TEST_ADMIN_TLS_CERT!),
        origin,
        peers: ["127.0.0.1"],
        maxInFlight: 8,
        admitIp: async () => true,
        admitIdentity: async () => true,
      },
    );
    try {
      await app.listen(port, "127.0.0.1");
      await promisify(execFile)(
        "pnpm",
        ["--filter", "@hambazi/admin", "test:browser", "phase2-real.spec.ts"],
        {
          env: { ...process.env, TEST_ADMIN_REAL_URL: origin },
          timeout: 90000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
    } finally {
      await app.close();
    }
  }, 100000);
});
