import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as validation from "../src/index.js";

const id = "a9659a20-93bb-4b86-a7bc-fc64600da8f6";
const asOf = "2026-11-04T10:00:00.000Z";
const metadata = { schemaVersion: 1, asOf };
const room = {
  id,
  gameId: "coup",
  status: "WAITING",
  version: 0,
  capacity: 6,
  hostUserId: id,
  createdAt: asOf,
  updatedAt: asOf,
  expiresAt: asOf,
  startedMatchId: null,
};
const match = {
  id,
  gameId: "coup",
  roomId: null,
  matchType: "PERSONAL_BOTS_V1",
  status: "ACTIVE",
  version: 0,
  lastEventSeq: 0,
  createdAt: asOf,
  updatedAt: asOf,
  startedAt: null,
  finishedAt: null,
  pins: { engineVersion: "1.0.0", stateSchemaVersion: 1, rulesetVersion: "standard-v1" },
};
const game = {
  id: "coup",
  slug: "coup",
  title: "Coup",
  releaseStatus: "ACTIVE",
  admissionStatus: "DISABLED",
  version: 1,
};
// Missing strict schemas or a permissive replacement must fail at the public boundary.
function schema(name: string) {
  const found = (validation as unknown as Record<string, z.ZodType>)[name];
  expect(found, `public schema ${name}`).toBeDefined();
  return found!;
}

describe("Admin game management queries", () => {
  it.each(["Game", "Room", "Match"])(
    "bounds %s pagination and rejects unknown scope input",
    (resource) => {
      const query = schema(`admin${resource}SearchQuerySchema`);
      expect(query.parse({ limit: "50" })).toEqual({ limit: 50 });
      expect(query.parse({})).toEqual({});
      for (const value of ["0", "51", "01", "1.5", "1e1", "", 2, ["2"]])
        expect(query.safeParse({ limit: value }).success).toBe(false);
      for (const key of ["environment", "excluded", "stateJsonb", "offset"])
        expect(query.safeParse({ [key]: "synthetic" }).success).toBe(false);
      expect(query.safeParse({ cursor: "not an id" }).success).toBe(false);
      expect(query.safeParse({ status: "invented" }).success).toBe(false);
      expect(query.safeParse({ gameId: "bad/game" }).success).toBe(false);
    },
  );

  it("accepts bounded game search while rejecting room and player filters", () => {
    const query = schema("adminGameSearchQuerySchema");
    expect(
      query.parse({ search: "  Coup  ", cursor: "coup", status: "MAINTENANCE", gameId: "coup" }),
    ).toEqual({ search: "Coup", cursor: "coup", status: "MAINTENANCE", gameId: "coup" });
    for (const value of [" ", "x".repeat(65), "x\u0000y", "x\ny"])
      expect(query.safeParse({ search: value }).success).toBe(false);
    expect(query.safeParse({ createdFrom: asOf }).success).toBe(false);
    expect(query.safeParse({ playerId: id }).success).toBe(false);
  });

  it.each(["Room", "Match"])(
    "validates exact %s searches and chronological date ranges",
    (resource) => {
      const query = schema(`admin${resource}SearchQuerySchema`);
      expect(
        query.parse({ search: id, gameId: "coup", cursor: id, createdFrom: asOf, createdTo: asOf }),
      ).toEqual({ search: id, gameId: "coup", cursor: id, createdFrom: asOf, createdTo: asOf });
      expect(query.safeParse({ search: "coup" }).success).toBe(true);
      for (const value of ["a9659a20%", "*", "%", "not an id", "x".repeat(65)])
        expect(query.safeParse({ search: value }).success).toBe(false);
      for (const value of ["2026-11-04", "2026-02-30T00:00:00Z", "tomorrow"])
        expect(query.safeParse({ createdFrom: value }).success).toBe(false);
      expect(
        query.safeParse({ createdFrom: "2026-11-05T00:00:00Z", createdTo: asOf }).success,
      ).toBe(false);
    },
  );

  it("permits the player filter only for Match UUIDs", () => {
    expect(schema("adminMatchSearchQuerySchema").parse({ playerId: id })).toEqual({ playerId: id });
    expect(schema("adminMatchSearchQuerySchema").safeParse({ playerId: "coup" }).success).toBe(
      false,
    );
    expect(schema("adminRoomSearchQuerySchema").safeParse({ playerId: id }).success).toBe(false);
  });

  it("documents the same positive int32 history cursor range that runtime accepts", () => {
    const query = validation.adminMatchHistoryQuerySchema;
    const document = z.toJSONSchema(query, { io: "input" });
    const cursor = document.properties!.cursor as { pattern: string };
    const pattern = new RegExp(cursor.pattern);
    for (const value of [
      "1",
      "9",
      "10",
      "999999999",
      "1000000000",
      "1999999999",
      "2000000000",
      "2099999999",
      "2100000000",
      "2139999999",
      "2140000000",
      "2146999999",
      "2147000000",
      "2147399999",
      "2147400000",
      "2147479999",
      "2147480000",
      "2147482999",
      "2147483000",
      "2147483599",
      "2147483600",
      "2147483639",
      "2147483640",
      "2147483647",
      "2147483648",
      "2147483649",
      "2147483650",
      "2147483700",
      "2147484000",
      "2147490000",
      "2147500000",
      "2148000000",
      "2150000000",
      "2200000000",
      "3000000000",
      "9999999999",
      "10000000000",
      "0",
      "01",
      "-1",
      "1.0",
      "1e1",
      "",
      " 1",
      "1 ",
    ]) {
      const accepted = /^[1-9][0-9]*$/.test(value) && Number(value) <= 2147483647;
      expect(query.safeParse({ cursor: value }).success, value).toBe(accepted);
      expect(pattern.test(value), `documented cursor ${value}`).toBe(accepted);
    }
  });

  it("uses bounded positive event sequences rather than resource cursors for history", () => {
    const query = schema("adminMatchHistoryQuerySchema");
    expect(query.parse({ cursor: "2147483647", limit: "50" })).toEqual({
      cursor: 2147483647,
      limit: 50,
    });
    for (const cursor of ["0", "-1", "01", "2147483648", id, 1])
      expect(query.safeParse({ cursor }).success).toBe(false);
    expect(query.safeParse({ playerId: id }).success).toBe(false);
  });
});

