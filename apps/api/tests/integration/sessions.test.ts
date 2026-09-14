import { createHash, createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@hambazi/database";
import { createAuthSessions, createRedisAuthRateLimiter, authPaths } from "../../src/auth/index.js";
import { createHttpApplication } from "../../src/composition/http.js";
import { createSafeLogger } from "../../src/composition/safe-logger.js";
import { startApi } from "../../src/composition/runtime.js";
import { createClient } from "redis";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createUserIdentityPort } from "../../src/users/index.js";
import {
  commandId,
  initData,
  keyB,
  now,
  signing,
  telegram,
  userId,
  otherUserId,
} from "../auth/session-fixtures.js";

if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed" ||
  !process.env.TEST_DATABASE_URL ||
  !process.env.API_DATABASE_URL
) {
  throw new Error("Use root test:auth:local with an isolated PostgreSQL binary directory.");
}
const config = {
  poolMax: 8,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 5000,
};
const admin = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL! },
});

describe.skipIf(!process.env.TEST_AUTH_REDIS_URL)(
  "HTTP with real PostgreSQL and ACL-protected Redis",
  () => {
    async function transport(namespace: string, database = second) {
      const rate = createRedisAuthRateLimiter({
        url: { reveal: () => process.env.TEST_AUTH_REDIS_URL! },
        namespace,
        ipLimit: 30,
        identityLimit: 6,
      });
      await rate.connect();
      const sessions = createAuthSessions({
        database,
        users: createUserIdentityPort(database),
        telegram,
        clock,
        lifetimeSeconds: 900,
        signing,
      });
      const logs: string[] = [];
      const http = await createHttpApplication({
        auth: { sessions, telegram, clock, limiter: rate.limiter },
        allowedOrigins: ["https://mini.example"],
        trustedProxies: [],
        production: false,
        logger: createSafeLogger({
          write: (value: string) => {
            logs.push(value);
          },
        }),
      });
      return { ...http, rate, logs };
    }
    const payload = (command = randomUUID()) => ({
      schemaVersion: 1,
      commandId: command,
      initData: initData(42, Math.floor(clock.value / 1000)),
    });
    it("atomically limits two HTTP instances and commits one session across concurrent retries", async () => {
      const namespace = `integration:${randomUUID()}`;
      const a = await transport(namespace);
      const b = await transport(namespace);
      try {
        const command = randomUUID();
        const body = payload(command);
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            (i % 2 ? a : b).server.inject({ method: "POST", url: authPaths.issue, payload: body }),
          ),
        );
        expect(results.filter((r) => r.statusCode === 200)).toHaveLength(6);
        expect(results.filter((r) => r.statusCode === 429)).toHaveLength(2);
        const success = results.find((r) => r.statusCode === 200)!.json();
        expect(success.session.expiresAt).toBe(Math.floor(clock.value / 1000) + 900);
        expect(
          new Set(results.filter((r) => r.statusCode === 200).map((r) => r.json().accessToken))
            .size,
        ).toBe(1);
        const count = await admin
          .forModule("auth")
          .execute((client) => client.session.count({ where: { userId, commandId: command } }));
        expect(count).toBe(1);
        const headers = { authorization: `Bearer ${success.accessToken}` };
        expect((await b.server.inject({ url: authPaths.inspect, headers })).statusCode).toBe(200);
        expect(
          (
            await b.server.inject({
              method: "POST",
              url: authPaths.logout,
              headers,
              payload: { schemaVersion: 1 },
            })
          ).statusCode,
        ).toBe(200);
        expect((await a.server.inject({ url: authPaths.inspect, headers })).statusCode).toBe(401);
        expect(a.logs.join("")).not.toContain(success.accessToken);
        expect(b.logs.join("")).not.toContain(body.initData);
      } finally {
        a.rate.close();
        b.rate.close();
        await a.app.close();
        await b.app.close();
      }
    });
    it("enforces IP quotas atomically and isolates identity/IP counter namespaces", async () => {
      const namespace = `integration:${randomUUID()}`;
      const a = await transport(namespace);
      const b = await transport(namespace);
      try {
        const results = await Promise.all(
          Array.from({ length: 45 }, (_, i) => (i % 2 ? a : b).rate.limiter.consumeIp("192.0.2.4")),
        );
        expect(results.filter((r) => r.allowed)).toHaveLength(30);
        expect(results.filter((r) => !r.allowed && r.reason === "limited")).toHaveLength(15);
        expect(await a.rate.limiter.consumeIdentity("192.0.2.4")).toEqual({ allowed: true });
        expect(await a.rate.limiter.consumeIp("192.0.2.5")).toEqual({ allowed: true });
        const observer = createClient({
          url: process.env.TEST_AUTH_REDIS_URL!,
          socket: { reconnectStrategy: false },
        });
        observer.on("error", () => {});
        await observer.connect();
        try {
          const digest = (v: string) => createHash("sha256").update(v).digest("hex");
          const key = `hambazi:auth-rate:v1:${digest(namespace)}:ip:${digest("192.0.2.4")}`;
          expect(await observer.get(key)).toBe("30");
          const before = await observer.pTTL(key);
          await new Promise((resolve) => setTimeout(resolve, 20));
          expect((await a.rate.limiter.consumeIp("192.0.2.4")).allowed).toBe(false);
          expect(await observer.pTTL(key)).toBeLessThan(before);
          // Shorten only this test's counter TTL to exercise actual expiry without a minute-long wait.
          await observer.pExpire(key, 30);
          await new Promise((resolve) => setTimeout(resolve, 60));
          expect(await b.rate.limiter.consumeIp("192.0.2.4")).toEqual({ allowed: true });
          expect(await observer.get(key)).toBe("1");
        } finally {
          observer.destroy();
        }
      } finally {
        a.rate.close();
        b.rate.close();
        await a.app.close();
        await b.app.close();
      }
    });
    it("denies ACL-privileged commands and database-free offline issuance", async () => {
      const client = createClient({
        url: process.env.TEST_AUTH_REDIS_URL!,
        socket: { reconnectStrategy: false },
      });
      client.on("error", () => {});
      await client.connect();
      try {
        await expect(client.sendCommand(["FLUSHALL"])).rejects.toThrow();
        await expect(client.set("outside-hambazi", "test")).rejects.toThrow();
      } finally {
        client.destroy();
      }
      const a = await transport(`integration:${randomUUID()}`);
      try {
        const body = payload();
        const issued = await a.server.inject({
          method: "POST",
          url: authPaths.issue,
          payload: body,
        });
        expect(issued.statusCode).toBe(200);
        a.rate.close();
        const blocked = payload();
        expect(
          (await a.server.inject({ method: "POST", url: authPaths.issue, payload: blocked }))
            .statusCode,
        ).toBe(503);
        const count = await admin
          .forModule("auth")
          .execute((client) =>
            client.session.count({ where: { userId, commandId: blocked.commandId } }),
          );
        expect(count).toBe(0);
        const headers = { authorization: `Bearer ${issued.json().accessToken}` };
        expect((await a.server.inject({ url: authPaths.inspect, headers })).statusCode).toBe(200);
        expect(
          (
            await a.server.inject({
              method: "POST",
              url: authPaths.logout,
              headers,
              payload: { schemaVersion: 1 },
            })
          ).statusCode,
        ).toBe(200);
      } finally {
        a.rate.close();
        await a.app.close();
      }
    });
    it("denies HTTP issuance, inspection and logout when the database adapter is closed", async () => {
      const database = createDatabase({
        ...config,
        databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
      });
      await database.connect();
      const a = await transport(`integration:${randomUUID()}`, database);
      try {
        const response = await a.server.inject({
          method: "POST",
          url: authPaths.issue,
          payload: payload(),
        });
        expect(response.statusCode).toBe(200);
        await database.disconnect();
        expect(
          (await a.server.inject({ method: "POST", url: authPaths.issue, payload: payload() }))
            .statusCode,
        ).toBe(503);
        const headers = { authorization: `Bearer ${response.json().accessToken}` };
        expect((await a.server.inject({ url: authPaths.inspect, headers })).statusCode).toBe(503);
        expect(
          (
            await a.server.inject({
              method: "POST",
              url: authPaths.logout,
              headers,
              payload: { schemaVersion: 1 },
            })
          ).statusCode,
        ).toBe(503);
      } finally {
        a.rate.close();
        await a.app.close();
        await database.disconnect();
      }
    });
    it("starts the configured runtime, authenticates over TCP, and shuts down cleanly", async () => {
      const reservation = createServer();
      await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
      const address = reservation.address();
      if (!address || typeof address === "string") throw new Error("Expected loopback test port");
      const port = address.port;
      await new Promise<void>((resolve, reject) =>
        reservation.close((error) => (error ? reject(error) : resolve())),
      );
      const botToken = "123456789:RuntimeSyntheticCredential";
      const logs: string[] = [];
      const runtime = await startApi(
        {
          NODE_ENV: "test",
          API_DATABASE_URL: process.env.API_DATABASE_URL!,
          API_REDIS_URL: process.env.TEST_AUTH_REDIS_URL!,
          API_PORT: String(port),
          ALLOWED_ORIGINS: "https://mini.example",
          API_BIND_ADDRESS: "127.0.0.1",
          API_DB_POOL_MAX: "5",
          API_TRUSTED_PROXIES: "",
          TELEGRAM_BOT_TOKEN: botToken,
          AUTH_SESSION_SECONDS: "900",
          AUTH_TELEGRAM_MAX_AGE_SECONDS: "300",
          AUTH_TELEGRAM_FUTURE_SKEW_SECONDS: "30",
          AUTH_IP_LIMIT: "30",
          AUTH_IDENTITY_LIMIT: "6",
          AUTH_ACTIVE_KEY_ID: signing.activeKeyId,
          AUTH_ISSUER: signing.issuer,
          AUTH_AUDIENCE: signing.audience,
          AUTH_SIGNING_KEYS: JSON.stringify(
            signing.keys.map((k) => ({ id: k.id, secret: k.secret.reveal() })),
          ),
        },
        createSafeLogger({
          write: (value: string) => {
            logs.push(value);
          },
        }),
      );
      try {
        const date = Math.floor(Date.now() / 1000);
        const user = JSON.stringify({ id: 42 });
        const key = createHmac("sha256", "WebAppData").update(botToken).digest();
        const hash = createHmac("sha256", key)
          .update(`auth_date=${date}\nuser=${user}`)
          .digest("hex");
        const data = new URLSearchParams({ auth_date: String(date), user, hash }).toString();
        const response = await fetch(`http://127.0.0.1:${port}${authPaths.issue}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ schemaVersion: 1, commandId: randomUUID(), initData: data }),
        });
        expect(response.status).toBe(200);
        const result = (await response.json()) as {
          accessToken: string;
          session: { expiresAt: number };
        };
        expect(result.session.expiresAt).toBeGreaterThanOrEqual(date + 900);
        expect(
          (
            await fetch(`http://127.0.0.1:${port}${authPaths.inspect}`, {
              headers: { authorization: `Bearer ${result.accessToken}` },
            })
          ).status,
        ).toBe(200);
        expect(logs.join("")).not.toContain(data);
        expect(logs.join("")).not.toContain(result.accessToken);
        expect(logs.join("")).not.toContain(botToken);
      } finally {
        await runtime.close();
      }
      expect(logs.some((line) => JSON.parse(line).event === "api.started")).toBe(true);
      expect(logs.some((line) => JSON.parse(line).event === "api.stopped")).toBe(true);
    });
    it("recovers from an actual Redis restart without losing durable sessions", async () => {
      const name = process.env.TEST_AUTH_REDIS_CONTAINER;
      if (!name || !/^hambazi-auth-http-[a-f0-9-]{36}$/.test(name))
        throw new Error("Expected harness-owned disposable Redis container");
      const a = await transport(`integration:${randomUUID()}`);
      try {
        const issued = await a.server.inject({
          method: "POST",
          url: authPaths.issue,
          payload: payload(),
        });
        expect(issued.statusCode).toBe(200);
        await promisify(execFile)("docker", ["stop", "--time", "1", name]);
        expect(
          (await a.server.inject({ method: "POST", url: authPaths.issue, payload: payload() }))
            .statusCode,
        ).toBe(503);
        const headers = { authorization: `Bearer ${issued.json().accessToken}` };
        expect((await a.server.inject({ url: authPaths.inspect, headers })).statusCode).toBe(200);
        await promisify(execFile)("docker", ["start", name]);
        const published = await promisify(execFile)("docker", ["port", name, "6379/tcp"]);
        expect(published.stdout.trim()).toBe(
          `127.0.0.1:${new URL(process.env.TEST_AUTH_REDIS_URL!).port}`,
        );
        let recovered = false;
        for (let i = 0; i < 40; i++) {
          if ((await a.rate.limiter.consumeIp("192.0.2.99")).allowed) {
            recovered = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        expect(recovered).toBe(true);
        expect((await a.server.inject({ url: authPaths.inspect, headers })).statusCode).toBe(200);
      } finally {
        a.rate.close();
        await a.app.close();
      }
    }, 20000);
  },
);
const db = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
});
const second = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
});
const users = createUserIdentityPort(db);
const clock = {
  value: now * 1000,
  nowMs() {
    return this.value;
  },
};
function service(database = db, credentials = signing) {
  return createAuthSessions({
    database,
    users: createUserIdentityPort(database),
    telegram,
    clock,
    lifetimeSeconds: 120,
    signing: credentials,
  });
}
const auth = service();
const auth2 = service(second);
beforeAll(async () => {
  await Promise.all([admin.connect(), db.connect(), second.connect()]);
  const count = await admin.forModule("users").execute((client) => client.user.count());
  if (count !== 1)
    throw new Error("Expected only the isolated foundation fixture; refusing writes.");
  for (const [id, telegramId] of [
    [userId, 42],
    [otherUserId, 43],
  ] as const) {
    await admin.forModule("users").execute((client) =>
      client.user.create({
        data: {
          id,
          telegramUserId: BigInt(telegramId),
          displayName: "Synthetic",
          publicHandle: `session_${telegramId}`,
          status: "ACTIVE",
        },
      }),
    );
  }
});
afterAll(async () => {
  await Promise.all([admin.disconnect(), db.disconnect(), second.disconnect()]);
});
async function issue(command = randomUUID(), app = auth) {
  const response = await app.issue(initData(42, Math.floor(clock.value / 1000)), command);
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error("Synthetic session issuance failed");
  return response;
}

