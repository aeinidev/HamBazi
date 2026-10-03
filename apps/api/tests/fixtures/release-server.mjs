import process from "node:process";
import console from "node:console";
import { createHmac, hash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fork } from "node:child_process";
import { fileURLToPath, URL, URLSearchParams } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { createDatabase } from "@hambazi/database";
import { createErrorEnvelope } from "@hambazi/contracts";
import {
  createAuthSessions,
  createTelegramVerifier,
  createMiniAppOnboarding,
  createRedisAuthRateLimiter,
} from "../../dist/auth/index.js";
import {
  createUserIdentityPort,
  createAccountCreationPort,
  createProfilePort,
  createProfileRate,
  createPublicNamesPort,
} from "../../dist/users/index.js";
import { createRoomsPort, createRoomsRate } from "../../dist/rooms/index.js";
import { createCatalogPort, createCatalogRate } from "../../dist/games/index.js";
import { createStatisticsPort } from "../../dist/leaderboard/index.js";
import {
  createPrivateRoomMatchPort,
  createMatchProcessingPort,
  createMatchMembershipPort,
  createMatchResyncPort,
  createMatchReconnectPort,
  createMatchAdmissionPort,
} from "../../dist/matches/index.js";
import {
  createMatchmaking,
  createRedisMatchmakingQueue,
  createAdmissionCredentials,
} from "../../dist/matchmaking/index.js";
import { createPresencePort } from "../../dist/presence/index.js";
import { createChatPort, createChatRate } from "../../dist/chat/index.js";
import {
  createRedisTransportAdmission,
  createRealtimeConsumer,
} from "../../dist/realtime/index.js";
import { createHttpApplication } from "../../dist/composition/http.js";
import { createCoupMatchGame } from "../../dist/composition/coup-match.js";
import { createSafeLogger } from "../../dist/composition/safe-logger.js";

// Synthetic loopback composition only. No production registry, fabricated Matches,
// implicit readiness, SQL game transitions or browser-only game outcomes.
const namespace = randomUUID();
const origin = "http://127.0.0.1:4173";
const clock = { nowMs: () => Date.now() };
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
const rules = {
  rulesetVersion: "coup-provisional-complete-v1",
  copiesPerRole: 3,
  cardsPerPlayer: 2,
  startingCoins: 2,
  incomeCoins: 1,
  foreignAidCoins: 2,
  coupCost: 7,
  mandatoryCoupAt: 10,
  taxCoins: 3,
  stealCoins: 2,
  assassinationCost: 3,
  actionTimeoutMs: 60000,
  responseTimeoutMs: 30000,
  decisionTimeoutMs: 30000,
};
const botToken = { reveal: () => "123456789:ReleaseFixtureSyntheticBot" };
const signing = {
  issuer: `urn:hambazi:release:${namespace}`,
  audience: "release-mini",
  activeKeyId: "release",
  keys: [{ id: "release", secret: { reveal: () => sessionKey } }],
};
const sessionKey = randomBytes(32).toString("base64url");
const admissionKey = randomBytes(32).toString("base64url");
const closes = [];
let database,
  projectionAudit,
  http,
  control,
  worker,
  timer,
  active,
  stopping = false,
  closing;
