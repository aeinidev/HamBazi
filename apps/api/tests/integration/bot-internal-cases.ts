import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { request } from "node:https";
import { startApi } from "../../src/composition/runtime.js";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "@hambazi/database";
import {
  createBotOnboarding,
  createRedisAuthRateLimiter,
  botInternalPaths as paths,
} from "../../src/auth/index.js";
import { createUserIdentityPort, createAccountCreationPort } from "../../src/users/index.js";
import { createSafeLogger } from "../../src/composition/safe-logger.js";
import {
  internalHarness,
  testCertificate,
  withTestCertificate,
  serviceEnvironment,
  bearer,
} from "../http/bot-internal-fixture.js";
import { update } from "../auth/bot-onboarding-fixtures.js";
export function botInternalIntegrationCases(admin: ReturnType<typeof createDatabase>) {
  async function freePort() {
    const socket = createServer();
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.listen(0, "127.0.0.1", resolve);
    });
    const address = socket.address();
    if (!address || typeof address === "string") throw new Error("Expected test port");
    await new Promise<void>((resolve, reject) => socket.close((e) => (e ? reject(e) : resolve())));
    return address.port;
  }
  describe.skipIf(!process.env.TEST_AUTH_REDIS_URL)(
    "private HTTPS with durable onboarding and distributed admission",
    () => {
      const database = createDatabase({
        databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
        poolMax: 8,
        connectionTimeoutMs: 2000,
        idleTimeoutMs: 1000,
        transactionMaxWaitMs: 5000,
        transactionTimeoutMs: 5000,
      });
      let tls: Awaited<ReturnType<typeof testCertificate>>;
      const active: { close(): Promise<void> }[] = [];
      let seq = 200000;
      beforeAll(async () => {
        await database.connect();
        tls = await testCertificate();
      });
      afterEach(async () => {
        await Promise.all(active.splice(0).map((h) => h.close()));
      });
      afterAll(async () => {
        await database.disconnect();
      });
      async function setup(namespace = randomUUID(), limit = 30, identityLimit = 10) {
        const rate = createRedisAuthRateLimiter({
          url: { reveal: () => process.env.TEST_AUTH_REDIS_URL! },
          namespace,
          ipLimit: limit,
          identityLimit,
        });
        await rate.connect();
        const onboarding = createBotOnboarding({
          database,
          accounts: createAccountCreationPort(database),
          users: createUserIdentityPort(database),
          clock: { nowMs: () => Date.now() },
          leaseMs: 5000,
        });
        const http = await internalHarness({
          tls,
          onboarding,
          limiter: rate.limiter,
          logger: createSafeLogger({ write: () => {} }),
        });
        active.push({
          async close() {
            await http.app.close();
            rate.close();
          },
        });
        return { ...http, rate };
      }
      it("starts and closes configured separate listeners with real PEM files and private dependencies", async () => {
        await withTestCertificate(async (tls, files) => {
          const publicPort = await freePort();
          let privatePort = await freePort();
          while (privatePort === publicPort) privatePort = await freePort();
          const env = {
            ...serviceEnvironment,
            NODE_ENV: "test",
            API_DATABASE_URL: process.env.API_DATABASE_URL,
            API_REDIS_URL: process.env.TEST_AUTH_REDIS_URL,
            API_PORT: String(publicPort),
            ALLOWED_ORIGINS: "https://mini.example",
            AUTH_ISSUER: randomUUID(),
            BOT_INTERNAL_ENABLED: "true",
            BOT_INTERNAL_BIND_ADDRESS: "127.0.0.1",
            BOT_INTERNAL_PORT: String(privatePort),
            BOT_INTERNAL_TLS_KEY_FILE: files.keyFile,
            BOT_INTERNAL_TLS_CERT_FILE: files.certFile,
            BOT_INTERNAL_REQUEST_LIMIT: "30",
            BOT_INTERNAL_IDENTITY_LIMIT: "6",
            BOT_ONBOARDING_LEASE_MS: "5000",
          };
          const runtime = await startApi(env, createSafeLogger({ write: () => {} }));
          try {
            const status = await new Promise<number>((resolve, reject) => {
              const req = request(
                {
                  host: "127.0.0.1",
                  port: privatePort,
                  path: paths.admit,
                  method: "POST",
                  agent: false,
                  ca: tls.cert,
                  headers: { authorization: bearer, "content-type": "application/json" },
                },
                (res) => {
                  res.resume();
                  res.once("end", () => resolve(res.statusCode!));
                },
              );
              req.on("error", reject);
              req.setTimeout(2000, () => req.destroy(new Error("test request timeout")));
              req.end(JSON.stringify({ schemaVersion: 1 }));
            });
            expect(status).toBe(200);
            const response = await fetch(`http://127.0.0.1:${publicPort}${paths.admit}`, {
              method: "POST",
              headers: { authorization: bearer, "content-type": "application/json" },
              body: JSON.stringify({ schemaVersion: 1 }),
              signal: AbortSignal.timeout(2000),
            });
            expect(response.status).toBe(404);
            await response.text();
          } finally {
            await runtime.close();
          }
          await expect(
            fetch(`http://127.0.0.1:${publicPort}/`, { signal: AbortSignal.timeout(1000) }),
          ).rejects.toThrow();
          await expect(
            startApi(
              { ...env, BOT_INTERNAL_TLS_KEY_FILE: "/nonexistent/hambazi-test-key.pem" },
              createSafeLogger({ write: () => {} }),
            ),
          ).rejects.toThrow(/^API startup failed$/);
        });
      });
      it("creates one account through prompt acknowledgement and duplicate concurrent name delivery", async () => {
        const f = await setup();
        const sender = String(++seq);
        const create = JSON.parse(
          (await f.post(paths.process, update("CREATE", ++seq, sender))).body,
        );
        expect(create.status).toBe("REPLY");
        const ack = (delivery: { receiptId: string; version: number }, messageId: number) =>
          f.post(paths.acknowledge, {
            schemaVersion: 1,
            receiptId: delivery.receiptId,
            version: delivery.version,
            messageId,
          });
        expect((await ack(create.delivery, 900)).status).toBe(200);
        const name = update("NAME", ++seq, sender);
        const responses = await Promise.all([
          f.post(paths.process, name),
          f.post(paths.process, name),
        ]);
        expect(responses.map((r) => r.status).sort()).toEqual([200, 503]);
        const result = JSON.parse(responses.find((r) => r.status === 200)!.body);
        expect(result.delivery.reply).toBe("MENU");
        expect((await ack(result.delivery, 901)).status).toBe(200);
        expect(JSON.parse((await f.post(paths.process, name)).body).status).toBe("DONE");
        expect(
          await admin
            .forModule("users")
            .execute((db) => db.user.count({ where: { telegramUserId: BigInt(sender) } })),
        ).toBe(1);
      });
      it("shares admission budget across API instances and all internal routes", async () => {
        const namespace = randomUUID();
        const a = await setup(namespace, 2);
        const b = await setup(namespace, 2);
        expect((await a.post(paths.admit, { schemaVersion: 1 })).status).toBe(200);
        expect((await b.post(paths.process, update("START", ++seq, String(seq)))).status).toBe(200);
        expect(
          (
            await a.post(paths.acknowledge, {
              schemaVersion: 1,
              receiptId: randomUUID(),
              version: 1,
              messageId: 1,
            })
          ).status,
        ).toBe(429);
      });
      it("shares per-sender limits across instances without conflating different senders", async () => {
        const namespace = randomUUID();
        const a = await setup(namespace, 30, 1);
        const b = await setup(namespace, 30, 1);
        const sender = String(++seq);
        expect((await a.post(paths.process, update("START", ++seq, sender))).status).toBe(200);
        expect((await b.post(paths.process, update("START", ++seq, sender))).status).toBe(429);
        expect((await b.post(paths.process, update("START", ++seq, String(seq)))).status).toBe(200);
      });
      it("cannot report successful admission when the Redis connection is unavailable", async () => {
        const f = await setup();
        f.rate.close();
        expect((await f.post(paths.admit, { schemaVersion: 1 })).status).toBe(503);
        expect((await f.post(paths.process, update("START", ++seq, String(seq)))).status).toBe(503);
      });
    },
  );
}
