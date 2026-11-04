import { request as httpsRequest } from "node:https";
import { randomUUID, randomBytes, randomInt } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { createDatabase } from "@hambazi/database";
import {
  createAdminCrypto,
  createAdminModule,
  createAdminProvisioningModule,
} from "../../src/admin/index.js";
import {
  createUsersAdminOperations,
  createUsersAdminRead,
  createUsersAdminDetail,
  createProfileCleanup,
  createUserIdentityPort,
} from "../../src/users/index.js";
import { createGamesAdminOperations, createGamesAdminRead } from "../../src/games/index.js";
import { createRoomsAdminOperations, createRoomsAdminRead } from "../../src/rooms/index.js";
import {
  createMatchesAdminOperations,
  createMatchesAdminRead,
  createAdminUserHistory,
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
function roleUrl(role: "hambazi_api" | "hambazi_worker") {
  const uri = new URL(process.env.TEST_ADMIN_DATABASE_URL!);
  uri.username = role;
  return uri.toString();
}
const player = createDatabase({
  ...options,
  databaseUrl: { reveal: () => roleUrl("hambazi_api") },
});
const worker = createDatabase({
  ...options,
  databaseUrl: { reveal: () => roleUrl("hambazi_worker") },
});
let time = Date.now();
const clock = { nowMs: () => time };
let helperSessionTime: number | null = null;
beforeEach(() => {
  time = Date.now();
  helperSessionTime = null;
});
const realmId = "phase-three",
  username = "phase_three_owner",
  password = randomBytes(32).toString("base64url"),
  pin = randomInt(100000, 1000000).toString();
const crypto = createAdminCrypto({
  signingKey: { reveal: () => Buffer.alloc(32, 41).toString("base64url") },
  pinPepper: { reveal: () => Buffer.alloc(32, 42).toString("base64url") },
  commandKey: { reveal: () => Buffer.alloc(32, 43).toString("base64url") },
  issuer: "urn:hambazi:test:phase-three",
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
async function prepare(action: AdminAction, privateNote?: string) {
  if (helperSessionTime !== time) token = await loginOwner();
  const commandId = randomUUID();
  await module.management!.request(token, {
    schemaVersion: 1,
    commandId,
    action,
    reasonCode: ["USER_RESTRICT", "USER_UNRESTRICT"].includes(action.operation)
      ? "ABUSE"
      : "MAINTENANCE",
    ...(privateNote ? { privateNote } : {}),
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
  helperSessionTime = time;
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
    worker.connect(),
  ]);
  module = createAdminModule(
    runtime,
    realmId,
    {
      crypto,
      restrictionsEnabled: true,
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
      USER_RESTRICT: users,
      USER_UNRESTRICT: users,
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
    [userId, "930000001", "phase_three_user"],
    [otherUser, "930000002", "phase_three_other"],
  ])
    await root.query(
      "INSERT INTO users(id,telegram_user_id,display_name,public_handle,status,updated_at,registration_completed_at) VALUES($1,$2,'Synthetic',$3,'ACTIVE',now(),now())",
      [id, telegram, handle],
    );
});
afterAll(async () => {
  await application?.close();
  await Promise.allSettled([
    root.end(),
    ...[runtime, bootstrap, writes, reads, player, worker].map((db) => db.disconnect()),
  ]);
});

let application: Awaited<ReturnType<typeof createAdminHttpApplication>> | undefined;
let origin: string;
beforeAll(async () => {
  const allocation = createServer();
  await new Promise<void>((r) => allocation.listen(0, "127.0.0.1", r));
  const address = allocation.address();
  if (!address || typeof address === "string") throw new Error("LOCAL_PORT_REQUIRED");
  const port = address.port;
  await new Promise<void>((r, j) => allocation.close((e) => (e ? j(e) : r())));
  origin = `https://127.0.0.1:${port}`;
  const pages = {
    users: createUsersAdminRead(reads),
    games: createGamesAdminRead(reads),
    rooms: createRoomsAdminRead(reads),
    matches: createMatchesAdminRead(reads),
  };
  const detail = createUsersAdminDetail(reads),
    history = createAdminUserHistory(reads);
  application = await createAdminHttpApplication(
    {
      service: module.service,
      management: module.management,
      csrf: crypto.csrf,
      cookieSeconds: 900,
      pendingSeconds: 120,
      reads: {
        restrictionsEnabled: true,
        page: (k, q, g, e) => pages[k](q, g, e),
        userDetail: (k, id, q) =>
          k === "profile"
            ? detail.profile(id)
            : k === "history"
              ? history(id, q.cursor, q.limit)
              : detail.restrictions(id, q.cursor, q.limit),
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
  await application.listen(port, "127.0.0.1");
});
function http(path: string, session?: string, body?: unknown, csrf?: string) {
  return new Promise<{ status: number; data: unknown; text: string }>((resolve, reject) => {
    const req = httpsRequest(
      origin + "/v1/admin/" + path,
      {
        rejectUnauthorized: false,
        method: body ? "POST" : "GET",
        headers: {
          ...(session ? { cookie: "__Host-hambazi-admin=" + session } : {}),
          ...(body ? { origin, "content-type": "application/json" } : {}),
          ...(csrf ? { "x-csrf-token": csrf } : {}),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (s: string) => {
          text += s;
        });
        res.on("end", () => resolve({ status: res.statusCode!, data: JSON.parse(text), text }));
      },
    );
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("LOCAL_HTTP_TIMEOUT")));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
async function addUser(label = "Phase Three User") {
  const id = randomUUID();
  const telegram = String(randomInt(940000000, 990000000));
  await root.query(
    "INSERT INTO users(id,telegram_user_id,display_name,public_handle,status,updated_at,registration_completed_at) VALUES($1,$2,$3,$4,'ACTIVE',now(),now())",
    [id, telegram, label, "u_" + id.replaceAll("-", "")],
  );
  return { id, telegram };
}
function playerAuth(telegram: string) {
  return createAuthSessions({
    database: player,
    users: createUserIdentityPort(player, clock),
    telegram: {
      verify: () => ({
        ok: true,
        identity: { telegramUserId: telegram, authDate: Math.floor(time / 1000) },
      }),
    },
    clock,
    lifetimeSeconds: 900,
    signing: {
      issuer: "urn:hambazi:test:phase-three-player",
      audience: "phase-three-player",
      activeKeyId: "fixture",
      keys: [
        { id: "fixture", secret: { reveal: () => Buffer.alloc(32, 61).toString("base64url") } },
      ],
    },
  });
}
describe("phase three local restrictions and evidence", () => {
  it("cancels an over-budget Admin reader query without poisoning the connection", async () => {
    const reader = new Client({ connectionString: process.env.TEST_ADMIN_READER_URL! });
    await reader.connect();
    try {
      await expect(reader.query("SELECT pg_sleep(3)")).rejects.toMatchObject({ code: "57014" });
      expect((await reader.query("SELECT 1 AS healthy")).rows[0]!.healthy).toBe(1);
    } finally {
      await reader.end();
    }
  });
  it.each([
    ["HOUR_1", 3600000],
    ["HOURS_24", 86400000],
    ["DAYS_7", 604800000],
    ["DAYS_30", 2592000000],
    ["PERMANENT", null],
  ] as const)(
    "applies %s exactly and deduplicates approval/effect",
    async (duration, milliseconds) => {
      const victim = await addUser();
      const command = await prepare({
        operation: "USER_RESTRICT",
        targetId: victim.id,
        expectedVersion: 0,
        duration,
      });
      const results = await Promise.all([
        module.management!.execute(token, command),
        module.management!.execute(token, command),
      ]);
      expect(results.every((r) => r.state === "SUCCEEDED" || r.state === "UNKNOWN")).toBe(true);
      expect((await module.management!.status(token, command)).state).toBe("SUCCEEDED");
      const row = (
        await root.query(
          "SELECT duration,created_at,expires_at FROM user_restrictions WHERE id=$1",
          [command],
        )
      ).rows[0]!;
      expect(row.duration).toBe(duration);
      expect(
        milliseconds === null
          ? row.expires_at
          : new Date(String(row.expires_at)).getTime() - new Date(String(row.created_at)).getTime(),
      ).toBe(milliseconds);
      expect(
        (
          await root.query("SELECT status,auth_version,profile_version FROM users WHERE id=$1", [
            victim.id,
          ])
        ).rows[0],
      ).toMatchObject({ status: "BANNED", auth_version: 1, profile_version: 1 });
      expect(
        (
          await root.query("SELECT count(*)::int AS n FROM user_admin_effects WHERE id=$1", [
            command,
          ])
        ).rows[0]!.n,
      ).toBe(1);
      await expect(
        users.execute({
          id: randomUUID(),
          realmId,
          actorId: results[0]!.actorId,
          digest: "a".repeat(64),
          gameId: null,
          action: {
            operation: "USER_STATUS",
            targetId: victim.id,
            expectedVersion: 1,
            status: "ACTIVE",
          },
        }),
      ).rejects.toThrow("ADMIN_EFFECT_INVALID");
    },
  );
  it("expires at the boundary atomically, rejects old sessions, and keeps permanent bans durable", async () => {
    const victim = await addUser(),
      auth = playerAuth(victim.telegram);
    const issued = await auth.issue("verified-local-launch", randomUUID());
    if (!issued.ok) throw new Error("LOCAL_AUTH_REQUIRED");
    expect((await auth.authenticate(issued.accessToken.reveal())).ok).toBe(true);
    const command = await prepare({
      operation: "USER_RESTRICT",
      targetId: victim.id,
      expectedVersion: 0,
      duration: "HOUR_1",
    });
    await module.management!.execute(token, command);
    expect((await auth.authenticate(issued.accessToken.reveal())).ok).toBe(false);
    time += 3599999;
    expect(await createUserIdentityPort(player, clock).findActiveById(victim.id)).toBeUndefined();
    time++;
    const eligible = await Promise.all(
      Array.from({ length: 4 }, () =>
        createUserIdentityPort(player, clock).findActiveById(victim.id),
      ),
    );
    expect(eligible.every((r) => r?.authVersion === 2)).toBe(true);
    expect(
      (await root.query("SELECT end_kind FROM user_restrictions WHERE id=$1", [command])).rows[0]!
        .end_kind,
    ).toBe("EXPIRED");
    expect((await auth.authenticate(issued.accessToken.reveal())).ok).toBe(false);
    expect((await auth.issue("verified-local-launch", randomUUID())).ok).toBe(true);
    const forever = await addUser();
    const permanent = await prepare({
      operation: "USER_RESTRICT",
      targetId: forever.id,
      expectedVersion: 0,
      duration: "PERMANENT",
    });
    await module.management!.execute(token, permanent);
    time += 31536000000;
    expect(await createUserIdentityPort(player, clock).findActiveById(forever.id)).toBeUndefined();
    expect(
      (await root.query("SELECT ended_at FROM user_restrictions WHERE id=$1", [permanent])).rows[0]!
        .ended_at,
    ).toBeNull();
  });
  it("unban cannot resurrect an unexpired old token; stale unban cannot remove a later restriction", async () => {
    const victim = await addUser(),
      auth = playerAuth(victim.telegram);
    const issued = await auth.issue("verified-local-launch", randomUUID());
    if (!issued.ok) throw new Error("LOCAL_AUTH_REQUIRED");
    const first = await prepare({
      operation: "USER_RESTRICT",
      targetId: victim.id,
      expectedVersion: 0,
      duration: "DAYS_7",
    });
    await module.management!.execute(token, first);
    const lifted = await execute({
      operation: "USER_UNRESTRICT",
      targetId: victim.id,
      expectedVersion: 1,
      restrictionId: first,
    });
    expect(lifted.state).toBe("SUCCEEDED");
    expect((await auth.authenticate(issued.accessToken.reveal())).ok).toBe(false);
    expect((await auth.issue("verified-local-launch", randomUUID())).ok).toBe(true);
    const permanent = await execute({
      operation: "USER_RESTRICT",
      targetId: victim.id,
      expectedVersion: 2,
      duration: "PERMANENT",
    });
    expect(permanent.state).toBe("SUCCEEDED");
    expect(
      (
        await execute({
          operation: "USER_UNRESTRICT",
          targetId: victim.id,
          expectedVersion: 3,
          restrictionId: first,
        })
      ).resultCode,
    ).toBe("VERSION_OR_STATE_CONFLICT");
    expect(await createUserIdentityPort(player, clock).findActiveById(victim.id)).toBeUndefined();
    await expect(
      root.query("UPDATE user_restrictions SET reason_code='SPAM' WHERE id=$1", [first]),
    ).rejects.toThrow();
    expect(
      (
        await execute({
          operation: "USER_UNRESTRICT",
          targetId: victim.id,
          expectedVersion: 3,
          restrictionId: permanent.commandId,
        })
      ).state,
    ).toBe("SUCCEEDED");
    expect((await auth.authenticate(issued.accessToken.reveal())).ok).toBe(false);
  });
  it("keeps legacy bans fail-closed until an explicitly approved manual unban", async () => {
    const victim = await addUser();
    await root.query("UPDATE users SET status='BANNED' WHERE id=$1", [victim.id]);
    time += 3600000;
    expect(await createUserIdentityPort(player, clock).findActiveById(victim.id)).toBeUndefined();
    expect(
      (
        await execute({
          operation: "USER_UNRESTRICT",
          targetId: victim.id,
          expectedVersion: 0,
          restrictionId: null,
        })
      ).state,
    ).toBe("SUCCEEDED");
    expect(
      (await createUserIdentityPort(player, clock).findActiveById(victim.id))?.authVersion,
    ).toBe(1);
  });
  it("serializes competing restrictions with one winner and expires through existing Worker cleanup", async () => {
    const victim = await addUser();
    const actor = (await module.service.authenticate(await loginOwner())).principal.operatorId;
    const commands = Array.from({ length: 2 }, () => ({
      id: randomUUID(),
      realmId,
      actorId: actor,
      digest: "b".repeat(64),
      gameId: null,
      reasonCode: "SPAM",
      action: {
        operation: "USER_RESTRICT",
        targetId: victim.id,
        expectedVersion: 0,
        duration: "HOUR_1",
      },
    }));
    const results = await Promise.all(commands.map((c) => users.execute(c)));
    expect(results.map((r) => r.code).sort()).toEqual(["APPLIED", "VERSION_OR_STATE_CONFLICT"]);
    time += 3600000;
    expect((await createProfileCleanup(worker, clock)({ schemaVersion: 1, limit: 50 })).ok).toBe(
      true,
    );
    expect(
      (await root.query("SELECT status,auth_version FROM users WHERE id=$1", [victim.id])).rows[0],
    ).toMatchObject({ status: "ACTIVE", auth_version: 2 });
    expect((await createProfileCleanup(worker, clock)({ schemaVersion: 1, limit: 50 })).ok).toBe(
      true,
    );
    expect(
      (await root.query("SELECT auth_version FROM users WHERE id=$1", [victim.id])).rows[0]!
        .auth_version,
    ).toBe(2);
  });
  it("encrypts optional notes, binds them to approval, and discloses only after independent permission and Audit", async () => {
    const victim = await addUser();
    const note = "گزارش محرمانهٔ آزمایشی " + randomUUID();
    const action = {
      operation: "USER_RESTRICT" as const,
      targetId: victim.id,
      expectedVersion: 0,
      duration: "HOURS_24" as const,
    };
    const command = await prepare(action, note);
    expect((await module.management!.execute(token, command)).state).toBe("SUCCEEDED");
    const row = (
      await root.query("SELECT private_note_ciphertext,action FROM admin_operations WHERE id=$1", [
        command,
      ])
    ).rows[0]!;
    expect(JSON.stringify(row)).not.toContain(note);
    expect(row.private_note_ciphertext).toEqual(expect.any(String));
    expect(JSON.stringify(await module.management!.status(token, command))).not.toContain(note);
    await expect(
      module.management!.request(token, {
        schemaVersion: 1,
        commandId: command,
        action,
        reasonCode: "ABUSE",
        privateNote: note + "changed",
      }),
    ).rejects.toMatchObject({ code: "ADMIN_CONFLICT" });
    expect((await http(`operations/${command}/private-note`, token)).data).toEqual({
      schemaVersion: 1,
      privateNote: note,
    });
    const audits = (
      await root.query("SELECT event,reason_code FROM admin_audit_events WHERE command_id=$1", [
        command,
      ])
    ).rows;
    expect(audits.some((r) => r.event === "PRIVATE_NOTE_VIEWED")).toBe(true);
    expect(JSON.stringify(audits)).not.toContain(note);
    await expect(
      reads
        .forModule("admin")
        .execute((db) => db.adminOperation.findUnique({ where: { id: command } })),
    ).rejects.toThrow();
    const damaged = String(row.private_note_ciphertext).slice(0, -2) + "aa";
    expect(() =>
      crypto.openPrivateNote!(damaged, JSON.stringify([realmId, command, victim.id])),
    ).toThrow();
    expect(() =>
      crypto.openPrivateNote!(
        String(row.private_note_ciphertext),
        JSON.stringify([realmId, command, randomUUID()]),
      ),
    ).toThrow();
  });
  it("enforces exact revocation and disable actions, stale sessions and authenticated 403 without altering OWNER", async () => {
    const adminId = randomUUID();
    const created = await execute({
      operation: "ADMIN_CREATE",
      targetId: adminId,
      expectedVersion: 0,
      username: "phase_three_lifecycle",
    });
    await execute({
      operation: "ADMIN_ACCESS",
      targetId: adminId,
      expectedVersion: 1,
      roleIds: [],
      grants: [{ permission: "users.view", environment: "test", gameIds: null, deny: false }],
    });
    const login = () =>
      module.service.login({
        schemaVersion: 1,
        commandId: randomUUID(),
        username: "phase_three_lifecycle",
        password: created.generatedPassword,
      });
    const ordinary = await login();
    expect(ordinary.next).toBe("SIGNED_IN");
    expect((await http("users", ordinary.token)).status).toBe(200);
    expect((await http("admins", ordinary.token)).status).toBe(403);
    expect((await http(`users/${userId}/history`, ordinary.token)).status).toBe(403);
    expect((await http(`users/${userId}/restrictions`, ordinary.token)).status).toBe(403);
    expect(
      (await http("operations/" + randomUUID() + "/private-note", ordinary.token)).status,
    ).toBe(403);
    await expect(
      module.management!.request(ordinary.token, {
        schemaVersion: 1,
        commandId: randomUUID(),
        reasonCode: "ABUSE",
        action: {
          operation: "USER_RESTRICT",
          targetId: userId,
          expectedVersion: 0,
          duration: "PERMANENT",
        },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const revoke = await execute({
      operation: "ADMIN_REVOKE_SESSIONS",
      targetId: adminId,
      expectedVersion: 2,
    });
    expect(revoke.state).toBe("SUCCEEDED");
    expect((await http("users", ordinary.token)).status).toBe(401);
    const renewed = await login();
    const disable = await execute({
      operation: "ADMIN_STATUS",
      targetId: adminId,
      expectedVersion: 3,
      status: "DISABLED",
    });
    expect(disable.state).toBe("SUCCEEDED");
    expect((await http("users", renewed.token)).status).toBe(401);
    await expect(login()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(
      (await root.query("SELECT status FROM admin_operators WHERE id=$1", [adminId])).rows[0]!
        .status,
    ).toBe("DISABLED");
    const evidence = (
      await root.query(
        "SELECT event,operation FROM admin_audit_events WHERE command_id IN ($1,$2)",
        [revoke.commandId, disable.commandId],
      )
    ).rows;
    for (const op of ["ADMIN_REVOKE_SESSIONS", "ADMIN_STATUS"])
      expect(evidence.some((r) => r.operation === op && r.event === "OPERATION_SUCCEEDED")).toBe(
        true,
      );
    expect(
      (
        await root.query(
          "SELECT count(*)::int AS n FROM admin_audit_events WHERE operator_id=$1 AND event='AUTHORIZATION_DENIED'",
          [adminId],
        )
      ).rows[0]!.n,
    ).toBeGreaterThan(0);
    const owner = (
      await root.query(
        "SELECT credential_version,pin_failures,locked_at FROM admin_operators WHERE id=(SELECT owner_id FROM admin_realms WHERE id=$1)",
        [realmId],
      )
    ).rows[0]!;
    expect(owner).toMatchObject({ credential_version: 1, pin_failures: 0, locked_at: null });
  });
  it("offers bounded search/profile/history with safe projections and no raw results or identity binding", async () => {
    token = await loginOwner();
    const victim = await addUser("جستجوی ویژه");
    expect(
      (
        await http(
          "users/search?search=" + encodeURIComponent("جستجوی ویژه") + "&status=ACTIVE",
          token,
        )
      ).text,
    ).toContain(victim.id);
    expect((await http("users/search?search=" + "a".repeat(65), token)).status).toBe(400);
    expect((await http("users/search?status=ROOT", token)).status).toBe(400);
    expect((await http("users/search?search=x%00", token)).status).toBe(400);
    expect((await http(`users/${victim.id}/history?limit=51`, token)).status).toBe(400);
    const literal = await addUser("literal_%_search");
    await addUser("literalXfooYsearch");
    expect(
      (await http("users/search?search=" + encodeURIComponent("%"), token)).data,
    ).toMatchObject({ items: [{ id: literal.id }] });
    const profile = await http(`users/${victim.id}/profile`, token);
    expect(profile.status).toBe(200);
    expect(profile.text).not.toContain("telegram");
    expect(profile.text).not.toContain("authVersion");
    const match = randomUUID();
    await root.query(
      "INSERT INTO matches(id,game_id,match_type,status,engine_version,state_schema_version,ruleset_version,state_version,last_event_seq,state_jsonb,updated_at) VALUES($1,'coup','PRIVATE','FINISHED','fixture',1,'fixture',0,0,$2,now())",
      [match, JSON.stringify({ hidden: "DO_NOT_DISCLOSE_PHASE_THREE" })],
    );
    await root.query(
      "INSERT INTO match_players(match_id,user_id,seat,agent_type,connection_status) VALUES($1,$2,0,'HUMAN','CONNECTED')",
      [match, victim.id],
    );
    await root.query(
      "INSERT INTO game_results(match_id,user_id,game_id,placement,winner,schema_version,metrics_jsonb) VALUES($1,$2,'coup',2,false,1,$4),($1,$3,'coup',1,true,1,$4)",
      [match, victim.id, otherUser, JSON.stringify({ hidden: "DO_NOT_DISCLOSE_METRICS" })],
    );
    const history = await http(`users/${victim.id}/history`, token);
    expect(history.status).toBe(200);
    expect(history.text).toContain(match);
    expect(history.data).toMatchObject({ items: [{ id: match, placement: 2, winner: false }] });
    expect(history.text).not.toMatch(/stateJsonb|state_jsonb|payload|metrics|DO_NOT_DISCLOSE/);
    const activeMatch = randomUUID();
    await root.query(
      "INSERT INTO matches(id,game_id,match_type,status,engine_version,state_schema_version,ruleset_version,state_version,last_event_seq,state_jsonb,updated_at) VALUES($1,'coup','PRIVATE','ACTIVE','fixture',1,'fixture',7,11,$2,now())",
      [activeMatch, JSON.stringify({ hidden: "ACTIVE_MATCH_MUST_STAY_UNCHANGED" })],
    );
    await root.query(
      "INSERT INTO match_players(match_id,user_id,seat,agent_type,connection_status) VALUES($1,$2,0,'HUMAN','CONNECTED'),($1,$3,1,'HUMAN','CONNECTED')",
      [activeMatch, victim.id, otherUser],
    );
    const activeBefore = (
      await root.query(
        "SELECT state_jsonb,status,state_version,last_event_seq,engine_version,ruleset_version FROM matches WHERE id=$1",
        [activeMatch],
      )
    ).rows[0];
    const before = (await root.query("SELECT state_jsonb,status FROM matches WHERE id=$1", [match]))
      .rows[0];
    await execute({
      operation: "USER_RESTRICT",
      targetId: victim.id,
      expectedVersion: 0,
      duration: "HOUR_1",
    });
    expect(
      (await root.query("SELECT state_jsonb,status FROM matches WHERE id=$1", [match])).rows[0],
    ).toEqual(before);
    expect(
      (
        await root.query(
          "SELECT state_jsonb,status,state_version,last_event_seq,engine_version,ruleset_version FROM matches WHERE id=$1",
          [activeMatch],
        )
      ).rows[0],
    ).toEqual(activeBefore);
    expect(
      (
        await root.query(
          "SELECT ((SELECT count(*) FROM game_events WHERE match_id=$1)+(SELECT count(*) FROM game_results WHERE match_id=$1))::int AS n",
          [activeMatch],
        )
      ).rows[0]!.n,
    ).toBe(0);
  });
  it("runs Persian phase-three browser flows against the real local TLS backend", async () => {
    await promisify(execFile)(
      "pnpm",
      ["--filter", "@hambazi/admin", "test:browser", "phase3-real.spec.ts"],
      {
        env: {
          ...process.env,
          TEST_ADMIN_PHASE3_URL: origin,
          TEST_ADMIN_PHASE3_USERNAME: username,
          TEST_ADMIN_PHASE3_PASSWORD: password,
          TEST_ADMIN_PHASE3_PIN: pin,
        },
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
  }, 130000);
});
