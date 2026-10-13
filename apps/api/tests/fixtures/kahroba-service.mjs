import { Buffer } from "node:buffer";
import process from "node:process";
import { createServer } from "node:http";
import { once } from "node:events";
import { createDatabase } from "@hambazi/database";
import { createKahrobaMatchGame } from "../../dist/index.js";
import { createAuthSessions } from "../../dist/auth/index.js";
import { createUserIdentityPort } from "../../dist/users/index.js";
import {
  createMatchProcessingPort,
  createMatchMembershipPort,
  createMatchResyncPort,
  createMatchReconnectPort,
} from "../../dist/matches/index.js";
import { createPresencePort } from "../../dist/presence/index.js";
import { createRealtimeGateway } from "../../dist/realtime/index.js";
if (
  process.env.TEST_KAHROBA_RUN !== "isolated-k2" ||
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test"
)
  throw new Error("Disposable harness required");
const database = createDatabase({
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL },
  poolMax: 8,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 10000,
});
await database.connect();
const clock = { nowMs: () => Date.now() },
  users = createUserIdentityPort(database);
const game = createKahrobaMatchGame({
  rulesetVersion: "kahroba-base-v1",
  datasetVersion: "kahroba-economy-v1",
  turnDurationMs: null,
  timeoutPolicyVersion: null,
});
const sessions = createAuthSessions({
  database,
  users,
  clock,
  lifetimeSeconds: 900,
  telegram: { verify: () => ({ ok: false, code: "TELEGRAM_AUTH_INVALID" }) },
  signing: {
    issuer: "kahroba-local",
    audience: "mini",
    activeKeyId: "test",
    keys: [{ id: "test", secret: { reveal: () => Buffer.alloc(32, 73).toString("base64url") } }],
  },
});
const resync = createMatchResyncPort(database, [game]);
const reconnect = createMatchReconnectPort(database, {
  clock,
  policy: { schemaVersion: 1, leaseMs: 30000, graceMs: 30000, maxConnections: 4 },
});
const policy = {
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
};
const server = createServer();
const gateway = createRealtimeGateway(server, {
  sessions,
  matches: createMatchProcessingPort(database, { clock, games: [game] }, users),
  membership: createMatchMembershipPort(database),
  rooms: {},
  matchmaking: {},
  allowedOrigins: ["https://mini.example"],
  nowMs: clock.nowMs,
  rate: async () => ({ allowed: true }),
  admission: { policy, ip: async () => ({ allowed: true }), trustedProxies: [], production: false },
  delivery: { ackTimeoutMs: 1000, resync },
  presence: {
    port: createPresencePort({ reconnect, resync }),
    heartbeatIntervalMs: 500,
    heartbeatTimeoutMs: 500,
    leaseMs: 30000,
  },
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
process.send?.({ ready: true, port: server.address().port });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await gateway.close();
  if (server.listening) await new Promise((r) => server.close(r));
  await database.disconnect();
  process.exit(0);
}
process.on("message", (m) => {
  if (m === "close") void close();
});
process.on("disconnect", () => void close());
