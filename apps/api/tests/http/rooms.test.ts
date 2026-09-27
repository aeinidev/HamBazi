import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { createHttpApplication } from "../../src/composition/http.js";
import { createSafeLogger } from "../../src/composition/safe-logger.js";
import { roomsOpenApiDocument, type RoomsHttpDependencies } from "../../src/rooms/index.js";
import { onboardingFixture } from "../auth/onboarding-fixtures.js";
import { compatibleAuthContract } from "../../scripts/contract-compatibility.mjs";
const active: Awaited<ReturnType<typeof createHttpApplication>>[] = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((h) => h.app.close()));
});
async function setup() {
  const f = onboardingFixture();
  const userId = randomUUID(),
    roomId = randomUUID(),
    commandId = randomUUID();
  const output: string[] = [];
  const create = vi.fn<RoomsHttpDependencies["rooms"]["create"]>(async () => ({
    ok: true,
    schemaVersion: 1,
    commandId,
    roomId,
    appliedVersion: 0,
  }));
  const read = vi.fn<RoomsHttpDependencies["rooms"]["read"]>(async () => ({
    ok: true,
    schemaVersion: 1,
    room: {
      id: roomId,
      gameId: "coup",
      hostUserId: userId,
      capacity: 2,
      status: "WAITING",
      version: 0,
      expiresAt: 1000,
      startedMatchId: null,
      members: [{ userId, seat: 0, joinedAt: 0, joinedVersion: 0 }],
    },
  }));
  const shareInvite = vi.fn<NonNullable<RoomsHttpDependencies["rooms"]["shareInvite"]>>(
    async () => ({
      ok: true,
      schemaVersion: 1,
      invite: {
        roomId,
        expiresAt: 1000,
        startParam: "room_" + "A".repeat(43),
        deepLink: "https://t.me/HamBaziBot/play?startapp=room_" + "A".repeat(43),
      },
    }),
  );
  const resolveInvite = vi.fn<NonNullable<RoomsHttpDependencies["rooms"]["resolveInvite"]>>(
    async () => ({
      ok: true,
      schemaVersion: 1,
      room: {
        id: roomId,
        gameId: "coup",
        capacity: 2,
        status: "WAITING",
        version: 0,
        expiresAt: 1000,
      },
    }),
  );
  const authenticate = vi.fn<RoomsHttpDependencies["authenticate"]>(async () => ({
    ok: true,
    userId,
  }));
  const rate = vi.fn<RoomsHttpDependencies["rate"]>(async () => ({ allowed: true }));
  const http = await createHttpApplication({
    auth: {
      sessions: f.service,
      telegram: f.telegram,
      clock: f.clock,
      onboarding: f.onboarding,
      limiter: {
        consumeIp: async () => ({ allowed: true }),
        consumeIdentity: async () => ({ allowed: true }),
      },
    },
    rooms: { rooms: { create, read, shareInvite, resolveInvite }, authenticate, rate },
    allowedOrigins: ["https://mini.example"],
    trustedProxies: [],
    production: false,
    logger: createSafeLogger({
      write: (value: string) => {
        output.push(value);
      },
    }),
  });
  active.push(http);
  return {
    ...http,
    shareInvite,
    resolveInvite,
    userId,
    roomId,
    commandId,
    create,
    read,
    authenticate,
    rate,
    output,
    headers: { authorization: "Bearer synthetic.token.value" },
    input: { schemaVersion: 1, commandId, gameId: "coup", capacity: 2 },
  };
}
it("binds the authenticated actor and serves only safe no-store create/read projections", async () => {
  const f = await setup();
  const response = await f.server.inject({
    method: "POST",
    url: "/v1/rooms",
    headers: f.headers,
    payload: f.input,
  });
  expect(response.statusCode).toBe(201);
  expect(response.json()).toMatchObject({ roomId: f.roomId, appliedVersion: 0 });
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(f.create).toHaveBeenCalledWith(f.userId, f.input);
  expect(f.rate).toHaveBeenCalledWith("create", f.userId);
  const read = await f.server.inject({ url: `/v1/rooms/${f.roomId}`, headers: f.headers });
  expect(read.statusCode).toBe(200);
  expect(f.read).toHaveBeenCalledWith(f.userId, f.roomId);
  expect(f.rate).toHaveBeenCalledWith("read", f.userId);
  expect(read.body).not.toContain("invite");
  expect(f.output.join("")).not.toContain("synthetic.token");
});
it.each(["read", "create"] as const)(
  "authenticates before rate/application calls for %s",
  async (operation) => {
    const f = await setup();
    const request =
      operation === "read"
        ? { url: `/v1/rooms/${f.roomId}` }
        : { url: "/v1/rooms", method: "POST" as const, payload: f.input };
    expect((await f.server.inject(request)).statusCode).toBe(401);
    f.authenticate.mockResolvedValue({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect((await f.server.inject({ ...request, headers: f.headers })).statusCode).toBe(401);
    expect(f.rate).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  },
);
it.each(["read", "create"] as const)(
  "fails closed on Redis outage and reports exhaustion for %s",
  async (operation) => {
    const f = await setup();
    const request = {
      headers: f.headers,
      ...(operation === "read"
        ? { url: `/v1/rooms/${f.roomId}` }
        : { url: "/v1/rooms", method: "POST" as const, payload: f.input }),
    };
    f.rate.mockResolvedValue({ allowed: false, reason: "unavailable" });
    expect((await f.server.inject(request)).statusCode).toBe(503);
    f.rate.mockRejectedValue(new Error("secret redis"));
    expect((await f.server.inject(request)).statusCode).toBe(503);
    f.rate.mockResolvedValue({ allowed: false, reason: "limited", retryAfterSeconds: 9 });
    const response = await f.server.inject(request);
    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("9");
    expect(f.read).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.output.join("")).not.toContain("secret redis");
  },
);
it.each([
  ["NOT_FOUND", 404],
  ["FORBIDDEN", 403],
  ["ROOM_CONFLICT", 409],
  ["GAME_UNAVAILABLE", 409],
  ["INVALID_INPUT", 400],
  ["INTERNAL_ERROR", 503],
] as const)("maps %s without exposing internal errors", async (code, status) => {
  const f = await setup();
  f.create.mockResolvedValue({ ok: false, error: { code, message: "safe", retryable: false } });
  const response = await f.server.inject({
    url: "/v1/rooms",
    method: "POST",
    headers: f.headers,
    payload: f.input,
  });
  expect(response.statusCode).toBe(status);
  expect(response.json().error.code).toBe(code);
});
it("does not expose membership or trusted workflow routes and blocks origin/query injection", async () => {
  const f = await setup();
  for (const action of ["join", "leave", "start", "confirmStarted", "closeStarted", "expire"])
    expect(
      (
        await f.server.inject({
          method: "POST",
          url: `/v1/rooms/${f.roomId}/${action}`,
          headers: f.headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  expect(
    (await f.server.inject({ url: `/v1/rooms/${f.roomId}?userId=other`, headers: f.headers }))
      .statusCode,
  ).toBe(400);
  expect(
    (
      await f.server.inject({
        url: `/v1/rooms/${f.roomId}`,
        headers: { ...f.headers, origin: "https://evil.example" },
      })
    ).statusCode,
  ).toBe(403);
});
it("rejects unsafe output, oversized/malformed requests, and sanitizes thrown errors", async () => {
  const f = await setup();
  const result = await f.read(f.userId, f.roomId);
  if (!result.ok) throw new Error();
  f.read.mockResolvedValue({
    ...result,
    room: { ...result.room, inviteCode: "PRIVATE_INVITE" } as typeof result.room,
  });
  const read = await f.server.inject({ url: `/v1/rooms/${f.roomId}`, headers: f.headers });
  expect(read.statusCode).toBe(503);
  expect(read.body + f.output.join("")).not.toContain("PRIVATE_INVITE");
  f.create.mockRejectedValue(new Error("secret database"));
  const failed = await f.server.inject({
    method: "POST",
    url: "/v1/rooms",
    headers: f.headers,
    payload: f.input,
  });
  expect(failed.statusCode).toBe(503);
  expect(failed.body + f.output.join("")).not.toContain("secret database");
  expect(
    (
      await f.server.inject({
        method: "POST",
        url: "/v1/rooms",
        headers: { ...f.headers, "content-type": "application/json" },
        payload: "{",
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await f.server.inject({
        method: "POST",
        url: "/v1/rooms",
        headers: f.headers,
        payload: { large: "x".repeat(33000) },
      })
    ).statusCode,
  ).toBe(413);
});
it("compares the generated contract and rejects authentication removal", () => {
  const baseline = JSON.parse(
    readFileSync(
      new URL("../../../../docs/contracts/rooms.v1.baseline.json", import.meta.url),
      "utf8",
    ),
  );
  const document = roomsOpenApiDocument();
  expect(compatibleAuthContract(baseline, document)).toBe(true);
  document.paths["/v1/rooms"].post.security = [];
  expect(compatibleAuthContract(baseline, document)).toBe(false);
});

it("authenticates invite routes, uses no-store and omits payloads from telemetry", async () => {
  const f = await setup();
  const payload = { schemaVersion: 1, startParam: "room_" + "A".repeat(43) };
  expect(
    (await f.server.inject({ method: "POST", url: "/v1/room-invites/resolve", payload }))
      .statusCode,
  ).toBe(401);
  expect(f.resolveInvite).not.toHaveBeenCalled();
  const share = await f.server.inject({ url: `/v1/rooms/${f.roomId}/invite`, headers: f.headers });
  expect(share.statusCode).toBe(200);
  expect(share.headers["cache-control"]).toBe("no-store");
  const result = await f.server.inject({
    method: "POST",
    url: "/v1/room-invites/resolve",
    headers: f.headers,
    payload,
  });
  expect(result.statusCode).toBe(200);
  expect(f.resolveInvite).toHaveBeenCalledWith(f.userId, payload);
  expect(f.shareInvite).toHaveBeenCalledWith(f.userId, f.roomId);
  expect(f.rate).not.toHaveBeenCalled(); // application port owns shared invite quota
  expect(result.body + f.output.join("")).not.toContain(payload.startParam);
  expect(result.headers["cache-control"]).toBe("no-store");
});
it.each([
  ["RATE_LIMITED", 429],
  ["INTERNAL_ERROR", 503],
  ["NOT_FOUND", 404],
  ["INVALID_INPUT", 400],
] as const)("maps invite %s safely", async (code, status) => {
  const f = await setup();
  f.resolveInvite.mockResolvedValue({
    ok: false,
    error: { code, message: "PRIVATE_INVITE", retryable: false },
  });
  const response = await f.server.inject({
    method: "POST",
    url: "/v1/room-invites/resolve",
    headers: f.headers,
    payload: {},
  });
  expect(response.statusCode).toBe(status);
  if (status === 429) expect(response.headers["retry-after"]).toBe("60");
  expect(response.body + f.output.join("")).not.toContain("PRIVATE_INVITE");
});
it("rejects invite preview fields that could expose a member roster", async () => {
  const f = await setup();
  const result = await f.resolveInvite(f.userId, {});
  if (!result.ok) throw new Error();
  f.resolveInvite.mockResolvedValue({
    ...result,
    room: { ...result.room, members: ["PRIVATE_USER"] } as typeof result.room,
  });
  const response = await f.server.inject({
    method: "POST",
    url: "/v1/room-invites/resolve",
    headers: f.headers,
    payload: {},
  });
  expect(response.statusCode).toBe(503);
  expect(response.body + f.output.join("")).not.toContain("PRIVATE_USER");
});
