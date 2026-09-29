import { createServer, type Server as HttpServer } from "node:http";
import { once } from "node:events";
import { io, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createErrorEnvelope } from "@hambazi/contracts";
import { createHttpApplication } from "../../src/composition/http.js";
import { createSafeLogger } from "../../src/composition/safe-logger.js";
import { onboardingFixture } from "../auth/onboarding-fixtures.js";
import {
  createRealtimeGateway,
  realtimeEventCatalog,
  type RealtimeDependencies,
} from "../../src/realtime/index.js";

const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const roomId = "33333333-3333-4333-8333-333333333333";
const matchId = "44444444-4444-4444-8444-444444444444";
const actionId = "55555555-5555-4555-8555-555555555555";
const ticketId = "66666666-6666-4666-8666-666666666666";
const origin = "https://mini.example";
let server: HttpServer | undefined;
let gateway: ReturnType<typeof createRealtimeGateway> | undefined;
const clients: ClientSocket[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await gateway?.close();
  gateway = undefined;
  if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

function dependencies() {
  const authenticate = vi.fn(async (token: unknown) =>
    token === "valid"
      ? {
          ok: true as const,
          session: { schemaVersion: 1 as const, userId, sessionId: otherId, expiresAt: 2000000000 },
        }
      : createErrorEnvelope("UNAUTHENTICATED"),
  );
  const readRoom = vi.fn(async (actor: unknown, id: unknown) =>
    actor === userId && id === roomId
      ? { ok: true as const, schemaVersion: 1 as const, room: { id: roomId } }
      : createErrorEnvelope("NOT_FOUND"),
  );
  const roomAck = {
    ok: true as const,
    schemaVersion: 1 as const,
    commandId: actionId,
    roomId,
    appliedVersion: 2,
  };
  const join = vi.fn(async () => roomAck);
  const leave = vi.fn(async () => roomAck);
  const start = vi.fn(async () => roomAck);
  const matchAck = {
    ok: true as const,
    value: {
      schemaVersion: 1 as const,
      matchId,
      actionId,
      stateVersion: 2,
      lastEventSeq: 3,
      status: "ACTIVE" as const,
    },
  };
  const command = vi.fn(async () => matchAck);
  const ready = vi.fn(async () => matchAck);
  const authorize = vi.fn(async (actor: unknown, input: unknown) =>
    actor === userId &&
    typeof input === "object" &&
    input !== null &&
    "matchId" in input &&
    input.matchId === matchId
      ? {
          ok: true as const,
          value: { schemaVersion: 1 as const, matchId, role: "PLAYER" as const },
        }
      : createErrorEnvelope("NOT_FOUND"),
  );
  const ticket = {
    schemaVersion: 1 as const,
    ticketId,
    status: "SEARCHING",
    expiresAt: 2000000000000,
    matchId: null,
  };
  const search = vi.fn(async () => ({ ok: true as const, value: ticket }));
  const read = vi.fn(async () => ({ ok: true as const, value: ticket }));
  const cancel = vi.fn(async () => ({ ok: true as const, value: ticket }));
  const found = vi.fn(async () => ({
    ok: true as const,
    value: {
      schemaVersion: 1,
      ticketId,
      matchId,
      expiresAt: 2000000000,
      admissionToken: { reveal: () => "admission-secret" },
    },
  }));
  const admit = vi.fn(async () => ({ ok: true as const, value: { schemaVersion: 1, matchId } }));
  const rate = vi.fn<RealtimeDependencies["rate"]>(async () => ({ allowed: true }));
  const ports = {
    sessions: { authenticate },
    rooms: { read: readRoom, join, leave, start },
    matches: { command, ready },
    membership: { authorize },
    matchmaking: { search, read, cancel, found, admit },
    rate,
    allowedOrigins: [origin],
    nowMs: () => 1000000000,
  } as unknown as RealtimeDependencies;
  return {
    ports,
    authenticate,
    readRoom,
    join,
    leave,
    start,
    command,
    ready,
    authorize,
    search,
    found,
    rate,
  };
}

async function start(deps: RealtimeDependencies) {
  server = createServer();
  gateway = createRealtimeGateway(server, deps);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener");
  return `http://127.0.0.1:${address.port}/v1`;
}
async function connect(
  url: string,
  auth: Record<string, unknown> = { schemaVersion: 1, accessToken: "valid" },
  requestOrigin = origin,
) {
  const client = io(url, {
    path: "/v1/socket.io",
    auth,
    transports: ["websocket"],
    reconnection: false,
    timeout: 2000,
    extraHeaders: { Origin: requestOrigin },
  });
  clients.push(client);
  return client;
}
async function connected(client: ClientSocket) {
  await new Promise<void>((resolve, reject) => {
    client.once("connect", () => resolve());
    client.once("connect_error", reject);
  });
}
async function connectError(client: ClientSocket) {
  return new Promise<Error>((resolve) => client.once("connect_error", resolve));
}
function ack(client: ClientSocket, name: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve) => client.emit(name, payload, resolve));
}

