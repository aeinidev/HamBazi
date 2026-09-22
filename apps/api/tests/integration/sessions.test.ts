import { createHash, createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@hambazi/database";
import {
  createAuthSessions,
  createRedisAuthRateLimiter,
  createMiniAppOnboarding,
  authPaths,
} from "../../src/auth/index.js";
import { createHttpApplication } from "../../src/composition/http.js";
import { createSafeLogger } from "../../src/composition/safe-logger.js";
import { startApi } from "../../src/composition/runtime.js";
import { createClient } from "redis";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createUserIdentityPort,
  createAccountCreationPort,
  createProfileRate,
  createProfilePort,
} from "../../src/users/index.js";
import { accountIntegrationCases } from "./account-cases.js";
import { botOnboardingIntegrationCases } from "./bot-onboarding-cases.js";
import { botInternalIntegrationCases } from "./bot-internal-cases.js";
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
      const profileRate = createProfileRate({
        url: { reveal: () => process.env.TEST_AUTH_REDIS_URL! },
        namespace,
        readLimit: 60,
        writeLimit: 10,
      });
      await profileRate.connect();
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
        auth: {
          sessions,
          telegram,
          clock,
          limiter: rate.limiter,
          onboarding: createMiniAppOnboarding({
            accounts: createAccountCreationPort(database),
            users: createUserIdentityPort(database),
            telegram,
            clock,
          }),
        },
        profile: {
          profile: createProfilePort(database, clock),
          authenticate: async (token) => {
            const result = await sessions.authenticate(token);
            return result.ok ? { ok: true, userId: result.session.userId } : result;
          },
          rate: profileRate.consume,
          degraded: (requestId, kind) => {
            logs.push(JSON.stringify({ event: `profile.rate_${kind}_unavailable`, requestId }));
          },
        },
        allowedOrigins: ["https://mini.example"],
        trustedProxies: [],
        production: false,
        logger: createSafeLogger({
          write: (value: string) => {
            logs.push(value);
          },
        }),
      });
      return {
        ...http,
        rate: {
          ...rate,
          close() {
            rate.close();
            profileRate.close();
          },
        },
        profileRate,
        logs,
      };
    }
    const payload = (command = randomUUID()) => ({
      schemaVersion: 1,
      commandId: command,
      initData: initData(42, Math.floor(clock.value / 1000)),
    });
    const accountPayload = (id: number, command = randomUUID()) => ({
      schemaVersion: 1,
      commandId: command,
      initData: initData(id, Math.floor(clock.value / 1000), "room_synthetic-onboarding"),
      displayName: "  Mehdi  ",
    });
    it("creates one account across two HTTP instances and eight concurrent authenticated retries without a session", async () => {
      const namespace = `integration:${randomUUID()}`;
      const a = await transport(namespace);
      const b = await transport(namespace);
      try {
        const body = accountPayload(7101);
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            (i % 2 ? a : b).server.inject({
              method: "POST",
              url: authPaths.createAccount,
              payload: { ...body, displayName: i % 2 ? "Mehdi" : "مهدی" },
            }),
          ),
        );
        const passed = results.filter((response) => response.statusCode === 200);
        expect(passed).toHaveLength(6);
        expect(results.filter((response) => response.statusCode === 429)).toHaveLength(2);
        for (const response of passed) expect(response.json()).toEqual(passed[0]!.json());
        const account = passed[0]!.json().account;
        expect(passed[0]!.json().startParam).toBe("room_synthetic-onboarding");
        expect(Object.keys(passed[0]!.json()).sort()).toEqual([
          "account",
          "schemaVersion",
          "startParam",
        ]);
        expect(
          await admin
            .forModule("users")
            .execute((client) => client.user.count({ where: { telegramUserId: 7101n } })),
        ).toBe(1);
        expect(
          await admin
            .forModule("auth")
            .execute((client) => client.session.count({ where: { userId: account.userId } })),
        ).toBe(0);
        expect(a.logs.join("") + b.logs.join("")).not.toContain(body.initData);
        expect(a.logs.join("") + b.logs.join("")).not.toContain("room_synthetic-onboarding");
      } finally {
        a.rate.close();
        b.rate.close();
        await Promise.all([a.app.close(), b.app.close()]);
      }
    });
    it("recovers a committed account through HTTP after post-commit Telegram freshness failure", async () => {
      const a = await transport(`integration:${randomUUID()}`);
      const originalTime = clock.value;
      try {
        const accounts = createAccountCreationPort(second);
        const interrupted = createMiniAppOnboarding({
          accounts: {
            async createForVerifiedTelegramIdentity(id, name) {
              const result = await accounts.createForVerifiedTelegramIdentity(id, name);
              clock.value += 301000;
              return result;
            },
          },
          users: createUserIdentityPort(second),
          telegram,
          clock,
        });
        const body = accountPayload(7108);
        expect(await interrupted.create(body.initData, body.commandId, "Original")).toMatchObject({
          ok: false,
          error: { code: "UNAUTHENTICATED" },
        });
        const committed = await admin
          .forModule("users")
          .execute((client) => client.user.findUniqueOrThrow({ where: { telegramUserId: 7108n } }));
        const response = await a.server.inject({
          method: "POST",
          url: authPaths.createAccount,
          payload: { ...accountPayload(7108, body.commandId), displayName: "Changed" },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().account).toEqual({
          schemaVersion: 1,
          userId: committed.id,
          displayName: "Original",
          publicHandle: committed.publicHandle,
        });
        expect(
          await admin
            .forModule("users")
            .execute((client) => client.user.count({ where: { telegramUserId: 7108n } })),
        ).toBe(1);
      } finally {
        clock.value = originalTime;
        a.rate.close();
        await a.app.close();
      }
    });
    it("shares Redis identity quotas across account creation and session issuance on two instances", async () => {
      const namespace = `integration:${randomUUID()}`;
      const a = await transport(namespace);
      const b = await transport(namespace);
      try {
        const creation = accountPayload(7102);
        for (let i = 0; i < 6; i++) {
          const account = i % 2 === 0;
          const response = await (account ? a : b).server.inject({
            method: "POST",
            url: account ? authPaths.createAccount : authPaths.issue,
            payload: account
              ? creation
              : { schemaVersion: 1, commandId: randomUUID(), initData: creation.initData },
          });
          expect(response.statusCode).toBe(200);
        }
        for (const url of [authPaths.createAccount, authPaths.issue]) {
          const response = await b.server.inject({
            method: "POST",
            url,
            payload:
              url === authPaths.createAccount
                ? creation
                : { schemaVersion: 1, commandId: randomUUID(), initData: creation.initData },
          });
          expect(response.statusCode).toBe(429);
          expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
        }
        expect(
          await admin
            .forModule("users")
            .execute((client) => client.user.count({ where: { telegramUserId: 7102n } })),
        ).toBe(1);
      } finally {
        a.rate.close();
        b.rate.close();
        await Promise.all([a.app.close(), b.app.close()]);
      }
    });
    it("shares the pre-parse IP quota across both routes for malformed unauthenticated bodies", async () => {
      const a = await transport(`integration:${randomUUID()}`);
      try {
        const results = await Promise.all(
          Array.from({ length: 32 }, (_, i) =>
            a.server.inject({
              method: "POST",
              url: i % 2 ? authPaths.issue : authPaths.createAccount,
              payload: {},
            }),
          ),
        );
        expect(results.filter((response) => response.statusCode === 400)).toHaveLength(30);
        expect(results.filter((response) => response.statusCode === 429)).toHaveLength(2);
      } finally {
        a.rate.close();
        await a.app.close();
      }
    });
    it("rejects forged identity and blocked accounts at HTTP without renaming or reactivation", async () => {
      const a = await transport(`integration:${randomUUID()}`);
      try {
        const body = accountPayload(7103);
        expect(
          (
            await a.server.inject({
              method: "POST",
              url: authPaths.createAccount,
              payload: { ...body, initData: body.initData.replace("7103", "7104") },
            })
          ).statusCode,
        ).toBe(401);
        expect(
          await admin
            .forModule("users")
            .execute((client) => client.user.count({ where: { telegramUserId: 7104n } })),
        ).toBe(0);
        expect(
          (await a.server.inject({ method: "POST", url: authPaths.createAccount, payload: body }))
            .statusCode,
        ).toBe(200);
        await admin
          .forModule("users")
          .execute((client) =>
            client.user.update({ where: { telegramUserId: 7103n }, data: { status: "BLOCKED" } }),
          );
        expect(
          (
            await a.server.inject({
              method: "POST",
              url: authPaths.createAccount,
              payload: { ...body, displayName: "Changed" },
            })
          ).statusCode,
        ).toBe(401);
        const row = await admin
          .forModule("users")
          .execute((client) => client.user.findUniqueOrThrow({ where: { telegramUserId: 7103n } }));
        expect(row.status).toBe("BLOCKED");
        expect(row.displayName).toBe("Mehdi");
      } finally {
        a.rate.close();
        await a.app.close();
      }
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
        const profile = await a.server.inject({ url: "/v1/me", headers });
        expect(profile.statusCode).toBe(200);
        const command = {
          schemaVersion: 1,
          commandId: randomUUID(),
          expectedVersion: profile.json().version,
          patch: { settings: { theme: "light" } },
        };
        expect(
          (await a.server.inject({ method: "PATCH", url: "/v1/me", headers, payload: command }))
            .statusCode,
        ).toBe(503);
        expect((await a.server.inject({ url: "/v1/me", headers })).json()).toEqual(profile.json());
        expect(a.logs.join("")).toContain("profile.rate_read_unavailable");
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
    it("denies HTTP onboarding, issuance, inspection and logout when the database adapter is closed", async () => {
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
          (
            await a.server.inject({
              method: "POST",
              url: authPaths.createAccount,
              payload: accountPayload(7105),
            })
          ).statusCode,
        ).toBe(503);
        expect(
          await admin
            .forModule("users")
            .execute((client) => client.user.count({ where: { telegramUserId: 7105n } })),
        ).toBe(0);
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
          PROFILE_READ_LIMIT: "60",
          PROFILE_WRITE_LIMIT: "10",
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
        const created = await fetch(`http://127.0.0.1:${port}${authPaths.createAccount}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 1,
            commandId: randomUUID(),
            initData: data,
            displayName: "Ignored retry",
          }),
        });
        expect(created.status).toBe(200);
        const projection = (await created.json()) as { account: { userId: string } };
        expect(projection.account.userId).toBe(userId);
        expect(Object.keys(projection).sort()).toEqual(["account", "schemaVersion"]);
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
        const profileHeaders = {
          authorization: `Bearer ${result.accessToken}`,
          "content-type": "application/json",
        };
        const profileResponse = await fetch(`http://127.0.0.1:${port}/v1/me`, {
          headers: profileHeaders,
        });
        expect(profileResponse.status).toBe(200);
        const profile = (await profileResponse.json()) as { version: number; publicHandle: string };
        const profileCommand = {
          schemaVersion: 1,
          commandId: randomUUID(),
          expectedVersion: profile.version,
          patch: { settings: { locale: "fa" } },
        };
        const edited = await fetch(`http://127.0.0.1:${port}/v1/me`, {
          method: "PATCH",
          headers: profileHeaders,
          body: JSON.stringify(profileCommand),
        });
        expect(edited.status).toBe(200);
        const latest = await fetch(`http://127.0.0.1:${port}/v1/me`, { headers: profileHeaders });
        expect(await latest.json()).toMatchObject({
          version: profile.version + 1,
          publicHandle: profile.publicHandle,
          settings: { locale: "fa" },
        });
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
    it("recovers from an actual Redis restart without losing durable sessions or onboarding accounts", async () => {
      const name = process.env.TEST_AUTH_REDIS_CONTAINER;
      if (!name || !/^hambazi-auth-http-[a-f0-9-]{36}$/.test(name))
        throw new Error("Expected harness-owned disposable Redis container");
      const a = await transport(`integration:${randomUUID()}`);
      try {
        const account = await a.server.inject({
          method: "POST",
          url: authPaths.createAccount,
          payload: accountPayload(7106),
        });
        expect(account.statusCode).toBe(200);
        const issued = await a.server.inject({
          method: "POST",
          url: authPaths.issue,
          payload: payload(),
        });
        expect(issued.statusCode).toBe(200);
        await promisify(execFile)("docker", ["stop", "--time", "1", name]);
        expect(
          (
            await a.server.inject({
              method: "POST",
              url: authPaths.createAccount,
              payload: accountPayload(7107),
            })
          ).statusCode,
        ).toBe(503);
        expect(
          await admin
            .forModule("users")
            .execute((client) => client.user.count({ where: { telegramUserId: 7107n } })),
        ).toBe(0);
        expect(
          (await a.server.inject({ method: "POST", url: authPaths.issue, payload: payload() }))
            .statusCode,
        ).toBe(503);
        const headers = { authorization: `Bearer ${issued.json().accessToken}` };
        expect((await a.server.inject({ url: authPaths.inspect, headers })).statusCode).toBe(200);
        const profile = await a.server.inject({ url: "/v1/me", headers });
        expect(profile.statusCode).toBe(200);
        const command = {
          schemaVersion: 1,
          commandId: randomUUID(),
          expectedVersion: profile.json().version,
          patch: { settings: { theme: "light" } },
        };
        expect(
          (await a.server.inject({ method: "PATCH", url: "/v1/me", headers, payload: command }))
            .statusCode,
        ).toBe(503);
        expect((await a.server.inject({ url: "/v1/me", headers })).json()).toEqual(profile.json());
        expect(a.logs.join("")).toContain("profile.rate_read_unavailable");
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
        let profileRecovered = false;
        for (let i = 0; i < 40; i++) {
          if ((await a.profileRate.consume("read", userId)).allowed) {
            profileRecovered = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        expect(profileRecovered).toBe(true);
        expect(
          (await a.server.inject({ method: "PATCH", url: "/v1/me", headers, payload: command }))
            .statusCode,
        ).toBe(200);
        const retry = await a.server.inject({
          method: "POST",
          url: authPaths.createAccount,
          payload: { ...accountPayload(7106), displayName: "Ignored" },
        });
        expect(retry.statusCode).toBe(200);
        expect(retry.json()).toEqual(account.json());
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

accountIntegrationCases(admin);
botOnboardingIntegrationCases(admin);
botInternalIntegrationCases(admin);
