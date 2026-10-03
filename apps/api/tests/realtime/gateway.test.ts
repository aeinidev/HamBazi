import { createServer, type Server as HttpServer } from "node:http";
import { createTelemetryLogger, currentCorrelation, createMetrics } from "@hambazi/observability";
import { once } from "node:events";
import { io, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { realtimeDependencies as dependencies } from "../fixtures/realtime.js";
import { createErrorEnvelope, createMatchSequence } from "@hambazi/contracts";
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
  it("counts sockets and distinct authenticated users locally and removes disconnected references", async () => {
    const d = dependencies(),
      metrics = createMetrics("api");
    const url = await start({ ...d.ports, metrics });
    const first = await connect(url);
    await connected(first);
    const second = await connect(url);
    await connected(second);
    expect(metrics.render()).toContain('hambazi_sockets{service="api"} 2');
    expect(metrics.render()).toContain('hambazi_connected_users{service="api"} 1');
    first.disconnect();
    await vi.waitFor(() => expect(metrics.render()).toContain('hambazi_sockets{service="api"} 1'));
    expect(metrics.render()).toContain('hambazi_connected_users{service="api"} 1');
    second.disconnect();
    await vi.waitFor(() =>
      expect(metrics.render()).toContain('hambazi_connected_users{service="api"} 0'),
    );
    expect(metrics.render()).not.toContain(userId);
  });
  it("stops new intents and handshakes while draining an already admitted command", async () => {
    const d = dependencies();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((r) => (entered = r));
    const gate = new Promise<void>((r) => (release = r));
    const ports: RealtimeDependencies = {
      ...d.ports,
      matches: {
        ...d.ports.matches,
        command: async () => {
          entered();
          await gate;
          return {
            ok: true,
            value: {
              schemaVersion: 1,
              matchId,
              actionId,
              stateVersion: 2,
              lastEventSeq: 3,
              status: "ACTIVE",
            },
          };
        },
      },
    };
    const url = await start(ports);
    const client = await connect(url);
    await connected(client);
    const command = {
      schemaVersion: 1,
      matchId,
      actionId,
      expectedVersion: 1,
      command: { type: "income" },
    };
    const accepted = ack(client, "game:command", command);
    await started;
    try {
      gateway!.stopAdmission();
      expect(gateway!.ready()).toBe(false);
      expect(await ack(client, "game:command", command)).toMatchObject({
        ok: false,
        error: { code: "INTERNAL_ERROR" },
      });
      const denied = await connect(url);
      expect((await connectError(denied)).message).toBeTruthy();
      let drained = false;
      const closing = gateway!.close().then(() => {
        drained = true;
      });
      expect(drained).toBe(false);
      release();
      expect(await accepted).toMatchObject({ ok: true });
      await closing;
    } finally {
      release();
    }
  });
  it("gives queued commands separate server traces and logs only validated metadata", async () => {
    const d = dependencies();
    const output: string[] = [];
    const observed: unknown[] = [];
    const ports: RealtimeDependencies = {
      ...d.ports,
      telemetry: createTelemetryLogger({
        write: (line: string) => {
          output.push(line);
        },
      }),
      matches: {
        ...d.ports.matches,
        command: async (_actor, _input, context) => {
          const before = currentCorrelation();
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(currentCorrelation()).toEqual(before);
          expect(context).toEqual(before);
          observed.push(before);
          return {
            ok: true,
            value: {
              matchId,
              actionId,
              schemaVersion: 1,
              stateVersion: 2,
              lastEventSeq: 3,
              status: "ACTIVE",
            },
          };
        },
      },
    };
    const client = await connect(await start(ports));
    await connected(client);
    const command = {
      schemaVersion: 1,
      matchId,
      actionId,
      expectedVersion: 1,
      command: { type: "PRIVATE_COMMAND", text: "PRIVATE_CHAT", cards: ["PRIVATE_CARD"] },
    };
    const outcomes = await Promise.all([
      ack(client, "game:command", command),
      ack(client, "game:command", { ...command, actionId: "77777777-7777-4777-8777-777777777777" }),
    ]);
    expect(outcomes.every((x) => (x as { ok: boolean }).ok)).toBe(true);
    expect(observed).toHaveLength(2);
    const lines = output.map((v) => JSON.parse(v));
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((v) => v.requestId)).size).toBe(2);
    expect(new Set(lines.map((v) => v.traceId)).size).toBe(2);
    expect(lines[0]).toMatchObject({ event: "socket.completed", matchId, actionId, userId });
    expect(output.join("")).not.toMatch(/PRIVATE|"command":|cards|text|token|expectedVersion/);
    expect(currentCorrelation()).toBeUndefined();
  });
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
      await http.realtime?.close();
      await http.app.close();
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

  it("rejects Engine.IO polling/upgrade admission before authenticating and ignores spoofed proxy headers", async () => {
    const d = dependencies();
    const ip = vi.fn<RealtimeDependencies["admission"]["ip"]>(async () => ({
      allowed: false,
      reason: "limited",
      retryAfterSeconds: 9,
    }));
    d.ports.admission.ip = ip;
    const url = await start(d.ports);
    const response = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
      headers: { "x-forwarded-for": "203.0.113.9", Origin: "https://mini.example" },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("9");
    expect(await response.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    const forgedSid = await fetch(`${url}/socket.io/?EIO=4&transport=polling&sid=forged`);
    expect(forgedSid.status).toBe(429);
    const preflight = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
      method: "OPTIONS",
      headers: { Origin: origin, "access-control-request-method": "GET" },
    });
    expect(preflight.status).toBe(429);
    const denied = await connect(url);
    await connectError(denied);
    expect(ip).toHaveBeenCalledWith("127.0.0.1", "engine");
    expect(d.authenticate).not.toHaveBeenCalled();
    gateway!.stopAdmission();
    expect((await fetch(`${url}/socket.io/?EIO=4&transport=polling`)).status).toBe(503);
  });

  it("counts malformed/unknown/unacknowledged events before durable session work", async () => {
    const d = dependencies();
    const client = await connect(await start(d.ports));
    await connected(client);
    d.authenticate.mockClear();
    d.rate.mockClear();
    d.rate.mockResolvedValue({ allowed: false, reason: "limited", retryAfterSeconds: 3 });
    expect(await ack(client, "presence:ping", { schemaVersion: 1 })).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    expect(await ack(client, "unknown:event", { chat: "private-text" })).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    client.emit("room:leave", { schemaVersion: 1 });
    await ack(client, "presence:ping", { schemaVersion: 1 });
    expect(d.rate).toHaveBeenCalledTimes(4);
    expect(d.authenticate).not.toHaveBeenCalled();
    expect(d.leave).not.toHaveBeenCalled();
  });

  it("bounds unauthenticated transport connections and rejects insecure production upgrades", async () => {
    const d = dependencies();
    d.ports.admission.policy = { ...d.ports.admission.policy, maxConnections: 1 };
    const url = await start(d.ports);
    const first = await connect(url);
    await connected(first);
    const second = await connect(url);
    await connectError(second);
    expect(d.authenticate).toHaveBeenCalledTimes(1);
    expect((await fetch(`${url}/socket.io/?EIO=4&transport=polling&sid=`)).status).toBe(429);
    d.ports.admission.production = true;
    const response = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(response.status).toBe(403);
    expect(d.authenticate).toHaveBeenCalledTimes(1);
  });
  it("bounds namespace authentication and drains an accepted lookup before teardown", async () => {
    const d = dependencies();
    d.ports.admission.policy = { ...d.ports.admission.policy, maxEngineInFlight: 1 };
    const authenticated = await d.authenticate("valid");
    d.authenticate.mockClear();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    d.authenticate.mockImplementation(async () => {
      await gate;
      return authenticated;
    });
    const url = await start(d.ports);
    const first = await connect(url);
    try {
      await vi.waitFor(() => expect(d.authenticate).toHaveBeenCalledTimes(1));
      const second = await connect(url);
      expect(((await connectError(second)) as Error & { data?: { code: string } }).data?.code).toBe(
        "RATE_LIMITED",
      );
      expect(d.authenticate).toHaveBeenCalledTimes(1);
      const drain = gateway!.close();
      release();
      await drain;
      expect(first.connected).toBe(false);
      expect(d.join).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });
  it("rejects concurrent namespace attempts on the same transport before a second session lookup", async () => {
    const d = dependencies();
    const authenticated = await d.authenticate("valid");
    d.authenticate.mockClear();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    d.authenticate.mockImplementation(async () => {
      await gate;
      return authenticated;
    });
    const client = await connect(await start(d.ports));
    try {
      await vi.waitFor(() => expect(d.authenticate).toHaveBeenCalledTimes(1));
      const error = connectError(client);
      client.io.engine.write('0/v1,{"schemaVersion":1,"accessToken":"valid"}');
      expect(((await error) as Error & { data?: { code: string } }).data?.code).toBe(
        "RATE_LIMITED",
      );
      expect(d.authenticate).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
  });

  it("bounds socket work, keeps admitted outcomes and drains reserved disconnect cleanup", async () => {
    const d = dependencies();
    d.ports.admission.policy = {
      ...d.ports.admission.policy,
      maxPendingPerSocket: 1,
      maxPendingTotal: 1,
    };
    const close = vi.fn(async () => {});
    d.ports.delivery = { ackTimeoutMs: 100, resync: { snapshot: vi.fn(), catchup: vi.fn() } };
    d.ports.presence = {
      port: { open: () => ({ close, heartbeat: vi.fn(), subscribe: vi.fn() }) },
      heartbeatIntervalMs: 1000,
      heartbeatTimeoutMs: 1000,
      leaseMs: 5000,
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = await d.command();
    d.command.mockClear();
    d.command.mockImplementation(async () => {
      await gate;
      return original;
    });
    const url = await start(d.ports);
    const client = await connect(url);
    await connected(client);
    const first = ack(client, "game:command", {
      schemaVersion: 1,
      actionId,
      matchId,
      expectedVersion: 1,
      command: { type: "DECLARE_INCOME" },
    });
    try {
      await vi.waitFor(() => expect(d.command).toHaveBeenCalledTimes(1));
      expect(
        await ack(client, "room:leave", {
          schemaVersion: 1,
          commandId: actionId,
          roomId,
          expectedVersion: 1,
        }),
      ).toMatchObject({ error: { code: "RATE_LIMITED" } });
      const other = await connect(url);
      await connected(other);
      expect(await ack(other, "presence:ping", { schemaVersion: 1 })).toMatchObject({
        error: { code: "RATE_LIMITED" },
      });
      expect(d.leave).not.toHaveBeenCalled();
      const drain = gateway!.close();
      release();
      expect(await first).toMatchObject({ ok: true });
      await drain;
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      release();
      await first;
    }
  });

  it("bounds subscription cardinality while allowing idempotent subscriptions", async () => {
    const d = dependencies();
    d.ports.admission.policy = { ...d.ports.admission.policy, maxSubscriptions: 1 };
    const client = await connect(await start(d.ports));
    await connected(client);
    for (let i = 0; i < 2; i++)
      expect(await ack(client, "room:subscribe", { schemaVersion: 1, roomId })).toMatchObject({
        ok: true,
      });
    expect(await ack(client, "match:subscribe", { schemaVersion: 1, matchId })).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    expect(d.authorize).not.toHaveBeenCalled();
    await ack(client, "room:leave", {
      schemaVersion: 1,
      commandId: actionId,
      roomId,
      expectedVersion: 1,
    });
    expect(await ack(client, "match:subscribe", { schemaVersion: 1, matchId })).toMatchObject({
      ok: true,
    });
  });

  it("retains transport capacity while disconnect cleanup is pending", async () => {
    const d = dependencies();
    d.ports.admission.policy = { ...d.ports.admission.policy, maxConnections: 1 };
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const close = vi.fn(async () => {
      await gate;
    });
    d.ports.delivery = { ackTimeoutMs: 100, resync: { snapshot: vi.fn(), catchup: vi.fn() } };
    d.ports.presence = {
      port: { open: () => ({ close, subscribe: vi.fn(), heartbeat: vi.fn() }) },
      heartbeatIntervalMs: 1000,
      heartbeatTimeoutMs: 1000,
      leaseMs: 5000,
    };
    const url = await start(d.ports);
    const first = await connect(url);
    await connected(first);
    first.disconnect();
    try {
      await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
      const denied = await connect(url);
      await connectError(denied);
      expect(d.authenticate).toHaveBeenCalledTimes(1);
      release();
      const next = await connect(url);
      await connected(next);
    } finally {
      release();
    }
  });

  it.each([
    ["room:start", "start", { schemaVersion: 1, commandId: actionId, roomId, expectedVersion: 1 }],
    ["match:ready", "ready", { schemaVersion: 1, actionId, matchId, expectedVersion: 1 }],
    [
      "game:command",
      "command",
      {
        schemaVersion: 1,
        actionId,
        matchId,
        expectedVersion: 1,
        command: { type: "DECLARE_INCOME" },
      },
    ],
  ] as const)(
    "preserves module-owned role/state/turn denial for %s",
    async (event, port, payload) => {
      const d = dependencies();
      d[port].mockResolvedValue(createErrorEnvelope("FORBIDDEN") as never);
      const client = await connect(await start(d.ports));
      await connected(client);
      expect(await ack(client, event, payload)).toMatchObject({ error: { code: "FORBIDDEN" } });
      expect(d[port]).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ expectedVersion: 1 }),
        ...(port === "start" ? [] : [expect.anything()]),
      );
    },
  );

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

