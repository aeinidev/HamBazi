import process from "node:process";
// Isolated integration child. A SIGKILL deliberately bypasses all disconnect hooks.
import { createServer } from "node:http";
import { createDatabase } from "@hambazi/database";
import { createRealtimeGateway } from "../../dist/realtime/index.js";
import { createPresencePort } from "../../dist/presence/index.js";
import {
  createMatchReconnectPort,
  createMatchResyncPort,
  createMatchMembershipPort,
} from "../../dist/matches/index.js";
import { createCoupMatchGame } from "../../dist/composition/coup-match.js";
if (process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test") process.exit(1);
process.once("message", async (input) => {
  try {
    const database = createDatabase({
      databaseUrl: { reveal: () => process.env.API_DATABASE_URL },
      poolMax: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      transactionMaxWaitMs: 5000,
      transactionTimeoutMs: 5000,
    });
    await database.connect();
    const resync = createMatchResyncPort(database, [createCoupMatchGame(input.rules)]);
    const reconnect = createMatchReconnectPort(database, {
      clock: { nowMs: () => Date.now() },
      policy: input.policy,
    });
    const fail = async () => ({ ok: false, error: { code: "FORBIDDEN", message: "Forbidden" } });
    const server = createServer();
    const gateway = createRealtimeGateway(server, {
      admission: {
        policy: {
          httpRequestsPerMinute: 10000,
          engineRequestsPerMinute: 10000,
          socketConnectionsPerMinute: 10000,
          socketEventsPerMinute: 10000,
          maxHttpInFlight: 100,
          maxEngineInFlight: 100,
          maxConnections: 100,
          maxPendingPerSocket: 100,
          maxPendingTotal: 1000,
          maxSubscriptions: 10,
        },
        ip: async () => ({ allowed: true }),
        trustedProxies: [],
        production: false,
      },
      presence: {
        port: createPresencePort({ reconnect, resync }),
        heartbeatIntervalMs: 50,
        heartbeatTimeoutMs: 100,
        leaseMs: input.policy.leaseMs,
      },
      delivery: { resync, ackTimeoutMs: 500 },
      sessions: {
        authenticate: async (token) =>
          token === input.token
            ? {
                ok: true,
                session: {
                  schemaVersion: 1,
                  userId: input.userId,
                  sessionId: input.sessionId,
                  expiresAt: input.expiresAt,
                },
              }
            : fail(),
      },
      membership: createMatchMembershipPort(database),
      matches: { command: fail, ready: fail },
      rooms: { read: fail, join: fail, leave: fail, start: fail },
      matchmaking: { search: fail, read: fail, cancel: fail, found: fail, admit: fail },
      rate: async () => ({ allowed: true }),
      allowedOrigins: ["https://mini.example"],
      nowMs: () => Date.now(),
    });
    server.listen(0, "127.0.0.1", () => process.send({ port: server.address().port }));
    process.once("SIGTERM", async () => {
      await gateway.close();
      await database.disconnect();
      process.exit(0);
    });
  } catch {
    process.send({ failed: true });
    process.exit(1);
  }
});
