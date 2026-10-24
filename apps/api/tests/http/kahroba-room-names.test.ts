import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { createErrorEnvelope } from "@hambazi/contracts";
import { ownerAdmissionPolicy } from "../../src/auth/application/owner-admission.js";
import { createKahrobaHttpModule } from "../../src/composition/kahroba-http.js";

const owner = "11111111-1111-4111-8111-111111111111",
  tester = "22222222-2222-4222-8222-222222222222",
  outsider = "33333333-3333-4333-8333-333333333333",
  id = "77777777-7777-4777-8777-777777777777";
let app: NestFastifyApplication,
  allowed = true,
  member = true,
  gameId = "kahroba",
  startedMatchId: string | null = null;
const find = vi.fn(async (ids: readonly string[]) =>
  ids.map((userId) => ({
    userId,
    displayName: userId === owner ? "مالک آزمایشی" : "حساب دوم آزمایشی",
  })),
);
const read = vi.fn(async () =>
  member
    ? {
        ok: true as const,
        schemaVersion: 1 as const,
        room: {
          id,
          gameId,
          hostUserId: owner,
          capacity: 2,
          version: 3,
          status: "FULL" as const,
          expiresAt: 2000,
          startedMatchId,
          members: [owner, tester].map((userId, seat) => ({
            userId,
            seat,
            joinedAt: 1000,
            joinedVersion: 1,
          })),
        },
      }
    : createErrorEnvelope("NOT_FOUND"),
);
const readiness = vi.fn(async () => ({
  ok: true as const,
  value: {
    schemaVersion: 1 as const,
    roomId: id,
    matchId: startedMatchId,
    stateVersion: null,
    status: null,
    canStart: false,
    players: [],
  },
}));
const begin = vi.fn(async (userId: unknown) =>
  userId === owner
    ? {
        ok: true as const,
        value: {
          schemaVersion: 1 as const,
          matchId: id,
          actionId: id,
          stateVersion: 4,
          lastEventSeq: 4,
          status: "STARTING" as const,
        },
      }
    : createErrorEnvelope("FORBIDDEN"),
);
function publicValue() {
  return {
    schemaVersion: 1 as const,
    matchId: id,
    gameId,
    stateVersion: 3,
    status: "WAITING_FOR_PLAYERS" as const,
    hostUserId: owner,
    players: [
      { userId: owner, seat: 0, ready: true },
      { userId: tester, seat: 1, ready: false },
    ],
  };
}
const publicRead = vi.fn(async () =>
  member ? { ok: true as const, value: publicValue() } : createErrorEnvelope("NOT_FOUND"),
);
const publicCurrent = vi.fn(async () => ({ ok: true as const, value: null }));
const publicBegin = vi.fn(async (userId: unknown) =>
  userId === owner ? { ok: true as const, value: publicValue() } : createErrorEnvelope("FORBIDDEN"),
);
beforeAll(async () => {
  const module = createKahrobaHttpModule({
    sessions: {
      authenticate: async (token) => ({
        ok: true,
        session: {
          schemaVersion: 1 as const,
          sessionId: id,
          userId: token === "a.b.c" ? owner : token === "d.e.f" ? tester : outsider,
          expiresAt: 9999999999,
        },
      }),
    },
    admission: ownerAdmissionPolicy({
      readOwner: async () => "101",
      readTestUser: async () => "102",
      users: {
        findActiveByTelegramId: async (id) =>
          id === "101" ? { userId: owner } : id === "102" ? { userId: tester } : undefined,
        findActiveById: async () => undefined,
      },
    }),
    config: {
      profile: "restricted-staging-v1",
      local: false,
      maxPlayers: 4,
      registered: true,
      enabled: true,
      routes: true,
      admission: true,
      namespace: "synthetic",
      reconnect: { schemaVersion: 1 as const, leaseMs: 30000, graceMs: 30000, maxConnections: 4 },
    },
    resync: {
      snapshot: async () => createErrorEnvelope("NOT_FOUND"),
      catchup: async () => createErrorEnvelope("NOT_FOUND"),
    },
    names: { find },
    canCreate: async (userId) => userId === owner,
    privateRooms: { readiness, begin, cancel: begin },
    publicLobby: {
      read: publicRead,
      current: publicCurrent,
      begin: publicBegin,
      cancel: publicBegin,
    },
    rooms: {
      read,
      current: async () => ({ ok: true as const, schemaVersion: 1 as const, room: null }),
    },
    rate: async () => ({ allowed }),
  });
  app = await NestFactory.create<NestFastifyApplication>(module, new FastifyAdapter(), {
    logger: false,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => app.close());
beforeEach(() => {
  allowed = true;
  member = true;
  gameId = "kahroba";
  startedMatchId = null;
  readiness.mockClear();
  begin.mockClear();
  find.mockClear();
  read.mockClear();
  publicRead.mockClear();
  publicCurrent.mockClear();
  publicBegin.mockClear();
});
it.each([undefined, "Bearer bad", "Bearer g.h.i"])(
  "denies anonymous, malformed and non-admitted roster access %s",
  async (authorization) => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/kahroba/rooms/${id}/players`,
      headers: authorization ? { authorization } : {},
    });
    expect(r.statusCode).toBe(401);
    expect(find).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  },
);
it.each(["a.b.c", "d.e.f"])(
  "reads only current room member names for an admitted member %s",
  async (token) => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/kahroba/rooms/${id}/players?userId=${outsider}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      schemaVersion: 1 as const,
      players: [
        { userId: owner, displayName: "مالک آزمایشی" },
        { userId: tester, displayName: "حساب دوم آزمایشی" },
      ],
    });
    expect(find).toHaveBeenCalledWith([owner, tester]);
  },
);
it("does not query names after membership, game, input or rate denial", async () => {
  for (const mode of ["membership", "game", "input", "rate"]) {
    member = mode !== "membership";
    gameId = mode === "game" ? "coup" : "kahroba";
    allowed = mode !== "rate";
    const r = await app.inject({
      method: "GET",
      url: `/v1/kahroba/rooms/${mode === "input" ? "invalid" : id}/players`,
      headers: { authorization: "Bearer a.b.c" },
    });
    expect(r.statusCode).toBe(mode === "rate" ? 429 : mode === "input" ? 400 : 404);
    expect(find).not.toHaveBeenCalled();
  }
});

it.each([undefined, "Bearer bad", "Bearer g.h.i"])(
  "protects every new lobby operation against missing/non-admitted identity %s",
  async (authorization) => {
    for (const [method, url] of [
      ["GET", "/v1/kahroba/lobby-permissions"],
      ["GET", "/v1/kahroba/current-room"],
      ["GET", "/v1/kahroba/matchmaking/current"],
      ["GET", `/v1/kahroba/matches/${id}/lobby`],
      ["POST", `/v1/kahroba/matches/${id}/start`],
      ["POST", `/v1/kahroba/matches/${id}/cancel`],
      ["POST", `/v1/kahroba/rooms/${id}/cancel`],
      ["GET", `/v1/kahroba/rooms/${id}/readiness`],
      ["POST", `/v1/kahroba/rooms/${id}/start`],
    ] as const) {
      const r = await app.inject({
        method,
        url,
        headers: authorization ? { authorization } : {},
        ...(method === "POST"
          ? {
              payload: { schemaVersion: 1 as const, matchId: id, actionId: id, expectedVersion: 3 },
            }
          : {}),
      });
      expect(r.statusCode).toBe(401);
    }
    expect(readiness).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
  },
);
it("offers creation only to the admitted owner and retains tester admission", async () => {
  for (const [token, canCreate] of [
    ["a.b.c", true],
    ["d.e.f", false],
  ] as const) {
    const r = await app.inject({
      method: "GET",
      url: "/v1/kahroba/lobby-permissions",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ schemaVersion: 1 as const, canCreate });
  }
});
it("does not expose readiness for nonmembers, other games, invalid paths or rate denial", async () => {
  for (const mode of ["membership", "game", "input", "rate"]) {
    member = mode !== "membership";
    gameId = mode === "game" ? "coup" : "kahroba";
    allowed = mode !== "rate";
    const r = await app.inject({
      method: "GET",
      url: `/v1/kahroba/rooms/${mode === "input" ? "invalid" : id}/readiness`,
      headers: { authorization: "Bearer a.b.c" },
    });
    expect(r.statusCode).toBe(mode === "rate" ? 429 : mode === "input" ? 400 : 404);
    expect(readiness).not.toHaveBeenCalled();
  }
});
it("passes authenticated member readiness through its owning port and rejects unbound starts", async () => {
  const headers = { authorization: "Bearer a.b.c" };
  const r = await app.inject({ method: "GET", url: `/v1/kahroba/rooms/${id}/readiness`, headers });
  expect(r.statusCode).toBe(200);
  expect(readiness).toHaveBeenCalledWith(owner, id);
  const input = { schemaVersion: 1 as const, matchId: id, actionId: id, expectedVersion: 3 };
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/v1/kahroba/rooms/${id}/start`,
        headers,
        payload: input,
      })
    ).statusCode,
  ).toBe(400);
  startedMatchId = id;
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/v1/kahroba/rooms/${id}/start`,
        headers,
        payload: input,
      })
    ).statusCode,
  ).toBe(200);
  expect(begin).toHaveBeenCalledWith(owner, input);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/v1/kahroba/rooms/${id}/start`,
        headers: { authorization: "Bearer d.e.f" },
        payload: input,
      })
    ).statusCode,
  ).toBe(403);
});