function delivery(d: ReturnType<typeof dependencies>) {
  const snapshot = {
    schemaVersion: 1 as const,
    matchId,
    stateVersion: 2,
    lastEventSeq: 3,
    status: "ACTIVE" as const,
    role: "PLAYER" as const,
    gameId: "coup",
    engineVersion: "coup-v1",
    stateSchemaVersion: 4,
    rulesetVersion: "test",
    view: { viewer: userId },
  };
  const catchup = vi.fn(async () => ({
    ok: true as const,
    value: {
      schemaVersion: 1 as const,
      mode: "EVENTS" as const,
      snapshot,
      events: [1, 2, 3].map((seq) => ({
        schemaVersion: 1 as const,
        eventId: actionId,
        matchId,
        seq,
        stateVersion: 2,
        type: "MATCH_INVALIDATED_V1" as const,
        payload: {},
      })),
    },
  }));
  d.ports.delivery = {
    ackTimeoutMs: 100,
    resync: { catchup, snapshot: async () => ({ ok: true, value: snapshot }) },
  };
  return { snapshot, catchup };
}
function wakeup() {
  return {
    schemaVersion: 1,
    eventId: actionId,
    aggregateId: matchId,
    occurredAt: 1000,
    correlation: {},
    type: "MATCH_CHANGED_V1",
    payload: { schemaVersion: 1, matchId, stateVersion: 2, lastEventSeq: 3, status: "ACTIVE" },
  };
}
it("delivers ordered events and acknowledged snapshots independently to multiple sockets; duplicates stay harmless", async () => {
  const d = dependencies();
  const f = delivery(d);
  const url = await start(d.ports);
  const seen: number[][] = [[], []];
  for (let i = 0; i < 2; i++) {
    const client = await connect(url);
    await connected(client);
    const sequence = createMatchSequence(matchId);
    client.on("match:event", (event: { seq: number }) => seen[i]!.push(event.seq));
    client.on("match:snapshot", (snapshot: typeof f.snapshot, respond: (seq: number) => void) => {
      sequence.snapshot(snapshot);
      respond(snapshot.lastEventSeq);
    });
    await ack(client, "match:subscribe", { schemaVersion: 1, matchId });
  }
  await gateway!.publish(wakeup());
  await gateway!.publish(wakeup());
  expect(seen).toEqual([
    [1, 2, 3, 1, 2, 3],
    [1, 2, 3, 1, 2, 3],
  ]);
  expect(f.catchup).toHaveBeenCalledWith(userId, { schemaVersion: 1, matchId, afterSeq: 3 });
});
it("fails delivery closed on session revocation", async () => {
  const d = dependencies();
  const f = delivery(d);
  const url = await start(d.ports);
  const client = await connect(url);
  await connected(client);
  await ack(client, "match:subscribe", { schemaVersion: 1, matchId });
  const received = vi.fn();
  client.on("match:snapshot", received);
  d.authenticate.mockResolvedValue(createErrorEnvelope("UNAUTHENTICATED"));
  await gateway!.publish(wakeup());
  expect(f.catchup).not.toHaveBeenCalled();
  expect(received).not.toHaveBeenCalled();
});

