import process from "node:process";
import console from "node:console";
import { createHmac, hash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fork } from "node:child_process";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Session } from "node:inspector/promises";
import { createClient } from "redis";
import { Queue } from "bullmq";
import { createRequire } from "node:module";
import { fileURLToPath, URL, URLSearchParams } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { createDatabase } from "@hambazi/database";
import {
  observeCapacityDatabase,
  observeCapacityPgClient,
  observeCapacityPgPool,
  createCapacityDeliveryObservation,
  capacityCpuSummary,
  capacityFailureKey,
  observeCapacityOutcome,
  observeCapacityAdmissionRedis,
  observeCapacityGame,
  capacityAutomationObservation,
  capacityDeliveryActivity,
} from "../../../../infra/scripts/capacity-diagnostics.mjs";
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
import {
  capacityFixtureLimits,
  capacityFixturePresencePolicy,
} from "../../../../infra/scripts/capacity-model.mjs";

// Synthetic loopback composition only. No production registry, fabricated Matches,
// implicit readiness, SQL game transitions or browser-only game outcomes.
const namespace = randomUUID();
const origin = "http://127.0.0.1:4173";
const clock = { nowMs: () => Date.now() };
const capacity = process.env.TEST_CAPACITY_MODE === "isolated";
const dispatchObservation = createCapacityDeliveryObservation();
const cpuProfileEnabled = capacity && process.env.TEST_CAPACITY_CPU_PROFILE === "isolated";
let cpuSession,
  cpuTimer,
  cpuResult,
  cpuArmed = false;
async function stopCpuProfile() {
  cpuArmed = false;
  clearTimeout(cpuTimer);
  if (!cpuSession) return;
  const session = cpuSession;
  cpuSession = null;
  try {
    const { profile } = await session.post("Profiler.stop");
    // Raw profiles never leave memory: only fixed aggregate bucket counts escape.
    cpuResult = capacityCpuSummary(profile);
  } finally {
    session.disconnect();
  }
}
const presencePolicy = capacity
  ? capacityFixturePresencePolicy
  : {
      heartbeatIntervalMs: 1000,
      heartbeatTimeoutMs: 5000,
      leaseMs: 15000,
      graceMs: 60000,
      maxConnections: 4,
    };