describe("Auth and Users ports against PostgreSQL", () => {
  it("maps existing active identity without profile or persistence types", async () => {
    expect(await users.findActiveByTelegramId("42")).toEqual({ userId });
    expect(await users.findActiveById(userId)).toEqual({ userId });
    expect(await users.findActiveByTelegramId("99")).toBeUndefined();
    expect((await auth.issue(initData(99), randomUUID())).ok).toBe(false);
  });
  it("commits once under concurrent issuance across two database clients", async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) => issue(commandId, i % 2 ? auth : auth2)),
    );
    expect(new Set(responses.map((r) => r.session.sessionId)).size).toBe(1);
    expect(new Set(responses.map((r) => r.accessToken.reveal())).size).toBe(1);
    const count = await admin
      .forModule("auth")
      .execute((client) => client.session.count({ where: { userId, commandId } }));
    expect(count).toBe(1);
    expect((await auth2.authenticate(responses[0]!.accessToken.reveal())).ok).toBe(true);
  });
  it("separates authenticated users even with the same command UUID", async () => {
    const response = await auth.issue(initData(43), commandId);
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.session.userId).toBe(otherUserId);
  });
  it("returns the same expiry after process-local service reconstruction", async () => {
    const first = await issue();
    const record = await admin
      .forModule("auth")
      .execute((client) =>
        client.session.findUniqueOrThrow({ where: { id: first.session.sessionId } }),
      );
    clock.value += 1000;
    const retry = await service().issue(initData(), record.commandId);
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.session).toEqual(first.session);
      expect(retry.accessToken.reveal() === first.accessToken.reveal()).toBe(true);
    }
  });
  it("makes concurrent logout idempotent and visible across clients", async () => {
    const response = await issue();
    const token = response.accessToken.reveal();
    const results = await Promise.all([
      auth.revoke(token),
      auth2.revoke(token),
      auth.revoke(token),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await auth.authenticate(token)).ok).toBe(false);
    expect((await auth2.authenticate(token)).ok).toBe(false);
  });
  it("never revives a revoked issuance command", async () => {
    const command = randomUUID();
    const response = await issue(command);
    await auth.revoke(response.accessToken.reveal());
    expect((await auth2.issue(initData(), command)).ok).toBe(false);
    const rows = await admin
      .forModule("auth")
      .execute((client) => client.session.findMany({ where: { userId, commandId: command } }));
    expect(rows.length).toBe(1);
    expect(rows[0]!.revokedAt).not.toBeNull();
  });
  it("denies validation after completed revocation under repeated races", async () => {
    for (let i = 0; i < 10; i++) {
      const response = await issue();
      const token = response.accessToken.reveal();
      const [, revoked] = await Promise.all([auth.authenticate(token), auth2.revoke(token)]);
      expect(revoked.ok).toBe(true);
      expect((await auth.authenticate(token)).ok).toBe(false);
    }
  });
  it("rechecks account eligibility for already issued credentials", async () => {
    const response = await issue();
    await admin
      .forModule("users")
      .execute((client) =>
        client.user.update({ where: { id: userId }, data: { status: "BLOCKED" } }),
      );
    expect(await users.findActiveByTelegramId("42")).toBeUndefined();
    expect((await auth.authenticate(response.accessToken.reveal())).ok).toBe(false);
    expect((await auth.issue(initData(), randomUUID())).ok).toBe(false);
    await admin
      .forModule("users")
      .execute((client) =>
        client.user.update({ where: { id: userId }, data: { status: "ACTIVE" } }),
      );
  });
  it("persists only metadata and preserves old keys on normal rotation", async () => {
    const command = randomUUID();
    const response = await issue(command);
    const rotated = service(second, {
      ...signing,
      activeKeyId: "b",
      keys: [...signing.keys, { id: "b", secret: { reveal: () => keyB } }],
    });
    const retry = await rotated.issue(initData(), command);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.accessToken.reveal() === response.accessToken.reveal()).toBe(true);
    const row = await admin
      .forModule("auth")
      .execute((client) =>
        client.session.findUniqueOrThrow({ where: { id: response.session.sessionId } }),
      );
    expect(Object.keys(row).sort()).toEqual([
      "audience",
      "commandId",
      "expiresAt",
      "id",
      "issuedAt",
      "issuer",
      "keyId",
      "revokedAt",
      "schemaVersion",
      "userId",
    ]);
  });
  it("expires at the server deadline and does not recreate expired commands", async () => {
    const command = randomUUID();
    const response = await issue(command);
    clock.value = response.session.expiresAt * 1000;
    expect((await auth.authenticate(response.accessToken.reveal())).ok).toBe(false);
    expect((await auth.issue(initData(42, Math.floor(clock.value / 1000)), command)).ok).toBe(
      false,
    );
  });
  it("fails closed when its real database adapter becomes unavailable", async () => {
    const response = await issue();
    await db.disconnect();
    expect(await auth.authenticate(response.accessToken.reveal())).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(
      await auth.issue(initData(42, Math.floor(clock.value / 1000)), randomUUID()),
    ).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
  });
});