it("withholds a snapshot acknowledgement after revocation during projection", async () => {
  const d = dependencies();
  const f = delivery(d);
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const projection = vi.fn(async () => {
    await gate;
    return { ok: true as const, value: { ...f.snapshot, view: { private: "recipient-card" } } };
  });
  d.ports.delivery!.resync = { ...d.ports.delivery!.resync, snapshot: projection };
  const client = await connect(await start(d.ports));
  await connected(client);
  const result = ack(client, "match:snapshot", { schemaVersion: 1, matchId });
  try {
    await vi.waitFor(() => expect(projection).toHaveBeenCalled());
    d.authenticate.mockResolvedValue(createErrorEnvelope("UNAUTHENTICATED"));
    release();
    const response = await result;
    expect(response).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(JSON.stringify(response)).not.toContain("recipient-card");
  } finally {
    release();
    await result;
  }
});

it("closes orphaned Presence subscriptions after Match membership loss", async () => {
  const d = dependencies();
  const f = delivery(d);
  const close = vi.fn(async () => {});
  const subscribe = vi.fn(async () => f.snapshot);
  d.ports.presence = {
    port: { open: () => ({ close, subscribe, heartbeat: vi.fn() }) },
    heartbeatIntervalMs: 1000,
    heartbeatTimeoutMs: 1000,
    leaseMs: 5000,
  };
  const client = await connect(await start(d.ports));
  client.on("match:snapshot", (snapshot: typeof f.snapshot, respond: (seq: number) => void) =>
    respond(snapshot.lastEventSeq),
  );
  await connected(client);
  await ack(client, "match:subscribe", { schemaVersion: 1, matchId });
  d.ports.delivery!.resync = {
    ...d.ports.delivery!.resync,
    catchup: async () => createErrorEnvelope("NOT_FOUND"),
  };
  await gateway!.publish(wakeup());
  await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  await gateway!.close();
  expect(close).toHaveBeenCalledTimes(1);
  expect(subscribe).toHaveBeenCalledTimes(1);
});

