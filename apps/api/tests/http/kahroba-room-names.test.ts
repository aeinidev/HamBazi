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
  gameId = "kahroba";
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
          startedMatchId: null,
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
beforeAll(async () => {
  const module = createKahrobaHttpModule({
    sessions: {
      authenticate: async (token) => ({
        ok: true,
        session: {
          schemaVersion: 1,
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
      maxPlayers: 2,
      registered: true,
      enabled: true,
      routes: true,
      admission: true,
      namespace: "synthetic",
      reconnect: { schemaVersion: 1, leaseMs: 30000, graceMs: 30000, maxConnections: 4 },
    },
    resync: {
      snapshot: async () => createErrorEnvelope("NOT_FOUND"),
      catchup: async () => createErrorEnvelope("NOT_FOUND"),
    },
    names: { find },
    rooms: { read },
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
  find.mockClear();
  read.mockClear();
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
      schemaVersion: 1,
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