describe("strict allowlisted Admin resource projections", () => {
  it.each([
    ["Game", game],
    ["Room", room],
    ["Match", match],
  ] as const)("bounds %s pages and keeps sensitive data out of rows", (resource, row) => {
    const page = schema(`admin${resource}PageSchema`);
    expect(page.parse({ ...metadata, items: [row], nextCursor: null })).toEqual({
      ...metadata,
      items: [row],
      nextCursor: null,
    });
    expect(
      page.safeParse({ ...metadata, items: Array(51).fill(row), nextCursor: null }).success,
    ).toBe(false);
    for (const key of ["stateJsonb", "configJsonb", "inviteCode", "payloadJsonb", "token", "cards"])
      expect(
        page.safeParse({ ...metadata, items: [{ ...row, [key]: "secret" }], nextCursor: null })
          .success,
      ).toBe(false);
    expect(
      page.safeParse({ ...metadata, items: [row], nextCursor: "invalid cursor" }).success,
    ).toBe(false);
  });

  it("keeps nullable Match rooms and mandatory real version pins", () => {
    const detail = schema("adminMatchDetailSchema");
    expect(detail.parse({ ...metadata, item: match })).toEqual({ ...metadata, item: match });
    for (const changes of [
      { roomId: "coup" },
      { pins: null },
      { pins: { ...match.pins, seed: "secret" } },
      { pins: { ...match.pins, engineVersion: "" } },
    ])
      expect(detail.safeParse({ ...metadata, item: { ...match, ...changes } }).success).toBe(false);
  });

  it("separates game release from admission and permits unavailable installed-version evidence", () => {
    const detail = schema("adminGameDetailSchema");
    const item = {
      ...game,
      minPlayers: 2,
      maxPlayers: 6,
      matchmakingEnabled: false,
      privateRoomsEnabled: true,
      chatEnabled: true,
      voiceEnabled: false,
      configSchemaVersion: 1,
      installedVersions: null,
    };
    expect(detail.parse({ ...metadata, item })).toEqual({ ...metadata, item });
    expect(
      detail.safeParse({ ...metadata, item: { ...item, installedVersions: [match.pins] } }).success,
    ).toBe(true);
    expect(detail.safeParse({ ...metadata, item: { ...item, maxPlayers: 1 } }).success).toBe(false);
    expect(detail.safeParse({ ...metadata, item: { ...item, configJsonb: {} } }).success).toBe(
      false,
    );
  });

  it("validates Room details without accepting invitation material", () => {
    const detail = schema("adminRoomDetailSchema");
    expect(detail.parse({ ...metadata, item: room })).toEqual({ ...metadata, item: room });
    expect(detail.safeParse({ ...metadata, item: { ...room, inviteCode: "secret" } }).success).toBe(
      false,
    );
    expect(detail.safeParse({ ...metadata, item: { ...room, capacity: 65 } }).success).toBe(false);
    expect(detail.safeParse({ ...metadata, item: { ...room, status: "ACTIVE" } }).success).toBe(
      false,
    );
  });

  it("does not manufacture Room readiness or connection fields and rejects roster overflow", () => {
    const roster = schema("adminRoomPlayersSchema");
    const player = { userId: id, seat: 0, joinedAt: asOf };
    const value = { ...metadata, roomId: id, items: [player] };
    expect(roster.parse(value)).toEqual(value);
    expect(roster.safeParse({ ...value, items: Array(65).fill(player) }).success).toBe(false);
    for (const changes of [
      { readyAt: null },
      { connectionStatus: "CONNECTED" },
      { agentType: "HUMAN" },
      { seat: 64 },
      { userId: "bad" },
    ])
      expect(roster.safeParse({ ...value, items: [{ ...player, ...changes }] }).success).toBe(
        false,
      );
  });

  it("represents pending Match readiness with durable nullable metadata", () => {
    const roster = schema("adminMatchPlayersSchema");
    const player = {
      kind: "REGISTERED_PLAYER",
      userId: id,
      seat: 0,
      agentType: "HUMAN",
      connectionStatus: "DISCONNECTED",
      connectionEpoch: 1,
      readyAt: null,
      joinedAt: asOf,
      disconnectedAt: asOf,
      disconnectDeadlineAt: null,
      replacedAt: null,
    };
    const value = { ...metadata, matchId: id, items: [player] };
    expect(roster.parse(value)).toEqual(value);
    expect(roster.safeParse({ ...value, items: Array(65).fill(player) }).success).toBe(false);
    expect(
      roster.safeParse({ ...value, items: [{ ...player, connectionStatus: "HEALTHY" }] }).success,
    ).toBe(false);
    expect(roster.safeParse({ ...value, items: [{ ...player, cards: ["Duke"] }] }).success).toBe(
      false,
    );
  });

  it("represents a personal server bot without fabricating User or connection metadata", () => {
    const roster = schema("adminMatchPlayersSchema");
    const bot = { kind: "SERVER_BOT", actorId: id, userId: null, seat: 1, agentType: "BOT" };
    const value = { ...metadata, matchId: id, items: [bot] };
    expect(roster.parse(value)).toEqual(value);
    for (const changes of [
      { connectionStatus: "CONNECTED" },
      { readyAt: null },
      { joinedAt: asOf },
      { userId: id },
    ])
      expect(roster.safeParse({ ...value, items: [{ ...bot, ...changes }] }).success).toBe(false);
  });

  it("only accepts allowlisted event metadata and registered placement/winner results", () => {
    const history = schema("adminMatchHistorySchema");
    const event = {
      id,
      seq: 1,
      schemaVersion: 1,
      type: "PLAYER_DISCONNECTED_V1",
      actorUserId: id,
      createdAt: asOf,
    };
    const value = {
      ...metadata,
      matchId: id,
      items: [event],
      nextCursor: 1,
      results: [{ userId: id, placement: 1, winner: true }],
    };
    expect(history.parse(value)).toEqual(value);
    for (const changes of [{ payloadJsonb: {} }, { type: "COUP_ACTION_V1" }, { seq: 0 }])
      expect(history.safeParse({ ...value, items: [{ ...event, ...changes }] }).success).toBe(
        false,
      );
    expect(
      history.safeParse({
        ...value,
        results: [{ userId: id, placement: 1, winner: true, role: "Duke" }],
      }).success,
    ).toBe(false);
    expect(history.safeParse({ ...value, items: Array(51).fill(event) }).success).toBe(false);
    expect(history.safeParse({ ...value, results: Array(65).fill(value.results[0]) }).success).toBe(
      false,
    );
  });

  it.each(["Room", "Match"])("keeps %s diagnostics strict and explicitly uncertain", (resource) => {
    const diagnostic = schema(`admin${resource}DiagnosticsSchema`);
    const value = {
      ...metadata,
      id,
      gameId: "coup",
      state: "UNKNOWN",
      reason: "NO_DURABLE_DEADLINE",
    };
    expect(diagnostic.parse(value)).toEqual(value);
    expect(diagnostic.safeParse({ ...value, state: "HEALTHY" }).success).toBe(false);
    expect(diagnostic.safeParse({ ...value, reason: "made-up" }).success).toBe(false);
    expect(diagnostic.safeParse({ ...value, reconnectPolicyJsonb: {} }).success).toBe(false);
  });

  it("leaves the legacy resource row strict", () => {
    const row = { id, label: "Coup", status: "WAITING", gameId: "coup", version: 0 };
    expect(validation.adminRowSchema.safeParse({ ...row, capacity: 6 }).success).toBe(false);
    expect(
      validation.adminPageSchema.safeParse({
        ...metadata,
        items: [row],
        nextCursor: null,
        total: 1,
      }).success,
    ).toBe(false);
  });

  it.each([
    "rooms.players.view",
    "rooms.diagnostics.view",
    "matches.players.view",
    "matches.history.view",
    "matches.diagnostics.view",
  ])(
    "parses grants and historical actions with the explicitly registered permission %s",
    (permission) => {
      const grant = { permission, environment: "local", gameIds: ["coup"], deny: false };
      expect(validation.adminGrantSchema.safeParse(grant).success).toBe(true);
      expect(
        validation.adminActionSchema.safeParse({
          operation: "ROLE_SAVE",
          targetId: id,
          expectedVersion: 1,
          expectedMemberCount: 0,
          name: "Support",
          grants: [grant],
        }).success,
      ).toBe(true);
      expect(
        validation.adminActionSchema.safeParse({
          operation: "ADMIN_ACCESS",
          targetId: id,
          expectedVersion: 1,
          roleIds: [],
          grants: [grant],
        }).success,
      ).toBe(true);
    },
  );

  it("retains old grant vocabulary while rejecting unregistered capabilities", () => {
    expect(validation.adminPermissionSchema.safeParse("rooms.view").success).toBe(true);
    expect(validation.adminPermissionSchema.safeParse("rooms.repair").success).toBe(false);
  });

  it("extends the existing grant parser with only the five approved capabilities", () => {
    const previous = [
      "overview.view",
      "users.view",
      "users.edit",
      "users.manage",
      "users.approve",
      "users.history.view",
      "users.restrictions.view",
      "users.restrictions.manage",
      "users.restrictions.approve",
      "users.restrictions.notes.view",
      "games.view",
      "games.manage",
      "games.approve",
      "rooms.view",
      "rooms.manage",
      "rooms.approve",
      "matches.view",
      "matches.manage",
      "matches.approve",
      "monitoring.view",
      "audit.view",
      "admins.view",
      "admins.create",
      "admins.edit",
      "admins.manage",
      "roles.view",
      "roles.create",
      "roles.edit",
      "roles.manage",
    ];
    for (const permission of previous)
      expect(validation.adminPermissionSchema.safeParse(permission).success).toBe(true);
    expect(validation.adminPermissionSchema.options.filter((p) => !previous.includes(p))).toEqual([
      "rooms.players.view",
      "rooms.diagnostics.view",
      "matches.players.view",
      "matches.history.view",
      "matches.diagnostics.view",
    ]);
  });
});

// Older durable rows predate the current producers; metadata must preserve their type.
describe("persisted Match type compatibility", () => {
  it.each(["STANDARD", "PRIVATE", "PRIVATE_ROOM", "MATCHMAKING", "PERSONAL_BOTS_V1"])(
    "preserves %s without relabeling",
    (matchType) => {
      expect(validation.adminMatchRowSchema.parse({ ...match, matchType }).matchType).toBe(
        matchType,
      );
    },
  );
});

describe("bounded Match type metadata", () => {
  it.each(["", "x".repeat(65)])("rejects empty or oversized persisted type", (matchType) => {
    expect(validation.adminMatchRowSchema.safeParse({ ...match, matchType }).success).toBe(false);
  });
});