it("withholds Chat content after revocation during a recipient projection", async () => {
  const d = dependencies();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const message = {
    schemaVersion: 1 as const,
    matchId,
    messageId: actionId,
    userId,
    seq: 1,
    text: "private-chat-content",
    createdAt: 1000,
  };
  const projection = vi.fn(async () => {
    await gate;
    return { ok: true as const, value: message };
  });
  d.ports.chat = {
    ackTimeoutMs: 100,
    port: {
      send: vi.fn(),
      delivery: projection,
      list: async () => ({
        ok: true as const,
        value: {
          schemaVersion: 1 as const,
          matchId,
          role: "PLAYER" as const,
          canSend: true,
          messageLimit: 500,
          messages: [],
          lastSeq: 1,
          hasMore: false,
        },
      }),
    },
  };
  const client = await connect(await start(d.ports));
  await connected(client);
  await ack(client, "chat:list", { schemaVersion: 1, matchId });
  const received = vi.fn();
  client.on("chat:message", received);
  const publication = gateway!.publishChat({
    schemaVersion: 1,
    eventId: ticketId,
    aggregateId: matchId,
    occurredAt: 1000,
    type: "CHAT_MESSAGE_V1",
    correlation: {},
    payload: { schemaVersion: 1, matchId, messageId: actionId, seq: 1 },
  });
  try {
    await vi.waitFor(() => expect(projection).toHaveBeenCalled());
    d.authenticate.mockResolvedValue(createErrorEnvelope("UNAUTHENTICATED"));
    release();
    await publication;
    expect(received).not.toHaveBeenCalled();
  } finally {
    release();
    await publication;
  }
});
it("retries publication after missing snapshot acknowledgement and rejects raw internal events", async () => {
  const d = dependencies();
  delivery(d);
  const client = await connect(await start(d.ports));
  await connected(client);
  await ack(client, "match:subscribe", { schemaVersion: 1, matchId });
  await expect(gateway!.publish(wakeup())).rejects.toThrow("Realtime publication failed");
  await expect(
    gateway!.publish({ ...wakeup(), type: "GAME_ENGINE_EVENT", payload: { deck: "private" } }),
  ).rejects.toThrow("Invalid realtime wakeup");
});
it("drains an in-flight command, rejects new connections and closes idempotently", async () => {
  const d = dependencies();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const previous = await d.command();
  d.command.mockImplementation(async () => {
    entered();
    await blocked;
    return previous;
  });
  const url = await start(d.ports);
  const client = await connect(url);
  await connected(client);
  const result = ack(client, "game:command", {
    schemaVersion: 1,
    actionId,
    matchId,
    expectedVersion: 1,
    command: { type: "DECLARE_INCOME" },
  });
  await started;
  const close = gateway!.close();
  expect(gateway!.ready()).toBe(false);
  const denied = await connect(url);
  await connectError(denied);
  release();
  expect(await result).toMatchObject({ ok: true });
  await close;
  await gateway!.close();
});
it("handles gaps, stale snapshots, foreign matches and initial version zero in the client cursor", () => {
  const cursor = createMatchSequence(matchId);
  const snap = { schemaVersion: 1, matchId, stateVersion: 0, lastEventSeq: 0 };
  expect(cursor.snapshot(snap)).toBe("APPLY");
  expect(cursor.event({ ...snap, seq: 2 })).toBe("GAP");
  expect(cursor.cursor().needsResync).toBe(true);
  expect(cursor.snapshot({ ...snap, stateVersion: 2, lastEventSeq: 3 })).toBe("APPLY");
  expect(cursor.event({ ...snap, seq: 3 })).toBe("DUPLICATE");
  expect(cursor.snapshot(snap)).toBe("STALE");
  expect(cursor.snapshot({ ...snap, stateVersion: 3, lastEventSeq: 1 })).toBe("STALE");
  expect(cursor.event({ ...snap, matchId: otherId, seq: 4 })).toBe("INVALID");
  expect(cursor.event({ ...snap, seq: 4 })).toBe("ACCEPT");
  expect(cursor.snapshot({ ...snap, stateVersion: 3, lastEventSeq: 4 })).toBe("APPLY");
  expect(cursor.cursor().needsResync).toBe(false);
});

