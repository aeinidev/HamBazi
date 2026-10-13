import { createServer } from "node:http";
import { once } from "node:events";
import { io, type Socket } from "socket.io-client";
import { it, expect } from "vitest";
import { createErrorEnvelope } from "@hambazi/contracts";
import { createRealtimeGateway, createPersonalGateway } from "../../src/realtime/index.js";
import { realtimeDependencies } from "../fixtures/realtime.js";
it("keeps personal and private Kahroba websocket upgrades isolated on one actual listener", async () => {
  const server = createServer(),
    d = realtimeDependencies(),
    sockets: Socket[] = [];
  const general = createRealtimeGateway(server, {
    ...d.ports,
    transport: { namespace: "/kahroba-v1", path: "/v1/kahroba/socket.io", coexists: true },
  });
  const denied = async () => createErrorEnvelope("FORBIDDEN");
  const personal = createPersonalGateway(server, {
    coexistsWithKahroba: true,
    production: false,
    trustedProxies: [],
    allowedOrigins: d.ports.allowedOrigins,
    policy: d.ports.admission.policy,
    ip: d.ports.admission.ip,
    rate: d.ports.rate,
    sessions: d.ports.sessions,
    matches: {
      current: async () => ({ ok: true, value: { schemaVersion: 1, matchId: null } }),
      start: denied,
      read: denied,
      command: denied,
      close: denied,
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error();
  const port = address.port;
  async function open(namespace: string, path: string) {
    const s = io(`http://127.0.0.1:${port}/${namespace}`, {
      path,
      auth: { schemaVersion: 1, accessToken: "valid" },
      extraHeaders: { Origin: d.ports.allowedOrigins[0]! },
      transports: ["websocket"],
      reconnection: false,
      timeout: 1500,
    });
    sockets.push(s);
    await new Promise<void>((resolve, reject) => {
      s.once("connect", resolve);
      s.once("connect_error", reject);
    });
    return s;
  }
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = await open("personal-v1", "/v1/personal/socket.io"),
        k = await open("kahroba-v1", "/v1/kahroba/socket.io");
      expect((await p.timeout(1500).emitWithAck("personal:current", { schemaVersion: 1 })).ok).toBe(
        true,
      );
      expect(
        (
          await k.timeout(1500).emitWithAck("match:snapshot", {
            schemaVersion: 1,
            matchId: "44444444-4444-4444-8444-444444444444",
          })
        ).ok,
      ).toBe(false);
      p.disconnect();
      k.disconnect();
    }
  } finally {
    for (const s of sockets) s.disconnect();
    await general.close();
    await personal.close();
    if (server.listening) await new Promise<void>((r) => server.close(() => r()));
  }
}, 10000);
