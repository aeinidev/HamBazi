import { request as httpsRequest } from "node:https";
import { randomUUID, randomBytes, randomInt } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
  createUsersAdminDetail,
} from "../../src/users/index.js";
import * as gamesPublic from "../../src/games/index.js";
import * as roomsPublic from "../../src/rooms/index.js";
import * as matchesPublic from "../../src/matches/index.js";
import { createGamesAdminOperations, createGamesAdminRead } from "../../src/games/index.js";
import { createRoomsAdminOperations, createRoomsAdminRead } from "../../src/rooms/index.js";
import {
  createMatchesAdminOperations,
  createMatchesAdminRead,
  createAdminUserHistory,
} from "../../src/matches/index.js";
import { createAdminHttpApplication } from "../../src/composition/admin-http.js";
import {
  adminGamePageSchema,
  adminGameDetailSchema,
  adminRoomPageSchema,
  adminRoomDetailSchema,
  adminMatchPageSchema,
  adminMatchDetailSchema,
  adminActionSchema,
  adminRoomPlayersSchema,
  adminMatchPlayersSchema,
  adminMatchHistorySchema,
  adminRoomDiagnosticsSchema,
  adminMatchDiagnosticsSchema,
} from "@hambazi/validation";
import type {
  AdminAction,
  AdminGameSearchQuery,
  AdminRoomSearchQuery,
  AdminMatchSearchQuery,
  AdminMatchHistoryQuery,
} from "@hambazi/validation";

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
const clock = { nowMs: () => Date.now() };
const realmId = "phase-four",
  username = "phase_four_owner",
  password = randomBytes(32).toString("base64url"),
  pin = randomInt(100000, 1000000).toString();