it("returns a real nullable current-room response without requiring a player-supplied UUID", async () => {
  const r = await app.inject({
    method: "GET",
    url: "/v1/kahroba/current-room",
    headers: { authorization: "Bearer d.e.f" },
  });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ ok: true, schemaVersion: 1, room: null });
});

it("uses authenticated actor identity for search recovery and public host commands", async () => {
  const headers = { authorization: "Bearer a.b.c" };
  expect(
    (
      await app.inject({
        method: "GET",
        url: "/v1/kahroba/matchmaking/current?userId=" + outsider,
        headers,
      })
    ).json(),
  ).toEqual({ ok: true, value: null });
  expect(publicCurrent).toHaveBeenCalledWith(owner);
  const input = { schemaVersion: 1, matchId: id, actionId: id, expectedVersion: 3 };
  for (const operation of ["start", "cancel"]) {
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/kahroba/matches/${id}/${operation}`,
          headers,
          payload: input,
        })
      ).statusCode,
    ).toBe(200);
    expect(publicBegin).toHaveBeenLastCalledWith(owner, input);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/kahroba/matches/${id}/${operation}`,
          headers: { authorization: "Bearer d.e.f" },
          payload: input,
        })
      ).statusCode,
    ).toBe(403);
  }
});
it("denies public starts for a foreign game, missing membership, malformed paths or mismatched bound match", async () => {
  for (const mode of ["game", "membership", "path", "binding"]) {
    gameId = mode === "game" ? "coup" : "kahroba";
    member = mode !== "membership";
    const r = await app.inject({
      method: "POST",
      url: `/v1/kahroba/matches/${mode === "path" ? "invalid" : id}/start`,
      headers: { authorization: "Bearer a.b.c" },
      payload: {
        schemaVersion: 1,
        matchId: mode === "binding" ? tester : id,
        actionId: id,
        expectedVersion: 3,
      },
    });
    expect(r.statusCode).toBe(["path", "binding"].includes(mode) ? 400 : 404);
    expect(publicBegin).not.toHaveBeenCalled();
  }
});
it("rate limits the new public surfaces before invoking a projection", async () => {
  allowed = false;
  for (const path of ["/v1/kahroba/matchmaking/current", `/v1/kahroba/matches/${id}/lobby`])
    expect(
      (await app.inject({ method: "GET", url: path, headers: { authorization: "Bearer a.b.c" } }))
        .statusCode,
    ).toBe(429);
  expect(publicRead).not.toHaveBeenCalled();
  expect(publicCurrent).not.toHaveBeenCalled();
});
