import { request as httpsRequest } from "node:https";
import { randomUUID, randomBytes, randomInt } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
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
} from "@hambazi/validation";
import type {
  AdminAction,
  AdminGameSearchQuery,
  AdminRoomSearchQuery,
  AdminMatchSearchQuery,
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
    expect(
      adminGamePageSchema
        .parse((await http("games/search?search=%25&limit=50", token)).data)
        .items.every((r) => r.title === "literal_%_page"),
    ).toBe(true);
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