it("removes a subscription after membership loss and retries database projection failures without payload leakage", async () => {
  const d = dependencies();
  const f = delivery(d);
  const client = await connect(await start(d.ports));
  await connected(client);
  await ack(client, "match:subscribe", { schemaVersion: 1, matchId });
  const received = vi.fn();
  client.on("match:snapshot", received);
  d.ports.delivery!.resync = {
    ...d.ports.delivery!.resync,
    catchup: async () => createErrorEnvelope("NOT_FOUND"),
  };
  await gateway!.publish(wakeup());
  d.ports.delivery!.resync = { ...d.ports.delivery!.resync, catchup: f.catchup };
  await gateway!.publish(wakeup());
  expect(f.catchup).not.toHaveBeenCalled();
  expect(received).not.toHaveBeenCalled();
  await ack(client, "match:subscribe", { schemaVersion: 1, matchId });
  d.ports.delivery!.resync = {
    ...d.ports.delivery!.resync,
    catchup: async () => {
      throw new Error("private database payload");
    },
  };
  await expect(gateway!.publish(wakeup())).rejects.toThrow("Realtime publication failed");
  expect(received).not.toHaveBeenCalled();
});
it("exposes authenticated snapshot and catchup acknowledgements and validates cursor input", async () => {
  const d = dependencies();
  const f = delivery(d);
  const client = await connect(await start(d.ports));
  await connected(client);
  expect(await ack(client, "match:snapshot", { schemaVersion: 1, matchId })).toEqual({
    ok: true,
    value: f.snapshot,
  });
  expect(
    await ack(client, "match:catchup", { schemaVersion: 1, matchId, afterSeq: 1 }),
  ).toMatchObject({ ok: true, value: { snapshot: f.snapshot } });
  expect(f.catchup).toHaveBeenCalledWith(userId, { schemaVersion: 1, matchId, afterSeq: 1 });
  expect(
    await ack(client, "match:catchup", { schemaVersion: 1, matchId, afterSeq: -1 }),
  ).toMatchObject({ error: { code: "INVALID_INPUT" } });
});

