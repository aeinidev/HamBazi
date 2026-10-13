import { beforeAll, afterAll, it, expect } from "vitest";
import { createDatabase } from "@hambazi/database";
import { createAccountCreationPort, createRegistrationPort } from "../../dist/users/index.js";
import { kahrobaBotPolicy } from "@hambazi/kahroba-engine";
import { installSharedFinalRound } from "../fixtures/kahroba.ts";
import { createHmac, randomBytes, randomUUID, randomInt } from "node:crypto";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, URL, URLSearchParams } from "node:url";
import process from "node:process";
import { setTimeout } from "node:timers";
const { fetch } = globalThis;
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { io } from "socket.io-client";

if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  process.env.TEST_KAHROBA_RUNTIME !== "isolated-k4a"
)
  throw new Error("Use the disposable --runtime harness");
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const webRequire = createRequire(join(root, "apps/web/package.json"));
const playwright = await import(webRequire.resolve("@playwright/test"));
const db = createDatabase({
  databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL },
  poolMax: 8,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 10000,
});
const artifacts = join(root, "test-results/kahroba-k4a");
beforeAll(async () => {
  await db.connect();
  await mkdir(artifacts, { recursive: true });
  await db.forModule("games").execute((d) =>
    d.game.upsert({
      where: { id: "kahroba" },
      update: {},
      create: {
        id: "kahroba",
        slug: "kahroba",
        title: "کهربا",
        minPlayers: 2,
        maxPlayers: 4,
        status: "DISABLED",
        configSchemaVersion: 1,
        configJsonb: {},
        matchmakingEnabled: false,
        privateRoomsEnabled: false,
        chatEnabled: false,
        voiceEnabled: false,
      },
    }),
  );
});
afterAll(() => db.disconnect());
async function port() {
  const s = createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch {
      /* Bounded readiness retry for owned local processes. */
    }
    await delay(100);
  }
  throw new Error("Local runtime condition timed out");
}
function loopback(value) {
  const u = new URL(value);
  u.hostname = "127.0.0.1";
  return u.toString();
}
function launch(entry, env) {
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (b) => {
      if (output.length < 131072) output += b.toString();
    });
  return {
    child,
    async close() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), delay(20000)]);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
    },
  };
}
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "kahroba-k4a-runtime-")),
    apiPort = await port(),
    webPort = await port(),
    apiHealth = await port(),
    workerHealth = await port(),
    namespace = `k4a-${randomUUID()}`;
  const telegramIds = Array.from({ length: 4 }, (_, i) =>
    String(700000000000 + randomInt(100000000) + i),
  );
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const account = await createAccountCreationPort(db).createForVerifiedTelegramIdentity(
      telegramIds[i],
      `Local actor ${i + 1}`,
    );
    if (!account.ok) throw new Error("Local account bootstrap failed");
    const registered = await createRegistrationPort(db, { nowMs: () => Date.now() }).complete(
      telegramIds[i],
      `K4 actor ${i + 1}`,
    );
    if (!registered.ok) throw new Error("Local registration bootstrap failed");
    ids.push(account.account.userId);
  }
  const admissionFile = join(dir, "admission.json");
  await writeFile(
    admissionFile,
    JSON.stringify({
      schemaVersion: 1,
      purpose: "kahroba-local-synthetic-only",
      telegramUserIds: telegramIds,
    }),
    { mode: 0o600, flag: "wx" },
  );
  const botToken = `123456:${randomBytes(32).toString("base64url")}`,
    key = randomBytes(32).toString("base64url"),
    origin = `http://127.0.0.1:${webPort}`,
    apiOrigin = `http://127.0.0.1:${apiPort}`;
  const env = {
    ...process.env,
    NODE_ENV: "test",
    API_DATABASE_URL: loopback(process.env.API_DATABASE_URL),
    WORKER_DATABASE_URL: loopback(process.env.WORKER_DATABASE_URL),
    API_REDIS_URL: process.env.TEST_AUTH_REDIS_URL,
    WORKER_REDIS_URL: process.env.TEST_WORKER_REDIS_URL,
    API_PORT: String(apiPort),
    API_BIND_ADDRESS: "127.0.0.1",
    API_TRUSTED_PROXIES: "",
    ALLOWED_ORIGINS: origin,
    TELEGRAM_BOT_TOKEN: botToken,
    AUTH_SESSION_SECONDS: "900",
    AUTH_TELEGRAM_MAX_AGE_SECONDS: "300",
    AUTH_TELEGRAM_FUTURE_SKEW_SECONDS: "5",
    AUTH_IP_LIMIT: "300",
    AUTH_IDENTITY_LIMIT: "30",
    AUTH_ACTIVE_KEY_ID: "local",
    AUTH_SIGNING_KEYS: JSON.stringify([{ id: "local", secret: key }]),
    AUTH_ISSUER: namespace,
    AUTH_AUDIENCE: "mini",
    API_DB_POOL_MAX: "8",
    PROFILE_READ_LIMIT: "300",
    PROFILE_WRITE_LIMIT: "30",
    CATALOG_READ_LIMIT: "300",
    ROOM_TTL_SECONDS: "900",
    ROOM_READ_LIMIT: "300",
    ROOM_CREATE_LIMIT: "30",
    ROOM_BOT_USERNAME: "LocalKahrobaBot",
    ROOM_APP_NAME: "play",
    ROOM_INVITE_LIMIT: "300",
    BOT_INTERNAL_ENABLED: "false",
    KAHROBA_RUNTIME_PROFILE: "local-private-v1",
    KAHROBA_ENGINE_REGISTERED: "true",
    KAHROBA_RUNTIME_ENABLED: "true",
    KAHROBA_ROUTES_ENABLED: "true",
    KAHROBA_ADMISSION_ENABLED: "true",
    KAHROBA_QUEUE_NAMESPACE: namespace,
    KAHROBA_RECONNECT_LEASE_MS: "30000",
    KAHROBA_RECONNECT_GRACE_MS: "30000",
    KAHROBA_LOCAL_ADMISSION_FILE: admissionFile,
    WORKER_QUEUE_NAMESPACE: namespace,
    WORKER_DB_POOL_MAX: "8",
    BOT_CLEANUP_INTERVAL_MS: "3600000",
    BOT_CLEANUP_BATCH_SIZE: "10",
    BOT_CLEANUP_ATTEMPTS: "3",
    BOT_CLEANUP_BACKOFF_MS: "1000",
    STATS_ENABLED: "true",
    STATS_CONCURRENCY: "1",
    STATS_DRAIN_TIMEOUT_MS: "15000",
    MATCH_OUTBOX_ENABLED: "true",
    MATCH_OUTBOX_INTERVAL_MS: "100",
    MATCH_OUTBOX_BATCH_SIZE: "10",
    MATCH_OUTBOX_LEASE_MS: "10000",
    MATCH_OUTBOX_ATTEMPTS: "5",
    MATCH_OUTBOX_BACKOFF_MS: "100",
    MATCH_OUTBOX_MAX_BACKOFF_MS: "1000",
    MATCH_OUTBOX_PUBLISH_TIMEOUT_MS: "2000",
    API_HEALTH_PORT: String(apiHealth),
    WORKER_HEALTH_PORT: String(workerHealth),
    API_HEALTH_PROBE_TIMEOUT_MS: "5000",
    WORKER_HEALTH_PROBE_TIMEOUT_MS: "5000",
  };
  for (const [k, v] of Object.entries({
    ADMISSION_HTTP_PER_MINUTE: "6000",
    ADMISSION_ENGINE_PER_MINUTE: "6000",
    ADMISSION_CONNECT_PER_MINUTE: "1000",
    ADMISSION_EVENT_PER_MINUTE: "6000",
    ADMISSION_HTTP_IN_FLIGHT: "100",
    ADMISSION_ENGINE_IN_FLIGHT: "100",
    ADMISSION_CONNECTIONS: "100",
    ADMISSION_PENDING_PER_SOCKET: "10",
    ADMISSION_PENDING_TOTAL: "100",
    ADMISSION_SUBSCRIPTIONS: "10",
  }))
    env[k] = v;
  const workers = launch(join(root, "apps/worker/dist/composition/main.js"), env);
  let api, web;
  const clients = [];
  try {
    await until(async () => (await fetch(`http://127.0.0.1:${workerHealth}/v1/health/ready`)).ok);
    const workerReadyAt = new Date().toISOString();
    api = launch(join(root, "apps/api/dist/composition/main.js"), env);
    await until(async () => (await fetch(`${apiOrigin}/v1/me`)).status === 401);
    await until(async () => (await fetch(`http://127.0.0.1:${apiHealth}/v1/health/ready`)).ok);
    const launches = telegramIds.map((id, i) => {
      const p = new URLSearchParams({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({
          id: Number(id),
          first_name: `Local ${i + 1}`,
          username: `k4local${i + 1}`,
        }),
      });
      const data = [...p]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([a, b]) => `${a}=${b}`)
        .join("\n");
      p.set(
        "hash",
        createHmac("sha256", createHmac("sha256", "WebAppData").update(botToken).digest())
          .update(data)
          .digest("hex"),
      );
      return p.toString();
    });
    const tokens = [];
    for (const initData of launches) {
      const r = await fetch(`${apiOrigin}/v1/auth/telegram-mini-app/registered-session-photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ schemaVersion: 1, commandId: randomUUID(), initData }),
      });
      const result = await r.json();
      if (r.status !== 200 || !result.accessToken)
        throw new Error("Signed local authentication failed");
      tokens.push(result.accessToken);
    }
    async function http(index, path, body) {
      const r = await fetch(apiOrigin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${tokens[index]}`,
          Origin: origin,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, data: await r.json() };
    }
    async function connect(index) {
      const c = io(`${apiOrigin}/kahroba-v1`, {
        path: "/v1/kahroba/socket.io",
        transports: ["websocket"],
        reconnection: false,
        auth: { schemaVersion: 1, accessToken: tokens[index] },
        extraHeaders: { Origin: origin },
      });
      clients.push(c);
      await Promise.race([
        once(c, "connect"),
        once(c, "connect_error").then(() => {
          throw new Error("Authenticated local socket failed");
        }),
        delay(10000).then(() => {
          throw new Error("Local socket timeout");
        }),
      ]);
      c.on("match:snapshot", (s, ack) => ack?.(s.lastEventSeq));
      return c;
    }
    async function request(c, event, input) {
      return c.timeout(10000).emitWithAck(event, input);
    }
    async function snapshot(c, matchId) {
      const r = await request(c, "match:snapshot", { schemaVersion: 1, matchId });
      if (!r.ok) throw new Error("Local snapshot unavailable");
      return r.value;
    }
    async function stored(matchId) {
      return db
        .forModule("matches")
        .execute((d) => d.match.findUniqueOrThrow({ where: { id: matchId } }));
    }
    async function command(c, matchId, intent) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const s = await snapshot(c, matchId);
        const input = {
          schemaVersion: 1,
          actionId: randomUUID(),
          matchId,
          expectedVersion: s.stateVersion,
          command: intent,
        };
        const result = await request(c, "game:command", input);
        if (result.ok) return { input, result };
        if (result.error.code !== "GAME_STATE_CONFLICT")
          throw new Error(`Local command failed: ${result.error.code}`);
      }
      throw new Error("Local command failed: GAME_STATE_CONFLICT");
    }
    async function browserStart() {
      const vite = join(dirname(webRequire.resolve("vite/package.json")), "bin/vite.js");
      web = spawn(
        process.execPath,
        [vite, "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
        {
          cwd: join(root, "apps/web"),
          env: {
            ...process.env,
            NODE_ENV: "development",
            VITE_API_ORIGIN: apiOrigin,
            VITE_KAHROBA_RUNTIME: "true",
          },
          stdio: "ignore",
        },
      );
      await until(async () => (await fetch(origin)).ok);
    }
    return {
      dir,
      env,
      ids,
      telegramIds,
      tokens,
      launches,
      origin,
      apiOrigin,
      clients,
      http,
      connect,
      request,
      snapshot,
      stored,
      command,
      browserStart,
      workerReadyAt,
      async restart(admission = false) {
        for (const c of clients) c.disconnect();
        await api.close();
        api = launch(join(root, "apps/api/dist/composition/main.js"), {
          ...env,
          KAHROBA_ADMISSION_ENABLED: String(admission),
        });
        await until(async () => (await fetch(`${apiOrigin}/v1/me`)).status === 401);
        await until(async () => (await fetch(`http://127.0.0.1:${apiHealth}/v1/health/ready`)).ok);
      },
      async close() {
        for (const c of clients) c.disconnect();
        if (web) {
          web.kill("SIGTERM");
          await Promise.race([once(web, "exit"), delay(5000)]);
        }
        await api?.close();
        await workers.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await api?.close();
    await workers.close();
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
async function roomGame(f, count) {
  const created = await f.http(0, "/v1/kahroba/rooms", {
    schemaVersion: 1,
    commandId: randomUUID(),
    gameId: "kahroba",
    capacity: count,
  });
  if (created.status !== 201) throw new Error("Private room creation failed");
  const id = created.data.roomId,
    shared = await f.http(0, `/v1/kahroba/rooms/${id}/invite`),
    sockets = [];
  for (let i = 0; i < count; i++) sockets.push(await f.connect(i));
  for (let i = 1; i < count; i++) {
    const preview = await f.http(i, "/v1/kahroba/room-invites/resolve", {
      schemaVersion: 1,
      startParam: shared.data.invite.startParam,
    });
    const r = await f.request(sockets[i], "room:join", {
      schemaVersion: 1,
      commandId: randomUUID(),
      roomId: id,
      expectedVersion: preview.data.room.version,
      inviteCode: shared.data.invite.startParam.slice(5),
    });
    if (!r.ok) throw new Error("Private join failed");
  }
  const room = (await f.http(0, `/v1/kahroba/rooms/${id}`)).data.room;
  const started = await f.request(sockets[0], "room:start", {
    schemaVersion: 1,
    commandId: randomUUID(),
    roomId: id,
    expectedVersion: room.version,
  });
  if (!started.ok) throw new Error("Private start failed");
  const matchId = (await f.http(0, `/v1/kahroba/rooms/${id}`)).data.room.startedMatchId;
  for (let i = 0; i < count; i++) {
    await f.request(sockets[i], "match:subscribe", { schemaVersion: 1, matchId });
    const s = await f.snapshot(sockets[i], matchId);
    const r = await f.request(sockets[i], "match:ready", {
      schemaVersion: 1,
      actionId: randomUUID(),
      matchId,
      expectedVersion: s.stateVersion,
    });
    if (!r.ok) throw new Error("Private readiness failed");
  }
  return { matchId, sockets };
}
async function finish(f, matchId, sockets) {
  for (let turn = 0; turn < 1000; turn++) {
    const s = await f.snapshot(sockets[0], matchId);
    if (s.status === "FINISHED") return s;
    const actor = f.ids.indexOf(s.view.turnPlayerId);
    const own = await f.snapshot(sockets[actor], matchId);
    await f.command(sockets[actor], matchId, kahrobaBotPolicy.chooseCommand(own.view));
  }
  throw new Error("Bounded local game did not finish");
}
async function credited(matchId, count) {
  await until(async () =>
    db
      .forModule("leaderboard")
      .execute(async (d) => (await d.statsApplication.count({ where: { matchId } })) === 1),
  );
  const rows = await db.forModule("matches").execute(async (d) => ({
    result: await d.matchResult.findUnique({ where: { matchId } }),
    players: await d.gameResult.findMany({ where: { matchId } }),
  }));
  expect(rows.result.payloadJsonb.schemaVersion).toBe(2);
  expect(rows.players.length).toBe(count);
  return rows;
}

for (const capacity of [3, 4])
  it(`real main API/Worker: ${capacity} synthetic humans create/join/ready/play/finish with v2 persistence`, async () => {
    const f = await setup();
    try {
      const { matchId, sockets } = await roomGame(f, capacity);
      const initial = await f.snapshot(sockets[0], matchId);
      expect(initial.view.market.flat().filter(Boolean).length).toBe(12);
      expect(initial.view.nobles.length).toBe(capacity + 1);
      expect(initial.view.deadlineAt).toBeNull();
      const done = await finish(f, matchId, sockets, capacity);
      expect(done.view.result.winnerIds.length >= 1).toBe(true);
      await credited(matchId, capacity);
      await writeFile(
        join(artifacts, `runtime-${capacity}.json`),
        JSON.stringify({
          capacity,
          source: "actual API/Worker main entry points",
          passed: true,
          syntheticIdentities: true,
          workerReadyAt: f.workerReadyAt,
          completedAt: new Date().toISOString(),
          turns: done.view.turnNumber,
          unapprovedHumanTimers: false,
        }) + "\n",
      );
    } finally {
      await f.close();
    }
  }, 120000);

it("real runtime: shared v2 edge credits both winners through the live Worker", async () => {
  const f = await setup();
  try {
    const { matchId, sockets } = await roomGame(f, 2);
    const commands = await installSharedFinalRound({
      a: db,
      stored: async () => ({ match: await f.stored(matchId) }),
    });
    for (let i = 0; i < 2; i++) await f.command(sockets[i], matchId, commands[i]);
    const done = await f.snapshot(sockets[0], matchId);
    expect(done.view.result.winnerIds.length).toBe(2);
    expect(done.view.result.winnerId).toBeNull();
    const rows = await credited(matchId, 2);
    expect(rows.players.every((p) => p.winner)).toBe(true);
    await writeFile(
      join(artifacts, "runtime-shared.json"),
      JSON.stringify({
        passed: true,
        syntheticInvariantValidEdge: true,
        realFinalCommands: true,
        allWinners: 2,
        actualWorker: true,
        completedAt: new Date().toISOString(),
      }) + "\n",
    );
  } finally {
    await f.close();
  }
}, 60000);

for (const browserName of ["chromium", "webkit"])
  it(`actual Web/API/Worker ${browserName}: two-human UI room, ready, turns, reservation privacy and reconnect`, async () => {
    const f = await setup();
    let browser;
    try {
      await f.browserStart();
      const env = { ...process.env };
      delete env.GIO_MODULE_DIR;
      browser = await playwright[browserName].launch({ env });
      const pages = [];
      for (let i = 0; i < 2; i++) {
        const context = await browser.newContext({
          viewport: { width: 375, height: 667 },
          hasTouch: true,
        });
        const page = await context.newPage();
        pages.push(page);
        const q = new URLSearchParams({
          tgWebAppData: f.launches[i],
          tgWebAppVersion: "8.0",
          tgWebAppPlatform: "ios",
        });
        await page.goto(`${f.origin}/?${q}`);
        await page.getByRole("button", { name: "Continue with Telegram", exact: true }).click();
        await page.getByRole("link", { name: "میز خصوصی کهربا" }).click();
        try {
          await page.getByRole("button", { name: "ساخت اتاق خصوصی" }).waitFor({ timeout: 10000 });
        } catch (error) {
          await page.screenshot({
            path: join(artifacts, `${browserName}-runtime-entry-failure.png`),
            fullPage: true,
          });
          throw error;
        }
      }
      await pages[0].getByRole("button", { name: "ساخت اتاق خصوصی" }).click();
      await pages[0].getByRole("button", { name: "دریافت دعوت" }).click();
      const invite = await pages[0]
        .getByRole("textbox", { name: "کد دعوت", exact: true })
        .inputValue();
      await pages[1].getByRole("textbox", { name: "دعوت میزبان" }).fill(invite);
      await pages[1].getByRole("button", { name: "پیوستن به اتاق" }).click();
      await pages[1].getByRole("heading", { name: "اتاق خصوصی کهربا" }).waitFor();
      await pages[0].getByRole("button", { name: "به‌روز کردن اتاق" }).click();
      await until(() => pages[0].getByRole("button", { name: "شروع بازی" }).isEnabled());
      await pages[0].getByRole("button", { name: "شروع بازی" }).click();
      await pages[1].getByRole("button", { name: "به‌روز کردن اتاق" }).click();
      await pages[0].getByRole("button", { name: "آماده‌ام" }).waitFor();
      await pages[0].getByRole("button", { name: "آماده‌ام" }).click();
      await pages[1].getByRole("button", { name: "آماده‌ام" }).waitFor();
      await pages[1].getByRole("button", { name: "آماده‌ام" }).click();
      for (const p of pages) await p.locator(".kh-market-cards").first().waitFor();
      const matchId = (await pages[0].evaluate(() => globalThis.location.hash)).split("/").at(-1),
        sockets = [];
      for (let i = 0; i < 2; i++) {
        sockets.push(await f.connect(i));
        await f.request(sockets[i], "match:subscribe", { schemaVersion: 1, matchId });
      }
      let s = await f.snapshot(sockets[0], matchId),
        actor = f.ids.indexOf(s.view.turnPlayerId);
      for (const page of pages)
        await until(
          async () =>
            (await page.locator('[aria-label="میز کهربا"]').getAttribute("data-state-version")) ===
            String(s.stateVersion),
        );
      expect(await pages[actor].locator(".kh-market-cards .kh-card").count()).toBe(12);
      await pages[actor].getByRole("button", { name: "گرفتن ژتون", exact: true }).click();
      await pages[actor].locator(".kh-collection-choice").first().click();
      await pages[actor].getByRole("button", { name: "ادامه و تأیید ژتون‌ها" }).click();
      await pages[actor].getByRole("button", { name: "تأیید اقدام" }).click();
      await until(
        async () => (await f.snapshot(sockets[0], matchId)).view.turnPlayerId !== f.ids[actor],
      );
      s = await f.snapshot(sockets[0], matchId);
      actor = f.ids.indexOf(s.view.turnPlayerId);
      await until(
        async () =>
          (await pages[actor]
            .locator('[aria-label="میز کهربا"]')
            .getAttribute("data-state-version")) === String(s.stateVersion),
      );
      await until(() =>
        pages[actor].getByRole("button", { name: "رزرو کارت", exact: true }).isEnabled(),
      );
      const reserve = (await f.snapshot(sockets[actor], matchId)).view.legalCommands.find(
        (c) => c.type === "RESERVE_CARD" && c.source.kind === "DECK" && c.source.tier === 3,
      );
      await pages[actor].getByRole("button", { name: "رزرو کارت", exact: true }).click();
      await pages[actor].locator(".kh-decks .kh-cardback").first().click();
      await pages[actor].getByRole("button", { name: "تأیید اقدام" }).click();
      await until(
        async () => (await f.snapshot(sockets[actor], matchId)).view.myReserved.length === 1,
      );
      const own = await f.snapshot(sockets[actor], matchId),
        other = await f.snapshot(sockets[1 - actor], matchId);
      expect(JSON.stringify(other.view).includes(own.view.myReserved[0].id)).toBe(false);
      expect(JSON.stringify(other.view).includes('"decks"')).toBe(false);
      await pages[0].screenshot({
        path: join(artifacts, `${browserName}-real-runtime-375.png`),
        fullPage: true,
        animations: "disabled",
      });
      const reservedActor = actor;
      const receipt = await db.forModule("matches").execute((d) =>
        d.processedCommand.findFirstOrThrow({
          where: { matchId, actorUserId: f.ids[actor] },
          orderBy: { createdAt: "desc" },
        }),
      );
      let before = await f.stored(matchId);
      const input = {
        schemaVersion: 1,
        actionId: receipt.actionId,
        matchId,
        expectedVersion: receipt.expectedVersion,
        command: reserve,
      };
      expect((await f.request(sockets[reservedActor], "game:command", input)).ok).toBe(true);
      expect(
        JSON.stringify((await f.stored(matchId)).stateJsonb) === JSON.stringify(before.stateJsonb),
      ).toBe(true);
      expect((await f.http(2, `/v1/kahroba/matches/${matchId}/players`)).status).toBe(404);
      let purchaseView;
      for (let step = 0; step < 100; step++) {
        const v = (await f.snapshot(sockets[0], matchId)).view;
        actor = f.ids.indexOf(v.turnPlayerId);
        purchaseView = await f.snapshot(sockets[actor], matchId);
        if (purchaseView.view.legalCommands.some((c) => c.type === "BUY_CARD")) break;
        await f.command(sockets[actor], matchId, kahrobaBotPolicy.chooseCommand(purchaseView.view));
      }
      expect(purchaseView.view.legalCommands.some((c) => c.type === "BUY_CARD")).toBe(true);
      await until(
        async () =>
          (await pages[actor]
            .locator('[aria-label="میز کهربا"]')
            .getAttribute("data-state-version")) === String(purchaseView.stateVersion),
      );
      await until(() =>
        pages[actor].getByRole("button", { name: "خرید کارت", exact: true }).isEnabled(),
      );
      const purchasedBefore = purchaseView.view.players.find((p) => p.id === f.ids[actor]).purchased
        .length;
      await pages[actor].getByRole("button", { name: "خرید کارت", exact: true }).click();
      await pages[actor].getByRole("button", { name: "تأیید اقدام" }).click();
      await until(
        async () =>
          (await f.snapshot(sockets[actor], matchId)).view.players.find(
            (p) => p.id === f.ids[actor],
          ).purchased.length ===
          purchasedBefore + 1,
      );
      before = await f.stored(matchId);
      await f.restart(false);
      sockets.length = 0;
      for (let i = 0; i < 2; i++) {
        sockets.push(await f.connect(i));
        await f.request(sockets[i], "match:subscribe", { schemaVersion: 1, matchId });
      }
      expect(
        JSON.stringify((await f.stored(matchId)).stateJsonb) === JSON.stringify(before.stateJsonb),
      ).toBe(true);
      expect((await f.request(sockets[reservedActor], "game:command", input)).ok).toBe(true);
      expect(
        (
          await f.http(0, "/v1/kahroba/rooms", {
            schemaVersion: 1,
            commandId: randomUUID(),
            gameId: "kahroba",
            capacity: 2,
          })
        ).status,
      ).toBe(409);
      for (const p of pages) await p.locator(".kh-market-cards").first().waitFor();
      const done = await finish(f, matchId, sockets, 2);
      for (const p of pages) await p.getByRole("dialog").waitFor();
      await credited(matchId, 2);
      for (const p of pages)
        expect(
          await p.evaluate(() => [
            globalThis.localStorage.length,
            globalThis.sessionStorage.length,
          ]),
        ).toEqual([0, 0]);
      await writeFile(
        join(artifacts, `${browserName}-runtime-e2e.json`),
        JSON.stringify({
          passed: true,
          capacity: 2,
          actualMainEntryPoints: true,
          realSignedVerifier: true,
          syntheticTelegramIdentities: true,
          workerReadyAt: f.workerReadyAt,
          consumerBeforeProducer: true,
          duplicateCommandSameIdentity: true,
          reconnectAndAPIRestart: true,
          admissionOffPreservesActiveMatches: true,
          privateReservationsIsolated: true,
          completionPersisted: true,
          turns: done.view.turnNumber,
          nativeTelegramAcceptance: false,
          completedAt: new Date().toISOString(),
        }) + "\n",
      );
    } finally {
      await browser?.close();
      await f.close();
    }
  }, 180000);
