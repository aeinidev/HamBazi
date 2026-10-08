import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { expect, it } from "vitest";
import { createErrorEnvelope } from "@hambazi/contracts";
import { createPersonalGateway } from "../../src/realtime/index.js";
const id = randomUUID(),
  sessionId = randomUUID();
it("isolates the personal namespace, rechecks sessions, denies origin/identity abuse and drains accepted work", async () => {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error();
  let authorized = true,
    admitted = true,
    called = 0,
    release: (() => void) | undefined;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const denied = () => createErrorEnvelope("FORBIDDEN");
  const gateway = createPersonalGateway(server, {
    production: false,
    trustedProxies: [],
    allowedOrigins: ["https://staging.hambazi.top"],
    policy: {
      httpRequestsPerMinute: 100,
      engineRequestsPerMinute: 100,
      socketConnectionsPerMinute: 10,
      socketEventsPerMinute: 100,
      maxHttpInFlight: 4,
      maxEngineInFlight: 4,
      maxConnections: 4,
      maxPendingPerSocket: 1,
      maxPendingTotal: 4,
      maxSubscriptions: 1,
    },
    ip: async () => ({ allowed: true }),
    rate: async () => (admitted ? { allowed: true } : { allowed: false, reason: "limited" }),
    sessions: {
      authenticate: async () =>
        authorized
          ? {
              ok: true,
              session: {
                schemaVersion: 1,
                userId: id,
                sessionId,
                expiresAt: Math.floor(Date.now() / 1000) + 60,
              },
            }
          : createErrorEnvelope("UNAUTHENTICATED"),
    },
    matches: {
      current: async () => ({ ok: true, value: { schemaVersion: 1, matchId: null } }),
      start: async () => {
        called++;
        await held;
        return { ok: true, value: { schemaVersion: 1 } };
      },
      read: async () => denied(),
      command: async () => denied(),
      close: async () => denied(),
    },
  });
  const sockets: Socket[] = [];
  const connect = (origin: string) => {
    const socket = io(`http://127.0.0.1:${address.port}/personal-v1`, {
      path: "/v1/personal/socket.io",
      transports: ["websocket"],
      auth: { schemaVersion: 1, accessToken: "synthetic-test-only" },
      extraHeaders: { Origin: origin },
      reconnection: false,
      timeout: 1000,
    });
    sockets.push(socket);
    return socket;
  };
  try {
    const bad = connect("https://unapproved.invalid");
    await new Promise<void>((r) => bad.once("connect_error", () => r()));
    expect(bad.connected).toBe(false);
    let owner = connect("https://staging.hambazi.top");
    await new Promise<void>((r, j) => {
      owner.once("connect", r);
      owner.once("connect_error", j);
    });
    expect(
      (
        await owner
          .timeout(1000)
          .emitWithAck("personal:current", { schemaVersion: 1, userId: randomUUID() })
      ).ok,
    ).toBe(false);
    authorized = false;
    expect(
      (await owner.timeout(1000).emitWithAck("personal:current", { schemaVersion: 1 })).error.code,
    ).toBe("UNAUTHENTICATED");
    authorized = true;
    owner = connect("https://staging.hambazi.top");
    await new Promise<void>((r, j) => {
      owner.once("connect", r);
      owner.once("connect_error", j);
    });
    admitted = false;
    expect(
      (await owner.timeout(1000).emitWithAck("personal:current", { schemaVersion: 1 })).ok,
    ).toBe(false);
    admitted = true;
    const first = owner
      .timeout(2000)
      .emitWithAck("personal:start", { schemaVersion: 1, commandId: randomUUID() });
    while (called === 0) await new Promise((r) => setTimeout(r, 5));
    expect(
      (
        await owner
          .timeout(1000)
          .emitWithAck("personal:start", { schemaVersion: 1, commandId: randomUUID() })
      ).error.code,
    ).toBe("RATE_LIMITED");
    gateway.stopAdmission();
    const closing = gateway.close();
    let closed = false;
    void closing.then(() => (closed = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(closed).toBe(false);
    release!();
    expect((await first).ok).toBe(true);
    await closing;
    expect(called).toBe(1);
  } finally {
    for (const socket of sockets) socket.disconnect();
    release!();
    await gateway.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
}, 10000);