const policy = capacity
  ? capacityFixtureLimits(Number(process.env.TEST_CAPACITY_CCU))
  : {
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
  gameObservation,
  queryObservation,
  projectionAudit,
  http,
  control,
  worker,
  timer,
  recoveryTimer,
  recoveryWork,
  recoveryCursor,
  active,
  stopping = false,
  closing;
let actorSequence = 45000000;
let startupStage = "isolation guard";
const actors = new Set();
const loopDelay = capacity ? monitorEventLoopDelay({ resolution: 20 }) : null;
loopDelay?.enable();
let sessions, rooms, resync, processing, privateRooms, matchmaking, chat, admission, dependencies;
let capacityDeliveryQueue;
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
        ...(capacity ? { TEST_CAPACITY_MODE: "isolated" } : {}),
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const child = worker;
  if (capacity)
    child.on("message", (message) => {
      if (capacityFailureKey(message))
        process.send?.({ ...message, type: "capacity-worker-failure" });
      if (capacityAutomationObservation(message)) process.send?.(message);
      if (
        message?.type === "capacity-outbox" &&
        [
          "worker.outbox_published",
          "worker.outbox_retry",
          "worker.outbox_failed",
          "worker.outbox_unavailable",
        ].includes(message.name)
      )
        process.send?.({ type: "capacity-outbox", name: message.name });
    });
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
  try {
    await http.realtime.close();
  } finally {
    // A timed-out close is not cancellation. Do not dispose the database/Redis
    // beneath the still-running durable disconnects; retain the deadline error.
    await http.realtime.settled();
    await http.app.close();
    await http.settled();
  }
}
async function tick() {
  if (!stopping && http.realtime.ready()) {
    const found = await matchmaking.run({ gameId: "coup", mode: "standard", capacity: 2 });
    if (found.ok && found.value.matchId) await lifecycle(found.value.matchId, "WAIT", 0);
    let cursor;
    // Capacity recovery uses its own bounded scheduler below, so growing Room
    // inventory cannot delay every matchmaking tick with a full sweep.
    for (let page = 0; !capacity && page < 20; page++) {
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
  if (capacity && request.method === "POST" && request.url === "/actor/refresh") {
    const input = await body(request);
    if (!actors.has(input.telegramUserId)) throw new Error("Unknown synthetic actor");
    return { initData: launch(input.telegramUserId) };
  }
  if (capacity && request.method === "GET" && request.url === "/capacity/metrics") {
    return {
      rssBytes: process.memoryUsage().rss,
      heapUsedBytes: process.memoryUsage().heapUsed,
      eventLoopP99Ms: loopDelay.percentile(99) / 1e6,
      eventLoopMaxMs: loopDelay.max / 1e6,
      cpuUserMicros: process.cpuUsage().user,
      cpuSystemMicros: process.cpuUsage().system,
      pool: database.poolSnapshot(),
      databaseWork: database.capacityWorkSnapshot(),
      ...(process.env.TEST_CAPACITY_QUERY_WORK === "isolated"
        ? { databaseQueryWork: queryObservation.snapshot() }
        : {}),
      realtimeWork: http.realtime.workSnapshot(),
    };
  }
  if (capacity && request.method === "GET" && request.url === "/capacity/dispatch") {
    return {
      ...dispatchObservation.result(),
      gameWork: gameObservation.result(),
      ...(cpuResult ? { cpu: cpuResult } : {}),
    };
  }
  if (cpuProfileEnabled && request.method === "POST" && request.url === "/capacity/cpu/start") {
    if (cpuArmed || cpuSession || cpuResult) throw new Error("Capacity profile already started");
    cpuArmed = true;
    async function startOnBacklog() {
      if (!cpuArmed || stopping) return;
      const work = http.realtime.workSnapshot();
      if (!Object.values(work.phases).some((phase) => phase.maximumAgeMs >= 2000)) {
        cpuTimer = setTimeout(() => void startOnBacklog().catch(() => {}), 500);
        return;
      }
      cpuArmed = false;
      cpuSession = new Session();
      cpuSession.connect(); // Same-process session only; no debug listener/port.
      await cpuSession.post("Profiler.enable");
      await cpuSession.post("Profiler.start");
      cpuTimer = setTimeout(() => {
        void stopCpuProfile().catch(() => {});
      }, 10000);
    }
    void startOnBacklog().catch(() => {});
    closes.push(stopCpuProfile);
    return { armed: true };
  }
  if (capacity && request.method === "POST" && request.url === "/audit/commands") {
    const input = await body(request);
    if (
      !/^[a-f0-9-]{36}$/.test(input.matchId) ||
      !Array.isArray(input.actionIds) ||
      input.actionIds.length > 100 ||
      input.actionIds.some((id) => !/^[a-f0-9-]{36}$/.test(id))
    )
      throw new Error("Invalid capacity audit");
    return database.forModule("matches").execute((db) =>
      db.processedCommand.findMany({
        where: { matchId: input.matchId, actionId: { in: input.actionIds } },
        select: { actionId: true, resultingVersion: true },
      }),
    );
  }
  if (capacity && request.method === "POST" && request.url === "/capacity/wait") {
    const input = await body(request);
    if (!/^[a-f0-9-]{36}$/.test(input.matchId) || !Number.isSafeInteger(input.version))
      throw new Error("Invalid capacity wait audit");
    const durable = await database.forModule("matches").execute(async (db) => {
      const row = await db.match.findUniqueOrThrow({
        where: { id: input.matchId },
        select: { stateVersion: true },
      });
      const events = await db.outboxEvent.findMany({
        where: { aggregateId: input.matchId, type: "MATCH_CHANGED_V1" },
        select: { status: true, attempts: true },
      });
      return {
        durableVersionLag: row.stateVersion - input.version,
        pending: events.filter((e) => e.status === "PENDING").length,
        published: events.filter((e) => e.status === "PUBLISHED").length,
        failed: events.filter((e) => e.status === "FAILED").length,
        maximumAttempts: Math.max(0, ...events.map((e) => e.attempts)),
      };
    });
    const counts = await capacityDeliveryQueue.getJobCounts("wait", "active", "delayed", "failed");
    const [oldest] = await capacityDeliveryQueue.getJobs(["wait"], 0, 0, true);
    const activeJobs = await capacityDeliveryQueue.getJobs(["active"], 0, 99, true);
    return {
      ...durable,
      deliveryQueue: {
        waiting: counts.wait,
        active: counts.active,
        delayed: counts.delayed,
        failed: counts.failed,
        oldestWaitingAgeMs: oldest ? Math.max(0, Date.now() - oldest.timestamp) : 0,
        ...capacityDeliveryActivity(activeJobs, Date.now()),
      },
    };
  }
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
  if (capacity && request.method === "POST" && request.url === "/capacity/drain") {
    await stopHttp();
    return { drained: true };
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
  if (capacity) {
    const pg = createRequire(
      new URL("../../../../packages/database/package.json", import.meta.url),
    )("pg");
    queryObservation = observeCapacityPgClient(pg.Client, (message) => process.send?.(message), {
      work: process.env.TEST_CAPACITY_QUERY_WORK === "isolated",
    });
    closes.push(queryObservation);
    let firstPoolTimeout = true;
    closes.push(
      observeCapacityPgPool(pg.Pool, (message) => {
        if (firstPoolTimeout && message.code === "PG_POOL_ACQUIRE_TIMEOUT") {
          firstPoolTimeout = false;
          process.send?.(
            {
              type: "capacity-database-work",
              work: database.capacityWorkSnapshot(),
              pool: database.poolSnapshot(),
              gameWork: gameObservation?.result(),
            },
            () => {},
          );
        }
        process.send?.(message, () => {});
      }),
    );
  }
  if (capacity) database = observeCapacityDatabase(database, (message) => process.send?.(message));
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
  if (capacity)
    sessions = {
      ...sessions,
      authenticate: observeCapacityOutcome(
        "auth",
        "session:authenticate",
        sessions.authenticate,
        (message) => process.send?.(message, () => {}),
      ),
    };
  const onboarding = createMiniAppOnboarding({
    accounts: createAccountCreationPort(database),
    users,
    telegram,
    clock,
  });
  startupStage = "rate composition";
  if (capacity) {
    const prototype = Object.getPrototypeOf(Object.getPrototypeOf(createClient()));
    closes.push(observeCapacityAdmissionRedis(prototype, (message) => process.send?.(message)));
  }
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
  const baseRoomsRate = createRoomsRate({
    url: redisUrl,
    namespace,
    readLimit: 600,
    createLimit: 60,
    inviteLimit: 60,
  });
  const roomsRate = capacity
    ? {
        ...baseRoomsRate,
        async consume(operation, userId) {
          const decision = await baseRoomsRate.consume(operation, userId);
          if (!decision.allowed)
            process.send?.({
              type: "capacity-failure",
              owner: "rooms",
              operation: `rate:${operation}`,
              code: decision.reason === "unavailable" ? "RATE_UNAVAILABLE" : "RATE_LIMITED",
            });
          return decision;
        },
      }
    : baseRoomsRate;
  const chatRate = createChatRate({ url: redisUrl, namespace, readLimit: 60, sendLimit: 10 });
  admission = createRedisTransportAdmission({ url: redisUrl, namespace, policy });
  startupStage = "rate connections";
  for (const rate of [authRate, profileRate, catalogRate, roomsRate, chatRate, admission]) {
    await rate.connect();
    closes.push(async () => rate.close());
  }
  startupStage = "game ports";
  let game = createCoupMatchGame(rules);
  if (capacity) {
    gameObservation = observeCapacityGame(game);
    game = gameObservation.game;
  }
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
  if (capacity) {
    const emit = (message) => process.send?.(message, () => {});
    resync = {
      snapshot: observeCapacityOutcome("matches", "projection:snapshot", resync.snapshot, emit),
      catchup: observeCapacityOutcome("matches", "projection:catchup", resync.catchup, emit),
    };
  }
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
  let reconnect = createMatchReconnectPort(database, {
    clock,
    policy: {
      schemaVersion: 1,
      leaseMs: presencePolicy.leaseMs,
      graceMs: presencePolicy.graceMs,
      maxConnections: presencePolicy.maxConnections,
    },
  });
  if (capacity)
    reconnect = Object.fromEntries(
      ["connect", "renew", "disconnect", "reconcile", "timeout"].map((operation) => [
        operation,
        observeCapacityOutcome(
          "matches",
          `reconnect:${operation}`,
          reconnect[operation],
          (message) => process.send?.(message, () => {}),
        ),
      ]),
    );
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
      ...(capacity ? { execution: { intentConcurrency: 4, disconnectConcurrency: 4 } } : {}),
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
          reconnect,
        }),
        heartbeatIntervalMs: presencePolicy.heartbeatIntervalMs,
        heartbeatTimeoutMs: presencePolicy.heartbeatTimeoutMs,
        leaseMs: presencePolicy.leaseMs,
        ...(capacity ? { heartbeatConcurrency: 4 } : {}),
      },
      admission: { policy, ip: admission.ip, production: false, trustedProxies: [] },
      rate: capacity
        ? (id, operation) =>
            observeCapacityOutcome("realtime", `rate:${operation}`, admission.rate, (message) =>
              process.send?.(message, () => {}),
            )(id, operation)
        : admission.rate,
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
          : capacity
            ? dispatchObservation.publish((input) => http.realtime.publish(input), event)
            : http.realtime.publish(event),
      unavailable() {},
      drainTimeoutMs: 5000,
      ...(capacity && kind === "MATCH_CHANGED_V1" ? { concurrency: 4 } : {}),
    });
    closes.push(() => consumer.close());
    await consumer.ready();
  }
  startupStage = "Worker composition";
  if (capacity) {
    const url = new URL(process.env.TEST_AUTH_REDIS_URL);
    capacityDeliveryQueue = new Queue("match-changed-v1", {
      prefix: `hambazi:jobs:${namespace}`,
      connection: {
        host: url.hostname,
        port: Number(url.port),
        username: url.username,
        password: url.password,
        maxRetriesPerRequest: 0,
      },
    });
    closes.push(() => capacityDeliveryQueue.close());
  }
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
  if (capacity) {
    const recover = () => {
      if (stopping) return;
      recoveryWork = privateRooms
        .recover({
          schemaVersion: 1,
          limit: 50,
          ...(recoveryCursor ? { afterRoomId: recoveryCursor } : {}),
        })
        .then((result) => {
          if (result.ok) recoveryCursor = result.nextRoomId;
        })
        .catch(() => {})
        .finally(() => {
          recoveryWork = undefined;
          if (!stopping) recoveryTimer = setTimeout(recover, 1000);
        });
    };
    recoveryTimer = setTimeout(recover, 1000);
  }
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
  if (capacity) process.send?.({ ready: true });
}
async function close() {
  return (closing ??= (async () => {
    stopping = true;
    loopDelay?.disable();
    clearTimeout(timer);
    clearTimeout(recoveryTimer);
    await active;
    await recoveryWork;
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