it("renews only after authenticated transport pongs and drains disconnect cleanup", async () => {
  const d = dependencies();
  const snapshot = {
    schemaVersion: 1 as const,
    matchId,
    status: "ACTIVE" as const,
    stateVersion: 1,
    lastEventSeq: 1,
    role: "SPECTATOR" as const,
    gameId: "coup",
    engineVersion: "coup-v1",
    stateSchemaVersion: 4,
    rulesetVersion: "coup-provisional-complete-v1",
    view: null,
  };
  const heartbeat = vi.fn(async () => {});
  const close = vi.fn(async () => {});
  const subscribe = vi.fn(async () => snapshot);
  const open = vi.fn(() => ({ heartbeat, close, subscribe }));
  d.ports.delivery = {
    ackTimeoutMs: 100,
    resync: {
      snapshot: vi.fn(async () => ({ ok: true as const, value: snapshot })),
      catchup: vi.fn(),
    },
  };
  d.ports.presence = {
    port: { open },
    heartbeatIntervalMs: 30,
    heartbeatTimeoutMs: 30,
    leaseMs: 500,
  };
  const client = await connect(await start(d.ports));
  client.on("match:snapshot", (view: typeof snapshot, ack: (seq: number) => void) =>
    ack(view.lastEventSeq),
  );
  await connected(client);
  expect(await ack(client, "match:subscribe", { schemaVersion: 1, matchId })).toMatchObject({
    ok: true,
    value: { role: "SPECTATOR" },
  });
  expect(subscribe).toHaveBeenCalledWith(matchId);
  await vi.waitFor(() => expect(heartbeat).toHaveBeenCalled(), { timeout: 2000, interval: 10 });
  expect(open).toHaveBeenCalledWith({ userId, sessionExpiresAt: 2000000000000 });
  d.authenticate.mockResolvedValue(createErrorEnvelope("UNAUTHENTICATED") as never);
  await vi.waitFor(() => expect(client.connected).toBe(false), { timeout: 2000, interval: 10 });
  await gateway!.close();
  expect(close).toHaveBeenCalledTimes(1);
});

it("rejects heartbeat settings that cannot keep a lease alive", async () => {
  const d = dependencies();
  d.ports.presence = {
    port: { open: vi.fn() },
    heartbeatIntervalMs: 100,
    heartbeatTimeoutMs: 100,
    leaseMs: 200,
  };
  server = createServer();
  expect(() => createRealtimeGateway(server!, d.ports)).toThrow(
    "Invalid presence heartbeat configuration",
  );
});