describe("versioned realtime gateway", () => {
  it("attaches to the Nest/Fastify HTTP server and closes with the API", async () => {
    const f = onboardingFixture();
    const d = dependencies();
    const http = await createHttpApplication({
      auth: {
        sessions: f.service,
        telegram: f.telegram,
        clock: f.clock,
        limiter: {
          consumeIp: async () => ({ allowed: true }),
          consumeIdentity: async () => ({ allowed: true }),
        },
        onboarding: f.onboarding,
      },
      realtime: d.ports,
      logger: createSafeLogger({ write: () => {} }),
      allowedOrigins: [origin],
      trustedProxies: [],
      production: false,
    });
    try {
      await http.app.listen(0, "127.0.0.1");
      const address = http.server.server.address();
      if (!address || typeof address === "string") throw new Error("Missing test listener");
      const client = await connect(`http://127.0.0.1:${address.port}/v1`);
      await connected(client);
      expect(await ack(client, "presence:ping", { schemaVersion: 1 })).toEqual({
        ok: true,
        value: { schemaVersion: 1 },
      });
    } finally {
      await Promise.all([http.realtime?.close(), http.app.close()]);
    }
  });
  it("freezes a strict v1 event catalog with no identity in intent payloads", () => {
    const catalog = realtimeEventCatalog();
    expect(catalog.namespace).toBe("/v1");
    expect(catalog.clientEvents["game:command"]).toBeDefined();
    expect(catalog.reservedServerEvents).toContain("chat:message");
    expect(JSON.stringify(catalog.clientEvents)).not.toContain("userId");
  });

  it("rejects absent, forged, injected-identity and cross-origin handshakes", async () => {
    const d = dependencies();
    const url = await start(d.ports);
    for (const auth of [
      { schemaVersion: 1, accessToken: "bad" },
      { schemaVersion: 1, accessToken: "valid", userId: otherId },
      {},
    ]) {
      const client = await connect(url, auth);
      const error = await connectError(client);
      expect(error).toBeInstanceOf(Error);
      expect(client.connected).toBe(false);
    }
    const crossOrigin = await connect(
      url,
      { schemaVersion: 1, accessToken: "valid" },
      "https://other.example",
    );
    await connectError(crossOrigin);
    expect(crossOrigin.connected).toBe(false);
    vi.mocked(d.rate).mockResolvedValueOnce({ allowed: false, reason: "limited" });
    const limited = await connect(url);
    expect(((await connectError(limited)) as Error & { data?: unknown }).data).toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(d.join).not.toHaveBeenCalled();
  });

  it("binds every intent to the authenticated user and rejects invalid payloads before application work", async () => {
    const d = dependencies();
    const client = await connect(await start(d.ports));
    await connected(client);
    expect(
      await ack(client, "room:join", {
        schemaVersion: 1,
        commandId: actionId,
        roomId,
        expectedVersion: 1,
        inviteCode: "bad",
        userId: otherId,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(d.join).not.toHaveBeenCalled();
    client.emit("room:leave", {
      schemaVersion: 1,
      commandId: actionId,
      roomId,
      expectedVersion: 1,
    });
    await ack(client, "presence:ping", { schemaVersion: 1 });
    expect(d.leave).not.toHaveBeenCalled();
    expect(
      await ack(client, "room:leave", {
        schemaVersion: 1,
        commandId: actionId,
        roomId,
        expectedVersion: 1,
      }),
    ).toMatchObject({ ok: true });
    expect(d.leave).toHaveBeenCalledWith(userId, expect.objectContaining({ roomId }));
    expect(await ack(client, "chat:message", { text: "secret" })).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("checks membership before room and match subscription", async () => {
    const d = dependencies();
    const client = await connect(await start(d.ports));
    await connected(client);
    expect(
      await ack(client, "room:subscribe", { schemaVersion: 1, roomId: otherId }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      await ack(client, "match:subscribe", { schemaVersion: 1, matchId: otherId }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await ack(client, "room:subscribe", { schemaVersion: 1, roomId })).toMatchObject({
      ok: true,
    });
    expect(await ack(client, "match:subscribe", { schemaVersion: 1, matchId })).toMatchObject({
      ok: true,
      value: { role: "PLAYER" },
    });
  });

  it("revalidates the durable session and fails closed on rate failure", async () => {
    const d = dependencies();
    const client = await connect(await start(d.ports));
    await connected(client);
    vi.mocked(d.rate).mockRejectedValueOnce(new Error("sensitive failure"));
    expect(await ack(client, "presence:ping", { schemaVersion: 1 })).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
    vi.mocked(d.authenticate).mockResolvedValue(createErrorEnvelope("UNAUTHENTICATED"));
    expect(await ack(client, "presence:ping", { schemaVersion: 1 })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(client.connected).toBe(false);
  });

  it("delegates matchmaking and match commands and reveals admission only to its requesting socket", async () => {
    const d = dependencies();
    const client = await connect(await start(d.ports));
    await connected(client);
    expect(
      await ack(client, "matchmaking:search", {
        schemaVersion: 1,
        commandId: actionId,
        gameId: "coup",
        mode: "standard",
        capacity: 2,
      }),
    ).toMatchObject({ ok: true });
    expect(d.search).toHaveBeenCalledWith("valid", expect.objectContaining({ gameId: "coup" }));
    expect(await ack(client, "matchmaking:found", { schemaVersion: 1, ticketId })).toMatchObject({
      ok: true,
      value: { admissionToken: "admission-secret" },
    });
    expect(
      await ack(client, "game:command", {
        schemaVersion: 1,
        actionId,
        matchId,
        expectedVersion: 1,
        command: { type: "DECLARE_INCOME" },
      }),
    ).toMatchObject({ ok: true, value: { stateVersion: 2 } });
    expect(d.command).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ matchId }),
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });
});