let actorSequence = 45000000;
let startupStage = "isolation guard";
const actors = new Set();
let sessions, rooms, resync, processing, privateRooms, matchmaking, chat, admission, dependencies;
const logger = createSafeLogger({ write() {} });
function required(result) {
  if (!result.ok) throw new Error("Release fixture operation failed");
  return result;
}
function lifecycleId(matchId, operation, version) {
  const hex = hash("sha256", JSON.stringify([namespace, matchId, operation, version]));
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
async function lifecycle(matchId, operation, expectedVersion) {
  return processing.lifecycle({
    schemaVersion: 1,
    matchId,
    operation,
    expectedVersion,
    actionId: lifecycleId(matchId, operation, expectedVersion),
  });
}
async function startWorker() {
  if (worker) throw new Error("Release worker already running");
  worker = fork(
    fileURLToPath(new URL("../../../worker/tests/fixtures/release-worker.mjs", import.meta.url)),
    [],
    {
      env: {
        NODE_ENV: "test",
        TEST_DATABASE_CONFIRM: process.env.TEST_DATABASE_CONFIRM,
        TEST_AUTH_DATABASE_READY: process.env.TEST_AUTH_DATABASE_READY,
        TEST_RELEASE_BROWSER: process.env.TEST_RELEASE_BROWSER,
        WORKER_DATABASE_URL: process.env.WORKER_DATABASE_URL,
        TEST_WORKER_REDIS_URL: process.env.TEST_WORKER_REDIS_URL,
        TEST_RELEASE_NAMESPACE: namespace,
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const child = worker;
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Release worker startup deadline")), 10000);
    child.once("message", (message) => {
      clearTimeout(deadline);
      message?.ready === true ? resolve() : reject(new Error("Release worker startup failed"));
    });
    child.once("exit", () => {
      clearTimeout(deadline);
      reject(new Error("Release worker exited"));
    });
    child.once("error", () => {
      clearTimeout(deadline);
      reject(new Error("Release worker unavailable"));
    });
  });
}
async function stopWorker() {
  const child = worker;
  worker = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Release worker drain deadline"));
    }, 8000);
    child.once("exit", (code) => {
      clearTimeout(deadline);
      code === 0 ? resolve() : reject(new Error("Release worker drain failed"));
    });
    child.kill("SIGTERM");
  });
}
async function startHttp() {
  http = await createHttpApplication(dependencies);
  await http.app.listen(4174, "127.0.0.1");
}
async function stopHttp() {
  if (!http) return;
  http.stopAdmission();
  await http.realtime.close();
  await http.app.close();
  await http.settled();
}
async function tick() {
  if (!stopping && http.realtime.ready()) {
    const found = await matchmaking.run({ gameId: "coup", mode: "standard", capacity: 2 });
    if (found.ok && found.value.matchId) await lifecycle(found.value.matchId, "WAIT", 0);
    let cursor;
    for (let page = 0; page < 20; page++) {
      const recovery = await privateRooms.recover({
        schemaVersion: 1,
        limit: 50,
        ...(cursor ? { afterRoomId: cursor } : {}),
      });
      if (!recovery.ok || !recovery.nextRoomId) break;
      cursor = recovery.nextRoomId;
    }
  }
}
async function body(request) {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 8192) throw new Error("Release control input too large");
  }
  return text ? JSON.parse(text) : {};
}
function launch(id, startParam) {
  const fields = {
    auth_date: String(Math.floor(clock.nowMs() / 1000)),
    user: JSON.stringify({ id, first_name: "Synthetic release" }),
    ...(startParam ? { start_param: startParam } : {}),
  };
  const secret = createHmac("sha256", "WebAppData").update(botToken.reveal()).digest();
  const signature = createHmac("sha256", secret)
    .update(
      Object.entries(fields)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    )
    .digest("hex");
  return new URLSearchParams({ ...fields, hash: signature }).toString();
}
async function controlRequest(request) {
  if (request.method === "GET" && request.url === "/health") return { ready: true };
  if (request.method === "POST" && request.url === "/actor") {
    const input = await body(request);
    if (input.startParam !== undefined && !/^room_[A-Za-z0-9_-]{43}$/.test(input.startParam))
      throw new Error("Invalid synthetic invitation");
    const id = ++actorSequence;
    actors.add(id);
    return {
      telegramUserId: id,
      displayName: `Release player ${id}`,
      initData: launch(id, input.startParam),
    };
  }
  if (request.method === "POST" && request.url === "/worker/stop") {
    await stopWorker();
    return { stopped: true };
  }
  if (request.method === "POST" && request.url === "/worker/start") {
    await startWorker();
    return { ready: true };
  }
  if (request.method === "POST" && request.url === "/api/drain") {
    http.stopAdmission();
    return { draining: true };
  }
  if (request.method === "POST" && request.url === "/api/restart") {
    await stopHttp();
    await startHttp();
    return { ready: true };
  }
  const actorMatch = /^\/audit\/actor\/(\d+)$/.exec(request.url);
  if (request.method === "GET" && actorMatch && actors.has(Number(actorMatch[1]))) {
    const identity = await createUserIdentityPort(database).findActiveByTelegramId(actorMatch[1]);
    const userId = identity?.userId;
    return {
      userId: userId ?? null,
      matches: userId
        ? await database.forModule("matches").execute((db) =>
            db.match.findMany({
              where: { players: { some: { userId } } },
              select: { id: true, status: true, stateVersion: true },
            }),
          )
        : [],
      rooms: userId
        ? await database
            .forModule("rooms")
            .execute((db) => db.room.count({ where: { hostUserId: userId } }))
        : 0,
    };
  }
  const match = /^\/audit\/match\/([a-f0-9-]{36})$/.exec(request.url);
  if (request.method === "GET" && match) {
    const matchId = match[1];
    const durable = await database.forModule("matches").execute(async (db) => {
      const row = await db.match.findUniqueOrThrow({
        where: { id: matchId },
        select: {
          id: true,
          roomId: true,
          matchType: true,
          status: true,
          stateVersion: true,
          lastEventSeq: true,
        },
      });
      return {
        ...row,
        seats: await db.matchPlayer.count({ where: { matchId } }),
        events: await db.gameEvent.count({ where: { matchId } }),
        commands: await db.processedCommand.count({ where: { matchId } }),
        results: await db.matchResult.count({ where: { matchId } }),
        resultSeats: await db.gameResult.count({ where: { matchId } }),
        finishEvents: await db.outboxEvent.count({
          where: { aggregateId: matchId, type: "MATCH_FINISHED_V1" },
        }),
      };
    });
    const applications = await projectionAudit
      .forModule("leaderboard")
      .execute((db) => db.statsApplication.count({ where: { matchId } }));
    const room = durable.roomId ? await rooms.startSnapshot(durable.roomId) : null;
    return { ...durable, applications, roomStatus: room?.ok ? room.snapshot.status : null };
  }
  throw new Error("Unknown release control operation");
}
async function main() {
  if (
    process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
    process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed" ||
    process.env.TEST_RELEASE_BROWSER !== "isolated" ||
    !process.env.API_DATABASE_URL ||
    !process.env.WORKER_DATABASE_URL ||
    !process.env.TEST_AUTH_REDIS_URL ||
    !process.env.TEST_WORKER_REDIS_URL
  )
    throw new Error("Use the isolated release harness");
  startupStage = "database isolation";
  const isolated = new URL(process.env.TEST_DATABASE_URL);
  for (const value of [process.env.API_DATABASE_URL, process.env.WORKER_DATABASE_URL]) {
    const url = new URL(value);
    if (
      url.hostname !== "127.0.0.1" ||
      url.host !== isolated.host ||
      url.pathname !== "/hambazi_release" ||
      isolated.pathname !== "/hambazi_release"
    )
      throw new Error("Use the isolated database endpoint");
  }
  database = createDatabase({
    databaseUrl: { reveal: () => process.env.API_DATABASE_URL },
    poolMax: 10,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    transactionMaxWaitMs: 5000,
    transactionTimeoutMs: 5000,
  });
  startupStage = "database connection";
  await database.connect();
  closes.push(() => database.disconnect());
  // Receipt reconciliation uses existing Worker grants; the API role stays read-limited.
  startupStage = "statistics audit connection";
  projectionAudit = createDatabase({
    databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL },
    poolMax: 1,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    transactionMaxWaitMs: 5000,
    transactionTimeoutMs: 5000,
  });
  await projectionAudit.connect();
  closes.push(() => projectionAudit.disconnect());
  startupStage = "auth composition";
  const redisUrl = { reveal: () => process.env.TEST_AUTH_REDIS_URL };
  const users = createUserIdentityPort(database);
  const telegram = createTelegramVerifier(botToken, {
    maxAgeSeconds: 300,
    maxFutureSkewSeconds: 30,
    maxBytes: 4096,
    maxFields: 16,
  });
  sessions = createAuthSessions({
    database,
    users,
    telegram,
    clock,
    lifetimeSeconds: 900,
    signing,
  });
  const onboarding = createMiniAppOnboarding({
    accounts: createAccountCreationPort(database),
    users,
    telegram,
    clock,
  });
  startupStage = "rate composition";
  const authRate = createRedisAuthRateLimiter({
    url: redisUrl,
    namespace,
    ipLimit: 300,
    identityLimit: 30,
  });
  const profileRate = createProfileRate({
    url: redisUrl,
    namespace,
    readLimit: 600,
    writeLimit: 60,
  });
  const catalogRate = createCatalogRate({ url: redisUrl, namespace, readLimit: 600 });
  const roomsRate = createRoomsRate({
    url: redisUrl,
    namespace,
    readLimit: 600,
    createLimit: 60,
    inviteLimit: 60,
  });
  const chatRate = createChatRate({ url: redisUrl, namespace, readLimit: 60, sendLimit: 10 });
  admission = createRedisTransportAdmission({ url: redisUrl, namespace, policy });
  startupStage = "rate connections";
  for (const rate of [authRate, profileRate, catalogRate, roomsRate, chatRate, admission]) {
    await rate.connect();
    closes.push(async () => rate.close());
  }
  startupStage = "game ports";
  const game = createCoupMatchGame(rules);
  const enabled = {
    id: "coup",
    slug: "coup",
    title: "Coup",
    minPlayers: 2,
    maxPlayers: 6,
    status: "ACTIVE",
    playable: true,
    readiness: "NOT_IMPLEMENTED",
    descriptor: null,
    matchmakingModes: [{ id: "standard", title: "Standard" }],
    matchmakingEnabled: true,
    privateRoomsEnabled: true,
    chatEnabled: true,
    voiceEnabled: false,
  };
  const production = required(await createCatalogPort(database).find("coup"));
  if (production.game.playable || production.game.status !== "DISABLED")
    throw new Error("Production baseline must remain disabled");
  const games = {
    list: async () => ({ ok: true, games: [enabled] }),
    find: async (slug) =>
      slug === "coup" ? { ok: true, game: enabled } : createErrorEnvelope("NOT_FOUND"),
  };
  rooms = createRoomsPort(
    database,
    { clock, ttlSeconds: 900 },
    {
      users,
      games,
      invites: {
        target: { botUsername: "HamBaziBot", appName: "play" },
        consume: (id) => roomsRate.consume("invite", id),
      },
    },
  );
  processing = createMatchProcessingPort(database, { clock, games: [game] }, users);
  resync = createMatchResyncPort(database, [game]);
  privateRooms = createPrivateRoomMatchPort(
    database,
    { clock },
    {
      rooms,
      processing,
      users,
      games,
      descriptor: async () => ({
        engineVersion: game.descriptor.engineVersion,
        stateSchemaVersion: game.descriptor.stateSchemaVersion,
        rulesetVersion: game.descriptor.rulesetVersion,
      }),
    },
  );
  const membership = createMatchMembershipPort(database);
  chat = createChatPort(database, {
    clock,
    policy: { messageLimit: 500, pageLimit: 50 },
    rate: chatRate.consume,
    membership,
  });
  const queue = createRedisMatchmakingQueue({
    url: redisUrl,
    namespace,
    reservationMilliseconds: 5000,
    searchLimit: 100,
    readLimit: 600,
    cancelLimit: 100,
    rateWindowMilliseconds: 60000,
  });
  startupStage = "matchmaking connection";
  await queue.connect();
  closes.push(async () => queue.close());
  const credentials = createAdmissionCredentials({
    clock,
    lifetimeSeconds: 60,
    issuer: signing.issuer,
    audience: "release-match",
    activeKeyId: "admission",
    keys: [{ id: "admission", secret: { reveal: () => admissionKey } }],
  });
  matchmaking = createMatchmaking({
    clock,
    authenticate: sessions.authenticate,
    queue: queue.queue,
    credentials,
    matches: createMatchAdmissionPort(
      database,
      { clock, ticketTtlSeconds: 120, reservationTtlSeconds: 5 },
      {
        users,
        games,
        descriptor: async () => ({
          engineVersion: game.descriptor.engineVersion,
          stateSchemaVersion: game.descriptor.stateSchemaVersion,
          rulesetVersion: game.descriptor.rulesetVersion,
        }),
      },
    ),
  });
  const authenticate = async (token) => {
    const result = await sessions.authenticate(token);
    return result.ok ? { ok: true, userId: result.session.userId } : result;
  };
  dependencies = {
    auth: { sessions, telegram, clock, limiter: authRate.limiter, onboarding },
    profile: {
      profile: createProfilePort(database, clock),
      authenticate,
      rate: profileRate.consume,
      degraded() {},
    },
    catalog: { catalog: games, authenticate, rate: catalogRate.consume, degraded() {} },
    rooms: { rooms, authenticate, rate: roomsRate.consume },
    statistics: {
      statistics: createStatisticsPort(database, {
        clock,
        users,
        names: createPublicNamesPort(database),
      }),
      authenticate,
      rate: catalogRate.consume,
    },
    admission: { policy, ip: admission.ip },
    allowedOrigins: [origin],
    trustedProxies: [],
    production: false,
    logger,
    realtime: {
      sessions,
      rooms,
      matches: processing,
      membership,
      matchmaking,
      privateRooms: {
        ...privateRooms,
        ready: async (actor, input, context) => {
          const result = await privateRooms.ready(actor, input, context);
          if (!result.ok) return result;
          // Test-only matcher startup composition: real public lifecycle, explicit readiness.
          const snapshot = required(
            await resync.snapshot(actor, { schemaVersion: 1, matchId: input.matchId }),
          ).value;
          if (snapshot.status === "READY") {
            const started = required(
              await lifecycle(input.matchId, "START", snapshot.stateVersion),
            ).value;
            required(await lifecycle(input.matchId, "ACTIVATE", started.stateVersion));
          }
          return result;
        },
      },
      chat: { port: chat, ackTimeoutMs: 2000 },
      delivery: { resync, ackTimeoutMs: 2000 },
      presence: {
        port: createPresencePort({
          resync,
          reconnect: createMatchReconnectPort(database, {
            clock,
            policy: { schemaVersion: 1, leaseMs: 15000, graceMs: 60000, maxConnections: 4 },
          }),
        }),
        heartbeatIntervalMs: 1000,
        heartbeatTimeoutMs: 5000,
        leaseMs: 15000,
      },
      admission: { policy, ip: admission.ip, production: false, trustedProxies: [] },
      rate: admission.rate,
      allowedOrigins: [origin],
      nowMs: clock.nowMs,
    },
  };
  startupStage = "HTTP composition";
  await startHttp();
  startupStage = "realtime consumers";
  for (const kind of ["MATCH_CHANGED_V1", "CHAT_MESSAGE_V1"]) {
    const consumer = createRealtimeConsumer({
      kind,
      redisUrl,
      namespace,
      publish: (event) =>
        kind === "CHAT_MESSAGE_V1"
          ? http.realtime.publishChat(event)
          : http.realtime.publish(event),
      unavailable() {},
      drainTimeoutMs: 5000,
    });
    closes.push(() => consumer.close());
    await consumer.ready();
  }
  startupStage = "Worker composition";
  await startWorker();
  const schedule = () => {
    if (stopping) return;
    active = tick()
      .catch(() => {})
      .finally(() => {
        active = undefined;
        if (!stopping) timer = setTimeout(schedule, 100);
      });
  };
  schedule();
  startupStage = "control listener";
  control = createServer((request, response) => {
    void controlRequest(request).then(
      (value) => {
        response.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify(value));
      },
      () => {
        response.writeHead(400, { "content-type": "application/json" });
        response.end('{"error":"RELEASE_CONTROL_FAILED"}');
      },
    );
  });
  await new Promise((resolve, reject) => {
    control.once("error", reject);
    control.listen(4176, "127.0.0.1", resolve);
  });
}
async function close() {
  return (closing ??= (async () => {
    stopping = true;
    clearTimeout(timer);
    await active;
    http?.stopAdmission();
    const failures = [];
    const attempt = async (stop) => {
      try {
        await stop();
      } catch {
        failures.push(true);
      }
    };
    if (control)
      await attempt(
        () =>
          new Promise((resolve) => {
            control.close(resolve);
            control.closeAllConnections();
          }),
      );
    await attempt(stopWorker);
    await attempt(stopHttp);
    for (const stop of closes.splice(1).reverse()) await attempt(stop);
    if (closes[0]) await attempt(closes[0]);
    await attempt(logger.close);
    if (failures.length) throw new Error("Release fixture cleanup failed");
  })());
}
process.once("SIGTERM", () => {
  void close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
});
process.once("SIGINT", () => {
  void close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
});
void main().catch(async () => {
  console.error(`RELEASE_FIXTURE_FAILED at ${startupStage}`);
  await close().catch(() => {});
  process.exit(1);
});