const crypto = createAdminCrypto({
  signingKey: { reveal: () => Buffer.alloc(32, 41).toString("base64url") },
  pinPepper: { reveal: () => Buffer.alloc(32, 42).toString("base64url") },
  commandKey: { reveal: () => Buffer.alloc(32, 43).toString("base64url") },
  issuer: "urn:hambazi:test:phase-four",
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
  token = await loginOwner();
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
    [userId, "940000001", "phase_four_user"],
    [otherUser, "940000002", "phase_four_other"],
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
    ...[runtime, bootstrap, writes, reads].map((db) => db.disconnect()),
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
  const advanced = {
    games: gamesPublic.createGamesAdminManagementRead(reads),
    rooms: roomsPublic.createRoomsAdminManagementRead(reads),
    matches: matchesPublic.createMatchesAdminManagementRead(reads),
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
        async management(resource, kind, id, query, gameScope, excluded) {
          if (kind === "diagnostics" && resource !== "games")
            return advanced[resource].diagnostics(id!, gameScope, excluded);
          if (kind === "players" && resource !== "games")
            return advanced[resource].players(id!, gameScope, excluded);
          if (kind === "history" && resource === "matches")
            return advanced.matches.history(
              id!,
              query as AdminMatchHistoryQuery,
              gameScope,
              excluded,
            );
          if (kind === "details") return advanced[resource].detail(id!, gameScope, excluded);
          return resource === "games"
            ? advanced.games.search(query as AdminGameSearchQuery, gameScope, excluded)
            : resource === "rooms"
              ? advanced.rooms.search(query as AdminRoomSearchQuery, gameScope, excluded)
              : advanced.matches.search(query as AdminMatchSearchQuery, gameScope, excluded);
        },
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

const roomIds = [
  "41000000-0000-4000-8000-000000000001",
  "41000000-0000-4000-8000-000000000002",
  "41000000-0000-4000-8000-000000000003",
];
const matchIds = [
  "42000000-0000-4000-8000-000000000001",
  "42000000-0000-4000-8000-000000000002",
  "42000000-0000-4000-8000-000000000003",
];
beforeAll(async () => {
  for (const [id, status, admission] of [
    ["phase-four-alpha", "ACTIVE", "MAINTENANCE"],
    ["phase-four-beta", "DISABLED", "ACTIVE"],
  ])
    await root.query(
      "INSERT INTO games(id,slug,title,min_players,max_players,status,admin_availability,matchmaking_enabled,private_rooms_enabled,chat_enabled,config_schema_version,config_jsonb,updated_at) VALUES($1,$1,$1,2,6,$2,$3,true,true,true,1,$4,now())",
      [id, status, admission, JSON.stringify({ secret: "HIDDEN_CONFIG_PHASE_FOUR" })],
    );
  await root.query(
    "INSERT INTO games(id,slug,title,min_players,max_players,status,matchmaking_enabled,private_rooms_enabled,chat_enabled,config_schema_version,config_jsonb,updated_at) SELECT 'phase-four-page-'||lpad(n::text,2,'0'),'phase-four-page-'||lpad(n::text,2,'0'),'literal_%_page',2,6,'ACTIVE',false,false,false,1,'{}',now() FROM generate_series(1,51) n",
  );
  await root.query(
    "INSERT INTO rooms(id,game_id,host_user_id,capacity,invite_code,status,expires_at,created_at,updated_at) SELECT ('f1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'phase-four-page-01',$1,4,'phase-four-bounded-'||n,'WAITING','2030-01-01','2026-01-02','2026-01-03' FROM generate_series(1,51) n",
    [userId],
  );
  await root.query(
    "INSERT INTO matches(id,game_id,match_type,status,engine_version,state_schema_version,ruleset_version,state_jsonb,created_at,updated_at) SELECT ('f2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'phase-four-page-01','MATCHMAKING','ACTIVE','pinned-engine',2,'pinned-rules','{}'::jsonb,'2026-01-02','2026-01-03' FROM generate_series(1,51) n",
  );
  await root.query(
    "INSERT INTO match_players(match_id,user_id,seat,agent_type,connection_status) SELECT ('f2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,0,'HUMAN','CONNECTED' FROM generate_series(1,51) n",
    [userId],
  );
  for (let i = 0; i < 3; i++) {
    const game = i === 2 ? "phase-four-beta" : "phase-four-alpha";
    await root.query(
      "INSERT INTO rooms(id,game_id,host_user_id,capacity,invite_code,status,expires_at,created_at,updated_at) VALUES($1,$2,$3,4,$4,$5,'2030-01-01','2026-01-02','2026-01-03')",
      [roomIds[i], game, userId, "HIDDEN_INVITE_" + randomUUID(), i === 1 ? "FULL" : "WAITING"],
    );
    await root.query(
      "INSERT INTO matches(id,game_id,room_id,match_type,status,engine_version,state_schema_version,ruleset_version,state_version,last_event_seq,state_jsonb,reconnect_policy_jsonb,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'pinned-engine',2,'pinned-rules',7,11,$6,$6,'2026-01-02','2026-01-03')",
      [
        matchIds[i],
        game,
        i === 2 ? null : roomIds[i],
        ["PRIVATE_ROOM", "MATCHMAKING", "PERSONAL_BOTS_V1"][i],
        i === 1 ? "FINISHED" : "ACTIVE",
        JSON.stringify({ secret: "HIDDEN_STATE_PHASE_FOUR" }),
      ],
    );
    await root.query(
      "INSERT INTO match_players(match_id,user_id,seat,agent_type,connection_status) VALUES($1,$2,0,'HUMAN','CONNECTED')",
      [matchIds[i], i === 1 ? otherUser : userId],
    );
  }
});
describe("phase four scoped owning search and details", () => {
  it("runs phase-four browser acceptance against the owned TLS backend", async () => {
    const unknownMatchId = randomUUID();
    const suspectedRoomId = randomUUID();
    await root.query(
      "INSERT INTO rooms(id,game_id,host_user_id,capacity,invite_code,status,expires_at,updated_at) VALUES($1,'phase-four-alpha',$2,4,$3,'WAITING','2000-01-01',now())",
      [suspectedRoomId, userId, "HIDDEN_BROWSER_" + suspectedRoomId],
    );
    const browserReaderId = randomUUID();
    const browserReader = await execute({
      operation: "ADMIN_CREATE",
      targetId: browserReaderId,
      expectedVersion: 0,
      username: "phase_four_browser_reader",
    });
    await execute({
      operation: "ADMIN_ACCESS",
      targetId: browserReaderId,
      expectedVersion: 1,
      roleIds: [],
      grants: (
        ["rooms.view", "rooms.players.view", "matches.view", "matches.history.view"] as const
      ).map((permission) => ({
        permission,
        environment: "test",
        gameIds: null,
        deny: false,
      })),
    });
    await root.query(
      "INSERT INTO matches(id,game_id,match_type,status,engine_version,state_schema_version,ruleset_version,state_jsonb,created_at,updated_at) VALUES($1,'phase-four-alpha','__proto__','ACTIVE','pinned-engine',2,'pinned-rules','{}'::jsonb,'2026-01-02','2026-01-03')",
      [unknownMatchId],
    );
    try {
      const result = await promisify(execFile)(
        "pnpm",
        ["--filter", "@hambazi/admin", "test:browser", "phase4-real.spec.ts"],
        {
          env: {
            ...process.env,
            TEST_ADMIN_PHASE4_URL: origin,
            TEST_ADMIN_PHASE4_USERNAME: username,
            TEST_ADMIN_PHASE4_PASSWORD: password,
            TEST_ADMIN_PHASE4_PIN: pin,
            TEST_ADMIN_PHASE4_UNKNOWN_MATCH_ID: unknownMatchId,
            TEST_ADMIN_PHASE4_SUSPECTED_ROOM_ID: suspectedRoomId,
            TEST_ADMIN_PHASE4_USER_ID: userId,
            TEST_ADMIN_PHASE4_READER_USERNAME: "phase_four_browser_reader",
            TEST_ADMIN_PHASE4_READER_PASSWORD: browserReader.generatedPassword,
          },
          timeout: 120000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
      expect(result.stdout).toContain("PHASE4_BROWSER_EXECUTED");
    } finally {
      await root.query("DELETE FROM matches WHERE id=$1", [unknownMatchId]);
      await root.query("DELETE FROM rooms WHERE id=$1", [suspectedRoomId]);
    }
  }, 130000);
  it("runs focused phase-four security and accessibility against the owned TLS backend", async () => {
    const readerId = randomUUID();
    const reader = await execute({
      operation: "ADMIN_CREATE",
      targetId: readerId,
      expectedVersion: 0,
      username: "phase_four_security_reader",
    });
    await execute({
      operation: "ADMIN_ACCESS",
      targetId: readerId,
      expectedVersion: 1,
      roleIds: [],
      grants: (["rooms.view", "matches.view"] as const).map((permission) => ({
        permission,
        environment: "test",
        gameIds: null,
        deny: false,
      })),
    });
    const result = await promisify(execFile)(
      "pnpm",
      ["--filter", "@hambazi/admin", "test:browser", "phase4-security-real.spec.ts"],
      {
        env: {
          ...process.env,
          TEST_ADMIN_PHASE4_URL: origin,
          TEST_ADMIN_PHASE4_USERNAME: username,
          TEST_ADMIN_PHASE4_PASSWORD: password,
          TEST_ADMIN_PHASE4_PIN: pin,
          TEST_ADMIN_PHASE4_READER_USERNAME: "phase_four_security_reader",
          TEST_ADMIN_PHASE4_READER_PASSWORD: reader.generatedPassword,
        },
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    expect(result.stdout).toContain("PHASE4_SECURITY_BROWSER_EXECUTED");
  }, 130000);
  it("activates all six authenticated paths and keeps legacy rows strict", async () => {
    for (const [kind, id] of [
      ["games", "phase-four-alpha"],
      ["rooms", roomIds[0]],
      ["matches", matchIds[0]],
    ]) {
      expect((await http(`${kind}/search`, token)).status).toBe(200);
      expect((await http(`${kind}/${id}/details`, token)).status).toBe(200);
      const legacy = await http(`${kind}/${id}`, token);
      expect(legacy.status).toBe(200);
      expect(Object.keys((legacy.data as { items: object[] }).items[0]!).sort()).toEqual(
        (kind === "matches"
          ? ["gameId", "id", "label", "pins", "status", "version"]
          : ["gameId", "id", "label", "status", "version"]
        ).sort(),
      );
      expect((await http(`${kind}/search`)).status).toBe(401);
    }
  });
  it("searches actual admission status/title and exposes only public game detail", async () => {
    const result = await http("games/search?search=phase-four&status=MAINTENANCE", token);
    expect(result.status).toBe(200);
    expect(adminGamePageSchema.parse(result.data).items.map((r) => r.id)).toEqual([
      "phase-four-alpha",
    ]);
    const detail = await http("games/phase-four-alpha/details", token);
    expect(adminGameDetailSchema.parse(detail.data).item).toMatchObject({
      releaseStatus: "ACTIVE",
      admissionStatus: "MAINTENANCE",
      installedVersions: null,
      minPlayers: 2,
      maxPlayers: 6,
    });
    expect(detail.text).not.toMatch(/configJsonb|HIDDEN/);
  });
  it("applies resource/date/player filters before exclusive stable pagination", async () => {
    const rooms = await http(
      "rooms/search?gameId=phase-four-alpha&createdFrom=2026-01-02T00:00:00.000Z&createdTo=2026-01-02T00:00:00.000Z&limit=1",
      token,
    );
    const first = adminRoomPageSchema.parse(rooms.data);
    expect(first.items.map((r) => r.id)).toEqual([roomIds[0]]);
    expect(first.nextCursor).toBe(roomIds[0]);
    const second = adminRoomPageSchema.parse(
      (await http(`rooms/search?gameId=phase-four-alpha&cursor=${first.nextCursor}&limit=1`, token))
        .data,
    );
    expect(second.items.map((r) => r.id)).toEqual([roomIds[1]]);
    expect(second.nextCursor).toBeNull();
    expect(
      adminRoomPageSchema
        .parse((await http("rooms/search?gameId=phase-four-alpha&status=FULL", token)).data)
        .items.map((r) => r.id),
    ).toEqual([roomIds[1]]);
    expect(
      adminRoomPageSchema
        .parse((await http(`rooms/search?search=${roomIds[0]}`, token)).data)
        .items.map((r) => r.id),
    ).toEqual([roomIds[0]]);
    expect(
      adminMatchPageSchema
        .parse(
          (
            await http(
              `matches/search?gameId=phase-four-alpha&playerId=${userId}&status=ACTIVE`,
              token,
            )
          ).data,
        )
        .items.map((r) => r.id),
    ).toEqual([matchIds[0]]);
    expect(
      adminMatchPageSchema
        .parse((await http("matches/search?search=phase-four-beta", token)).data)
        .items.map((r) => r.id),
    ).toEqual([matchIds[2]]);
    expect(
      adminMatchPageSchema.parse(
        (
          await http(
            "matches/search?createdFrom=2026-01-03T00:00:00.000Z&gameId=phase-four-alpha",
            token,
          )
        ).data,
      ).items,
    ).toEqual([]);
    expect(
      adminRoomDetailSchema.parse((await http(`rooms/${roomIds[0]}/details`, token)).data).item,
    ).toMatchObject({ capacity: 4, hostUserId: userId, startedMatchId: null });
    const match = await http(`matches/${matchIds[2]}/details`, token);
    expect(adminMatchDetailSchema.parse(match.data).item).toMatchObject({
      roomId: null,
      matchType: "PERSONAL_BOTS_V1",
      version: 7,
      lastEventSeq: 11,
      pins: {
        engineVersion: "pinned-engine",
        stateSchemaVersion: 2,
        rulesetVersion: "pinned-rules",
      },
    });
    expect(match.text).not.toMatch(/stateJsonb|reconnectPolicy|HIDDEN/);
  });
  it("caps fifty real rows and treats search wildcards literally", async () => {
    const first = adminGamePageSchema.parse(
      (await http("games/search?search=phase-four-page&limit=50", token)).data,
    );
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBe("phase-four-page-50");
    const last = adminGamePageSchema.parse(
      (await http(`games/search?search=phase-four-page&limit=50&cursor=${first.nextCursor}`, token))
        .data,
    );
    expect(last.items.map((r) => r.id)).toEqual(["phase-four-page-51"]);
    expect(last.nextCursor).toBeNull();
    const literalPage = adminGamePageSchema.parse(
      (await http("games/search?search=%25&limit=50", token)).data,
    );
    expect(literalPage.items.map((r) => r.id)).toEqual(
      Array.from({ length: 50 }, (_, i) => `phase-four-page-${String(i + 1).padStart(2, "0")}`),
    );
    expect(literalPage.items.map((r) => r.title)).toEqual(Array(50).fill("literal_%_page"));
    expect(literalPage.nextCursor).toBe("phase-four-page-50");
  });
  it.each(["rooms", "matches"] as const)("caps fifty actual %s rows", async (resource) => {
    const parser = resource === "rooms" ? adminRoomPageSchema : adminMatchPageSchema;
    const first = parser.parse(
      (await http(`${resource}/search?gameId=phase-four-page-01&limit=50`, token)).data,
    );
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBe(first.items[49]!.id);
    const second = parser.parse(
      (
        await http(
          `${resource}/search?gameId=phase-four-page-01&limit=50&cursor=${first.nextCursor}`,
          token,
        )
      ).data,
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.items[0]!.id > first.items[49]!.id).toBe(true);
    if (resource === "matches")
      expect(
        adminMatchPageSchema
          .parse(
            (await http(`matches/search?search=${first.items[0]!.id.toUpperCase()}`, token)).data,
          )
          .items.map((r) => r.id),
      ).toEqual([first.items[0]!.id]);
  });
  it("keeps historical Match types visible exactly as stored", async () => {
    const rows = await root.query(
      "SELECT id,match_type FROM matches WHERE match_type IN ('STANDARD','PRIVATE') ORDER BY id",
    );
    expect(rows.rows.some((r) => r.match_type === "STANDARD")).toBe(true);
    expect(rows.rows.some((r) => r.match_type === "PRIVATE")).toBe(true);
    for (const row of rows.rows) {
      const page = adminMatchPageSchema.parse(
        (await http(`matches/search?search=${row.id}`, token)).data,
      );
      expect(page.items[0]?.matchType).toBe(row.match_type);
      expect(
        adminMatchDetailSchema.parse((await http(`matches/${row.id}/details`, token)).data).item
          .matchType,
      ).toBe(row.match_type);
    }
  });
  it("rejects unknown queries, invalid ranges, wrong IDs and limits above fifty", async () => {
    for (const kind of ["games", "rooms", "matches"]) {
      for (const query of [
        "limit=51",
        "limit=01",
        "environment=test",
        "status=ROOT",
        "limit=1&limit=2",
      ])
        expect((await http(`${kind}/search?${query}`, token)).status).toBe(400);
      expect(
        (await http(`${kind}/${kind === "games" ? "4invalid" : "invalid-id"}/details`, token))
          .status,
      ).toBe(400);
      expect(
        (
          await http(
            `${kind}/${kind === "games" ? "phase-four-alpha" : roomIds[0]}/details?limit=1`,
            token,
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await http(
          "rooms/search?createdFrom=2026-02-01T00:00:00.000Z&createdTo=2026-01-01T00:00:00.000Z",
          token,
        )
      ).status,
    ).toBe(400);
  });
  it("applies game denies and scoped missing details under a real authenticated role", async () => {
    const id = randomUUID();
    const created = await execute({
      operation: "ADMIN_CREATE",
      targetId: id,
      expectedVersion: 0,
      username: "phase_four_limited",
    });
    const ungranted = await module.service.login({
      schemaVersion: 1,
      commandId: randomUUID(),
      username: "phase_four_limited",
      password: created.generatedPassword,
    });
    for (const kind of ["games", "rooms", "matches"])
      expect((await http(`${kind}/search`, ungranted.token)).status).toBe(403);
    const action = {
      operation: "ADMIN_ACCESS" as const,
      targetId: id,
      expectedVersion: 1,
      roleIds: [],
      grants: [
        ...(["games.view", "rooms.view", "matches.view"] as const).flatMap((permission) => [
          { permission, environment: "test", gameIds: null, deny: false },
          { permission, environment: "test", gameIds: ["phase-four-beta"], deny: true },
        ]),
        {
          permission: "matches.players.view" as const,
          environment: "test",
          gameIds: ["phase-four-alpha"],
          deny: false,
        },
      ],
    };
    const accessOperation = await execute(action);
    const persistedOperation = await http(`operations/${accessOperation.commandId}`, token);
    expect(persistedOperation.status).toBe(200);
    expect(persistedOperation.text).toContain("matches.players.view");
    expect(adminActionSchema.parse(action)).toEqual(action);
    const stored = await root.query(
      "SELECT action FROM admin_operations WHERE action->>'targetId'=$1 AND action->>'operation'='ADMIN_ACCESS'",
      [id],
    );
    expect(adminActionSchema.parse(stored.rows[0]!.action)).toEqual(action);
    const limited = await module.service.login({
      schemaVersion: 1,
      commandId: randomUUID(),
      username: "phase_four_limited",
      password: created.generatedPassword,
    });
    for (const [kind, denied] of [
      ["games", "phase-four-beta"],
      ["rooms", roomIds[2]],
      ["matches", matchIds[2]],
    ]) {
      const search = await http(`${kind}/search?gameId=phase-four-beta&limit=1`, limited.token);
      expect(search.status).toBe(200);
      expect((search.data as { items: unknown[] }).items).toEqual([]);
      const all = await http(`${kind}/search?limit=1`, limited.token);
      expect(all.status).toBe(200);
      expect(all.text).not.toContain(denied);
      expect((await http(`${kind}/${denied}/details`, limited.token)).status).toBe(403);
      expect(
        (
          await http(
            `${kind}/${kind === "games" ? "absent-game" : randomUUID()}/details`,
            limited.token,
          )
        ).status,
      ).toBe(403);
    }
    const filteredPage = adminMatchPageSchema.parse(
      (
        await http(
          `matches/search?gameId=phase-four-page-01&playerId=${userId}&limit=50`,
          limited.token,
        )
      ).data,
    );
    expect(filteredPage.items).toHaveLength(50);
    expect(filteredPage.nextCursor).toBe(filteredPage.items[49]!.id);
    expect(
      adminMatchPageSchema.parse(
        (
          await http(
            `matches/search?gameId=phase-four-beta&playerId=${userId}&limit=50`,
            limited.token,
          )
        ).data,
      ).items,
    ).toEqual([]);
    expect((await http("admins", limited.token)).status).toBe(403);
    await root.query(
      "UPDATE admin_operators SET authorization_version=authorization_version+1,status='DISABLED' WHERE id=$1",
      [id],
    );
    expect((await http("matches/search", limited.token)).status).toBe(401);
  });
  it("reader projection grants reject secrets and writes while metadata queries work", async () => {
    const client = new Client({ connectionString: process.env.TEST_ADMIN_READER_URL! });
    await client.connect();
    try {
      for (const sql of [
        "SELECT config_jsonb FROM games",
        "SELECT invite_code FROM rooms",
        "SELECT state_jsonb FROM matches",
        "SELECT reconnect_policy_jsonb FROM matches",
        "SELECT payload_jsonb FROM game_events",
        "UPDATE matches SET state_version=state_version+1",
      ])
        await expect(client.query(sql)).rejects.toMatchObject({ code: "42501" });
      expect((await client.query("SHOW statement_timeout")).rows[0]!.statement_timeout).toBe("2s");
      await reads.forModule("matches").execute(async (db) => {
        for (const limit of [0, 51, 1.5])
          await expect(db.readAdminMatches({ limit }, null, [])).rejects.toMatchObject({
            code: "DATABASE_QUERY_INVALID",
          });
      });
    } finally {
      await client.end();
    }
  });
});

const rosterRoom = "43000000-0000-4000-8000-000000000001";
const rosterMatch = "44000000-0000-4000-8000-000000000001";
const overflowRoom = "43000000-0000-4000-8000-000000000002";
const overflowMatch = "44000000-0000-4000-8000-000000000002";
const resultOverflowMatch = "44000000-0000-4000-8000-000000000003";
const boundaryRoom = "43000000-0000-4000-8000-000000000003";
const boundaryMatch = "44000000-0000-4000-8000-000000000004";
const botActor = "45000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  await root.query(
    "INSERT INTO games(id,slug,title,min_players,max_players,status,matchmaking_enabled,private_rooms_enabled,chat_enabled,config_schema_version,config_jsonb,updated_at) VALUES('phase-four-roster','phase-four-roster','Roster',2,64,'ACTIVE',false,false,false,1,'{}',now())",
  );
  for (const id of [rosterRoom, overflowRoom, boundaryRoom])
    await root.query(
      "INSERT INTO rooms(id,game_id,host_user_id,capacity,invite_code,status,expires_at,updated_at) VALUES($1,'phase-four-roster',$2,64,$3,'WAITING','2030-01-01',now())",
      [id, userId, "HIDDEN_" + id],
    );
  for (const id of [rosterMatch, overflowMatch, resultOverflowMatch, boundaryMatch])
    await root.query(
      "INSERT INTO matches(id,game_id,match_type,status,engine_version,state_schema_version,ruleset_version,state_jsonb,updated_at) VALUES($1,'phase-four-roster','PERSONAL_BOTS_V1','FINISHED','roster-engine',3,'roster-rules','{}',now())",
      [id],
    );
  await root.query(
    "INSERT INTO room_members(room_id,user_id,seat,joined_at) VALUES($1,$2,0,'2026-01-02'),($1,$3,1,'2026-01-03')",
    [rosterRoom, userId, otherUser],
  );
  await root.query(
    "INSERT INTO match_players(match_id,user_id,seat,agent_type,connection_status,connection_epoch,ready_at,joined_at,disconnected_at,disconnect_deadline_at,replaced_at) VALUES($1,$2,0,'HUMAN','DISCONNECTED',4,'2026-01-02','2026-01-01','2026-01-03','2026-01-04',null),($1,$3,1,'BOT','REPLACED_BY_BOT',5,null,'2026-01-02','2026-01-03',null,'2026-01-04')",
    [rosterMatch, userId, otherUser],
  );
  await root.query("INSERT INTO match_bot_seats(match_id,actor_id,seat) VALUES($1,$2,2)", [
    rosterMatch,
    botActor,
  ]);
  await root.query(
    "INSERT INTO game_results(match_id,user_id,game_id,placement,winner,schema_version,metrics_jsonb) VALUES($1,$2,'phase-four-roster',1,true,1,'{\"secret\":\"HIDDEN_RESULT\"}')",
    [rosterMatch, userId],
  );
  await root.query(
    "INSERT INTO game_results(match_id,user_id,game_id,placement,winner,schema_version,metrics_jsonb) VALUES($1,$2,'phase-four-alpha',1,true,1,'{}')",
    [matchIds[0], userId],
  );
  for (const [seq, type] of [
    [1, "MATCH_INITIALIZED_V1"],
    [2, "HIDDEN_CARD_DRAWN_V1"],
    [3, "PLAYER_DISCONNECTED_V1"],
    [4, "PLAYER_RECONNECTED_V1"],
    [5, "PLAYER_BOT_TAKEOVER_V1"],
    [6, "MATCH_FINISHED_V1"],
    [7, "MATCH_FINISHED_V2"],
    [8, "MATCH_LIFECYCLE_V1"],
  ] as const)
    await root.query(
      "INSERT INTO game_events(id,match_id,seq,schema_version,type,actor_user_id,payload_jsonb,created_at) VALUES($1,$2,$3,1,$4,$5,'{\"secret\":\"HIDDEN_EVENT\"}','2026-01-03')",
      [randomUUID(), rosterMatch, seq, type, seq === 1 ? null : userId],
    );
  await root.query(
    "INSERT INTO users(id,telegram_user_id,display_name,public_handle,status,updated_at) SELECT ('46000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,950000000+n,'Synthetic','roster_'||n,'ACTIVE',now() FROM generate_series(1,65) n",
  );
  await root.query(
    "INSERT INTO room_members(room_id,user_id,seat) SELECT $1,('46000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,n-1 FROM generate_series(1,65) n",
    [overflowRoom],
  );
  await root.query(
    "INSERT INTO match_players(match_id,user_id,seat,agent_type,connection_status) SELECT $1,('46000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,n-1,'HUMAN','CONNECTED' FROM generate_series(1,65) n",
    [overflowMatch],
  );
  await root.query(
    "INSERT INTO room_members(room_id,user_id,seat) SELECT $1,('46000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,n-1 FROM generate_series(1,64) n",
    [boundaryRoom],
  );
  await root.query(
    "INSERT INTO match_players(match_id,user_id,seat,agent_type,connection_status) SELECT $1,('46000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,n-1,'HUMAN','CONNECTED' FROM generate_series(1,64) n",
    [boundaryMatch],
  );
  await root.query(
    "INSERT INTO match_players(match_id,user_id,seat,agent_type,connection_status) VALUES($1,$2,0,'HUMAN','CONNECTED')",
    [resultOverflowMatch, userId],
  );
  await root.query(
    "INSERT INTO game_results(match_id,user_id,game_id,placement,winner,schema_version,metrics_jsonb) SELECT $1,('46000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'phase-four-roster',1,true,1,'{}' FROM generate_series(1,65) n",
    [resultOverflowMatch],
  );

  await root.query(
    "INSERT INTO game_events(id,match_id,seq,schema_version,type,payload_jsonb) SELECT ('47000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,n,1,'MATCH_LIFECYCLE_V1','{}' FROM generate_series(1,51) n",
    [boundaryMatch],
  );
});
describe("phase four private roster and history metadata", () => {
  it("reads real RoomMember and MatchPlayer fields without inventing bot users or readiness", async () => {
    const room = await http(`rooms/${rosterRoom}/players`, token);
    expect(room.status).toBe(200);
    expect(adminRoomPlayersSchema.parse(room.data).items).toEqual([
      { userId, seat: 0, joinedAt: "2026-01-02T00:00:00.000Z" },
      { userId: otherUser, seat: 1, joinedAt: "2026-01-03T00:00:00.000Z" },
    ]);
    const match = await http(`matches/${rosterMatch}/players`, token);
    expect(match.status).toBe(200);
    expect(adminMatchPlayersSchema.parse(match.data).items).toEqual([
      {
        kind: "REGISTERED_PLAYER",
        userId,
        seat: 0,
        joinedAt: "2026-01-01T00:00:00.000Z",
        agentType: "HUMAN",
        connectionStatus: "DISCONNECTED",
        connectionEpoch: 4,
        readyAt: "2026-01-02T00:00:00.000Z",
        disconnectedAt: "2026-01-03T00:00:00.000Z",
        disconnectDeadlineAt: "2026-01-04T00:00:00.000Z",
        replacedAt: null,
      },
      {
        kind: "REGISTERED_PLAYER",
        userId: otherUser,
        seat: 1,
        joinedAt: "2026-01-02T00:00:00.000Z",
        agentType: "BOT",
        connectionStatus: "REPLACED_BY_BOT",
        connectionEpoch: 5,
        readyAt: null,
        disconnectedAt: "2026-01-03T00:00:00.000Z",
        disconnectDeadlineAt: null,
        replacedAt: "2026-01-04T00:00:00.000Z",
      },
      { kind: "SERVER_BOT", actorId: botActor, userId: null, seat: 2, agentType: "BOT" },
    ]);
    expect(
      adminMatchDetailSchema.parse((await http(`matches/${rosterMatch}/details`, token)).data).item
        .roomId,
    ).toBeNull();
    expect(match.text + room.text).not.toMatch(
      /HIDDEN|payload|stateJsonb|invite|telegram|displayName/,
    );
  });
  it("paginates only allowlisted event metadata by exclusive seq and shows durable registered results", async () => {
    const response = await http(`matches/${rosterMatch}/history?limit=2`, token);
    expect(response.status).toBe(200);
    const first = adminMatchHistorySchema.parse(response.data);
    expect(first.items.map((e) => [e.seq, e.type, e.actorUserId])).toEqual([
      [1, "MATCH_INITIALIZED_V1", null],
      [3, "PLAYER_DISCONNECTED_V1", userId],
    ]);
    expect(first.nextCursor).toBe(3);
    expect(first.results).toEqual([
      { userId, placement: 1, winner: true },
      { userId: otherUser, placement: null, winner: null },
    ]);
    const second = adminMatchHistorySchema.parse(
      (await http(`matches/${rosterMatch}/history?limit=2&cursor=3`, token)).data,
    );
    expect(second.items.map((e) => e.seq)).toEqual([4, 5]);
    expect(second.nextCursor).toBe(5);
    const last = adminMatchHistorySchema.parse(
      (await http(`matches/${rosterMatch}/history?cursor=5&limit=50`, token)).data,
    );
    expect(last.items.map((e) => e.seq)).toEqual([6, 7, 8]);
    expect(last.nextCursor).toBeNull();
    expect(response.text).not.toMatch(/HIDDEN|payload|metrics|stateJsonb/);
    expect(
      adminMatchHistorySchema.parse((await http(`matches/${matchIds[0]}/history`, token)).data)
        .results,
    ).toEqual([{ userId, placement: null, winner: null }]);
  });
  it("caps an actual fifty-event page before the exclusive next sequence", async () => {
    const first = adminMatchHistorySchema.parse(
      (await http(`matches/${boundaryMatch}/history?limit=50`, token)).data,
    );
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBe(50);
    const last = adminMatchHistorySchema.parse(
      (await http(`matches/${boundaryMatch}/history?limit=50&cursor=50`, token)).data,
    );
    expect(last.items.map((e) => e.seq)).toEqual([51]);
    expect(last.nextCursor).toBeNull();
  });
  it("limits the actual reader to metadata columns and denies writes in each new projection", async () => {
    const client = new Client({ connectionString: process.env.TEST_ADMIN_READER_URL! });
    await client.connect();
    try {
      expect(
        (
          await client.query(
            "SELECT user_id,seat,joined_at FROM room_members WHERE room_id=$1 ORDER BY seat",
            [rosterRoom],
          )
        ).rows,
      ).toHaveLength(2);
      expect(
        (
          await client.query("SELECT actor_id,seat FROM match_bot_seats WHERE match_id=$1", [
            rosterMatch,
          ])
        ).rows,
      ).toEqual([{ actor_id: botActor, seat: 2 }]);
      expect(
        (
          await client.query(
            "SELECT seq,schema_version,actor_user_id,created_at FROM game_events WHERE match_id=$1",
            [rosterMatch],
          )
        ).rows,
      ).toHaveLength(8);
      for (const sql of [
        "SELECT metrics_jsonb FROM game_results",
        "SELECT payload_jsonb FROM game_events",
        "SELECT state_jsonb FROM matches",
        "SELECT invite_code FROM rooms",
        "UPDATE room_members SET seat=seat",
        "UPDATE match_players SET seat=seat",
        "UPDATE match_bot_seats SET seat=seat",
        "UPDATE game_results SET winner=winner",
        "UPDATE game_events SET seq=seq",
      ])
        await expect(client.query(sql)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.end();
    }
  });
  it("intersects base and fine permissions and subtracts denials before owner reads", async () => {
    const operatorId = randomUUID();
    const created = await execute({
      operation: "ADMIN_CREATE",
      targetId: operatorId,
      expectedVersion: 0,
      username: "phase_four_roster_reader",
    });
    const allPermissions = [
      "rooms.view",
      "rooms.players.view",
      "matches.view",
      "matches.players.view",
      "matches.history.view",
    ] as const;
    const grant = (
      permission: (typeof allPermissions)[number],
      gameIds: string[] | null,
      deny = false,
    ) => ({ permission, environment: "test", gameIds, deny });
    const scenarios = [
      {
        grants: [
          grant("rooms.players.view", null),
          grant("matches.players.view", null),
          grant("matches.history.view", null),
        ],
        status: 403,
      },
      { grants: [grant("rooms.view", null), grant("matches.view", null)], status: 403 },
      {
        grants: [
          grant("rooms.view", ["phase-four-alpha"]),
          grant("rooms.players.view", ["phase-four-roster"]),
          grant("matches.view", ["phase-four-alpha"]),
          grant("matches.players.view", ["phase-four-roster"]),
          grant("matches.history.view", ["phase-four-roster"]),
        ],
        status: 403,
      },
      {
        grants: [
          grant("rooms.view", ["phase-four-alpha", "phase-four-roster"]),
          grant("rooms.players.view", ["phase-four-beta", "phase-four-roster"]),
          grant("matches.view", ["phase-four-alpha", "phase-four-roster"]),
          grant("matches.players.view", ["phase-four-beta", "phase-four-roster"]),
          grant("matches.history.view", ["phase-four-beta", "phase-four-roster"]),
        ],
        status: 200,
      },
      {
        grants: [
          ...allPermissions.map((p) => grant(p, null)),
          grant("rooms.view", ["phase-four-roster"], true),
          grant("matches.view", ["phase-four-roster"], true),
        ],
        status: 403,
      },
      {
        grants: [
          ...allPermissions.map((p) => grant(p, null)),
          grant("rooms.players.view", ["phase-four-roster"], true),
          grant("matches.players.view", ["phase-four-roster"], true),
          grant("matches.history.view", ["phase-four-roster"], true),
        ],
        status: 403,
      },
    ];
    let previousSession: string | undefined;
    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i]!;
      await execute({
        operation: "ADMIN_ACCESS",
        targetId: operatorId,
        expectedVersion: i + 1,
        roleIds: [],
        grants: scenario.grants,
      });
      if (previousSession)
        expect((await http(`matches/${rosterMatch}/history`, previousSession)).status).toBe(
          scenario.status,
        );
      const signedIn = await module.service.login({
        schemaVersion: 1,
        commandId: randomUUID(),
        username: "phase_four_roster_reader",
        password: created.generatedPassword,
      });
      previousSession = signedIn.token;
      for (const path of [
        `rooms/${rosterRoom}/players`,
        `matches/${rosterMatch}/players`,
        `matches/${rosterMatch}/history?limit=1`,
      ])
        expect((await http(path, signedIn.token)).status).toBe(scenario.status);
      for (const path of [
        `rooms/${roomIds[0]}/players`,
        `matches/${matchIds[0]}/players`,
        `matches/${matchIds[0]}/history`,
      ])
        expect((await http(path, signedIn.token)).status).toBe(
          scenario.status === 200 || i < 3 ? 403 : 200,
        );
      if (scenario.status === 200) {
        expect((await http(`matches/${matchIds[0]}/players`, signedIn.token)).status).toBe(403);
        expect((await http(`matches/${randomUUID()}/players`, signedIn.token)).status).toBe(403);
      }
    }
    token = await loginOwner();
  }, 30000);
  it("fails closed on roster/result overflow and rejects malformed or extra query input", async () => {
    expect(
      adminRoomPlayersSchema.parse((await http(`rooms/${boundaryRoom}/players`, token)).data).items,
    ).toHaveLength(64);
    expect(
      adminMatchPlayersSchema.parse((await http(`matches/${boundaryMatch}/players`, token)).data)
        .items,
    ).toHaveLength(64);
    expect(
      adminMatchHistorySchema.parse((await http(`matches/${boundaryMatch}/history`, token)).data)
        .results,
    ).toHaveLength(64);
    for (const path of [
      `rooms/${overflowRoom}/players`,
      `matches/${overflowMatch}/players`,
      `matches/${overflowMatch}/history`,
      `matches/${resultOverflowMatch}/history`,
    ])
      expect((await http(path, token)).status).toBe(503);
    for (const query of [
      "cursor=0",
      "cursor=2147483648",
      "cursor=01",
      "limit=51",
      "limit=0",
      "payload=true",
      "gameId=phase-four-alpha",
    ])
      expect((await http(`matches/${rosterMatch}/history?${query}`, token)).status).toBe(400);
    for (const resource of ["rooms", "matches"]) {
      expect((await http(`${resource}/${rosterMatch}/players?limit=1`, token)).status).toBe(400);
      expect((await http(`${resource}/${randomUUID()}/players`, token)).status).toBe(403);
      expect((await http(`${resource}/${rosterMatch}/players`)).status).toBe(401);
    }
  });
});

describe("phase four evidence-based private diagnostics", () => {
  it.each([
    ["WAITING", "2000-01-01", "SUSPECTED", "ROOM_EXPIRED"],
    ["FULL", "2000-01-01", "SUSPECTED", "ROOM_EXPIRED"],
    ["WAITING", "2099-01-01", "NO_SIGNAL", "DEADLINE_NOT_ELAPSED"],
    ["STARTING", "2000-01-01", "UNKNOWN", "NO_DURABLE_DEADLINE"],
    ["STARTED", "2000-01-01", "NO_SIGNAL", "NOT_APPLICABLE"],
    ["CLOSED", "2000-01-01", "NO_SIGNAL", "TERMINAL"],
    ["EXPIRED", "2000-01-01", "NO_SIGNAL", "TERMINAL"],
  ])(
    "diagnoses Room %s with expiry %s as %s/%s without mutation",
    async (status, expiry, state, reason) => {
      const id = randomUUID();
      await root.query(
        "INSERT INTO rooms(id,game_id,host_user_id,capacity,invite_code,status,expires_at,updated_at) VALUES($1,'phase-four-alpha',$2,2,$3,$4,$5,now())",
        [id, userId, "HIDDEN_DIAGNOSTIC_" + id, status, expiry],
      );
      const response = await http(`rooms/${id}/diagnostics`, token);
      expect(response.status).toBe(200);
      const diagnostic = adminRoomDiagnosticsSchema.parse(response.data);
      expect(diagnostic).toMatchObject({
        schemaVersion: 1,
        id,
        gameId: "phase-four-alpha",
        state,
        reason,
      });
      expect(Math.abs(Date.now() - Date.parse(diagnostic.asOf))).toBeLessThan(10000);
      expect(response.text).not.toMatch(/HIDDEN|invite|payload|stateJsonb/);
      expect(
        (await root.query("SELECT status,state_version FROM rooms WHERE id=$1", [id])).rows[0],
      ).toEqual({ status, state_version: 0 });
      if (["WAITING", "FULL"].includes(status!)) {
        const closed = await execute({ operation: "ROOM_CLOSE", targetId: id, expectedVersion: 0 });
        expect(closed.state).toBe("SUCCEEDED");
        expect((await module.management!.execute(token, closed.commandId)).state).toBe("SUCCEEDED");
        expect(
          (await root.query("SELECT status,state_version FROM rooms WHERE id=$1", [id])).rows[0],
        ).toEqual({ status: "CLOSED", state_version: 1 });
      }
      if (["STARTING", "STARTED", "CLOSED", "EXPIRED"].includes(status!)) {
        const result = await execute({ operation: "ROOM_CLOSE", targetId: id, expectedVersion: 0 });
        expect(["FAILED", "UNKNOWN"]).toContain(result.state);
        expect((await module.management!.execute(token, result.commandId)).state).toBe("FAILED");
      }
    },
    30000,
  );
  it.each([
    ["ACTIVE", "DISCONNECTED", "HUMAN", "2000-01-01", null, "SUSPECTED", "RECONNECT_OVERDUE"],
    ["ACTIVE", "DISCONNECTED", "HUMAN", "2099-01-01", null, "NO_SIGNAL", "DEADLINE_NOT_ELAPSED"],
    ["ACTIVE", "DISCONNECTED", "HUMAN", null, null, "UNKNOWN", "NO_DURABLE_DEADLINE"],
    ["ACTIVE", "CONNECTED", "HUMAN", "2000-01-01", null, "UNKNOWN", "NO_DURABLE_DEADLINE"],
    ["ACTIVE", "DISCONNECTED", "BOT", "2000-01-01", null, "UNKNOWN", "NO_DURABLE_DEADLINE"],
    [
      "ACTIVE",
      "REPLACED_BY_BOT",
      "HUMAN",
      "2000-01-01",
      "2000-01-02",
      "UNKNOWN",
      "NO_DURABLE_DEADLINE",
    ],
    [
      "ACTIVE",
      "DISCONNECTED",
      "HUMAN",
      "2000-01-01",
      "2000-01-02",
      "UNKNOWN",
      "NO_DURABLE_DEADLINE",
    ],
    ["CREATED", "DISCONNECTED", "HUMAN", "2000-01-01", null, "UNKNOWN", "NO_DURABLE_DEADLINE"],
    [
      "WAITING_FOR_PLAYERS",
      "DISCONNECTED",
      "HUMAN",
      "2000-01-01",
      null,
      "UNKNOWN",
      "NO_DURABLE_DEADLINE",
    ],
    ["READY", "DISCONNECTED", "HUMAN", "2000-01-01", null, "UNKNOWN", "NO_DURABLE_DEADLINE"],
    ["STARTING", "DISCONNECTED", "HUMAN", "2000-01-01", null, "UNKNOWN", "NO_DURABLE_DEADLINE"],
    ["FINISHED", "DISCONNECTED", "HUMAN", "2000-01-01", null, "NO_SIGNAL", "TERMINAL"],
    ["TERMINATED", "DISCONNECTED", "HUMAN", "2000-01-01", null, "NO_SIGNAL", "TERMINAL"],
  ])(
    "diagnoses Match %s/%s/%s deadline %s replaced %s as %s/%s",
    async (status, connection, agent, deadline, replaced, state, reason) => {
      const id = randomUUID();
      await root.query(
        "INSERT INTO matches(id,game_id,match_type,status,engine_version,state_schema_version,ruleset_version,state_jsonb,updated_at) VALUES($1,'phase-four-alpha','STANDARD',$2,'diagnostic-engine',1,'diagnostic-rules','{\"hidden\":true}',now())",
        [id, status],
      );
      await root.query(
        "INSERT INTO match_players(match_id,user_id,seat,agent_type,connection_status,disconnected_at,disconnect_deadline_at,replaced_at) VALUES($1,$2,0,$3,$4,'1999-12-31',$5,$6)",
        [id, userId, agent, connection, deadline, replaced],
      );
      const response = await http(`matches/${id}/diagnostics`, token);
      expect(response.status).toBe(200);
      expect(adminMatchDiagnosticsSchema.parse(response.data)).toMatchObject({
        id,
        gameId: "phase-four-alpha",
        state,
        reason,
      });
      expect(response.text).not.toMatch(/hidden|payload|stateJsonb|deadlineAt|userId/);
      expect(
        (
          await root.query("SELECT status,state_version,last_event_seq FROM matches WHERE id=$1", [
            id,
          ])
        ).rows[0],
      ).toEqual({ status, state_version: 0, last_event_seq: 0 });
      if (["FINISHED", "TERMINATED"].includes(status!)) {
        const result = await execute({
          operation: "MATCH_TERMINATE",
          targetId: id,
          expectedVersion: 0,
        });
        expect(["FAILED", "UNKNOWN"]).toContain(result.state);
        expect((await module.management!.execute(token, result.commandId)).state).toBe("FAILED");
        expect(
          (
            await root.query(
              "SELECT status,state_version,last_event_seq FROM matches WHERE id=$1",
              [id],
            )
          ).rows[0],
        ).toEqual({ status, state_version: 0, last_event_seq: 0 });
      }
    },
    30000,
  );
  it("keeps absent or incomplete live deadlines unknown and fails closed on eligible roster overflow", async () => {
    const id = randomUUID();
    await root.query(
      "INSERT INTO matches(id,game_id,match_type,status,engine_version,state_schema_version,ruleset_version,state_jsonb,updated_at) VALUES($1,'phase-four-alpha','STANDARD','ACTIVE','diagnostic-engine',1,'diagnostic-rules','{}',now())",
      [id],
    );
    const diagnostic = async () =>
      adminMatchDiagnosticsSchema.parse((await http(`matches/${id}/diagnostics`, token)).data);
    expect(await diagnostic()).toMatchObject({ state: "UNKNOWN", reason: "NO_DURABLE_DEADLINE" });
    await root.query(
      "INSERT INTO match_players(match_id,user_id,seat,agent_type,connection_status,disconnect_deadline_at) VALUES($1,$2,0,'HUMAN','DISCONNECTED','2099-01-01'),($1,$3,1,'HUMAN','DISCONNECTED',null)",
      [id, userId, otherUser],
    );
    expect(await diagnostic()).toMatchObject({ state: "UNKNOWN", reason: "NO_DURABLE_DEADLINE" });
    await root.query(
      "UPDATE match_players SET disconnect_deadline_at='2000-01-01' WHERE match_id=$1 AND user_id=$2",
      [id, userId],
    );
    expect(await diagnostic()).toMatchObject({ state: "SUSPECTED", reason: "RECONNECT_OVERDUE" });
    const bounded = randomUUID();
    await root.query(
      "INSERT INTO matches(id,game_id,match_type,status,engine_version,state_schema_version,ruleset_version,state_jsonb,updated_at) VALUES($1,'phase-four-alpha','STANDARD','ACTIVE','diagnostic-engine',1,'diagnostic-rules','{}',now())",
      [bounded],
    );
    await root.query(
      "INSERT INTO match_players(match_id,user_id,seat,agent_type,connection_status,disconnect_deadline_at) SELECT $1,('46000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,n-1,'HUMAN','DISCONNECTED','2099-01-01'::timestamptz FROM generate_series(1,64) n",
      [bounded],
    );
    expect(
      adminMatchDiagnosticsSchema.parse((await http(`matches/${bounded}/diagnostics`, token)).data),
    ).toMatchObject({ state: "NO_SIGNAL", reason: "DEADLINE_NOT_ELAPSED" });
    await root.query(
      "INSERT INTO match_players(match_id,user_id,seat,agent_type,connection_status,disconnect_deadline_at) VALUES($1,'46000000-0000-4000-8000-000000000065',64,'HUMAN','DISCONNECTED','2099-01-01')",
      [bounded],
    );
    expect((await http(`matches/${bounded}/diagnostics`, token)).status).toBe(503);
  });
  it("intersects diagnostic and resource grants, applies denies, and rejects extra query or pending sessions", async () => {
    const operatorId = randomUUID();
    const created = await execute({
      operation: "ADMIN_CREATE",
      targetId: operatorId,
      expectedVersion: 0,
      username: "phase_four_diagnostics",
    });
    const permissions = [
      "rooms.view",
      "rooms.diagnostics.view",
      "matches.view",
      "matches.diagnostics.view",
    ] as const;
    const grant = (
      permission: (typeof permissions)[number],
      gameIds: string[] | null,
      deny = false,
    ) => ({ permission, gameIds, deny, environment: "test" });
    const scenarios = [
      {
        grants: permissions
          .filter((p) => p.endsWith("diagnostics.view"))
          .map((p) => grant(p, null)),
        alpha: 403,
        beta: 403,
      },
      { grants: [grant("rooms.view", null), grant("matches.view", null)], alpha: 403, beta: 403 },
      {
        grants: permissions.map((p) =>
          grant(p, p.endsWith("diagnostics.view") ? ["phase-four-beta"] : ["phase-four-alpha"]),
        ),
        alpha: 403,
        beta: 403,
      },
      {
        grants: permissions.map((p) =>
          grant(
            p,
            p.endsWith("diagnostics.view")
              ? ["phase-four-alpha", "phase-four-roster"]
              : ["phase-four-alpha", "phase-four-beta"],
          ),
        ),
        alpha: 200,
        beta: 403,
      },
      {
        grants: [
          ...permissions.map((p) => grant(p, null)),
          grant("rooms.view", ["phase-four-alpha"], true),
          grant("matches.view", ["phase-four-alpha"], true),
        ],
        alpha: 403,
        beta: 200,
      },
      {
        grants: [
          ...permissions.map((p) => grant(p, null)),
          grant("rooms.diagnostics.view", ["phase-four-alpha"], true),
          grant("matches.diagnostics.view", ["phase-four-alpha"], true),
        ],
        alpha: 403,
        beta: 200,
      },
      {
        grants: [
          ...permissions.map((p) => grant(p, null)),
          grant("rooms.diagnostics.view", null, true),
          grant("matches.diagnostics.view", null, true),
        ],
        alpha: 403,
        beta: 403,
      },
    ];
    let previousSession: string | undefined;
    for (const [i, scenario] of scenarios.entries()) {
      await execute({
        operation: "ADMIN_ACCESS",
        targetId: operatorId,
        expectedVersion: i + 1,
        roleIds: [],
        grants: scenario.grants,
      });
      if (previousSession)
        expect((await http(`matches/${matchIds[0]}/diagnostics`, previousSession)).status).toBe(
          scenario.alpha,
        );
      previousSession = (
        await module.service.login({
          schemaVersion: 1,
          commandId: randomUUID(),
          username: "phase_four_diagnostics",
          password: created.generatedPassword,
        })
      ).token;
      for (const [resource, ids] of [
        ["rooms", roomIds],
        ["matches", matchIds],
      ] as const) {
        expect((await http(`${resource}/${ids[0]}/diagnostics`, previousSession)).status).toBe(
          scenario.alpha,
        );
        expect((await http(`${resource}/${ids[2]}/diagnostics`, previousSession)).status).toBe(
          scenario.beta,
        );
      }
    }
    token = await loginOwner();
    const pending = await module.service.login({
      schemaVersion: 1,
      commandId: randomUUID(),
      username,
      password,
    });
    for (const [resource, id] of [
      ["rooms", roomIds[0]],
      ["matches", matchIds[0]],
    ]) {
      expect((await http(`${resource}/${id}/diagnostics`)).status).toBe(401);
      expect((await http(`${resource}/${id}/diagnostics`, pending.token)).status).toBe(401);
      expect((await http(`${resource}/${id}/diagnostics?limit=1`, token)).status).toBe(400);
      expect((await http(`${resource}/${randomUUID()}/diagnostics`, token)).status).toBe(403);
      expect((await http(`${resource}/not-a-uuid/diagnostics`, token)).status).toBe(400);
      expect(
        (await http(`${resource}/${id}/diagnostics`, token, { repair: true }, crypto.csrf(token)))
          .status,
      ).toBe(404);
    }
  }, 30000);
});
