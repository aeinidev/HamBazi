import process from "node:process";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { request } from "node:https";
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { createDatabase } from "@hambazi/database";
import { createBotOnboarding, createRedisAuthRateLimiter } from "../../src/auth/index.js";
import {
  createAccountCreationPort,
  createUserIdentityPort,
  createRegistrationPort,
} from "../../src/users/index.js";
import { createSafeLogger } from "../../src/composition/safe-logger.js";
import { internalHarness, testCertificate, bearer } from "../http/bot-internal-fixture.js";
// Test-only cross-process composition uses built Bot artifacts; no production API→Bot edge.
import { createBackend } from "../../../bot/dist/backend.js";
import { createDeliveryHandler } from "../../../bot/dist/delivery.js";
import { createBotHttp, webhookPath } from "../../../bot/dist/composition/http.js";
import { ownerAdmissionPolicy } from "../../src/auth/application/owner-admission.js";
import { createBotTiming } from "../../../bot/dist/timing.js";
import { createBotLogger } from "../../../bot/dist/composition/logger.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed"
)
  throw new Error("Use isolated auth HTTP harness");
describe.skipIf(!process.env.TEST_AUTH_REDIS_URL)(
  "Bot webhook → private HTTPS → durable onboarding",
  () => {
    const database = createDatabase({
      databaseUrl: { reveal: () => process.env.API_DATABASE_URL },
      poolMax: 8,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      transactionMaxWaitMs: 5000,
      transactionTimeoutMs: 5000,
    });
    const admin = createDatabase({
      databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL },
      poolMax: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      transactionMaxWaitMs: 5000,
      transactionTimeoutMs: 5000,
    });
    let tls;
    let sequence = 500000;
    const closes = [];
    beforeAll(async () => {
      await Promise.all([database.connect(), admin.connect()]);
      tls = await testCertificate();
    });
    afterEach(async () => {
      for (const close of closes.splice(0).reverse()) await close();
    });
    afterAll(async () => {
      await Promise.all([database.disconnect(), admin.disconnect()]);
    });
    async function setup(supportEnabled = false) {
      const identity = ++sequence;
      const ownerAdmission = ownerAdmissionPolicy({ readOwner: async () => String(identity) });
      const clock = {
        value: Date.now(),
        nowMs() {
          return this.value;
        },
      };
      const rate = createRedisAuthRateLimiter({
        url: { reveal: () => process.env.TEST_AUTH_REDIS_URL },
        namespace: randomUUID(),
        ipLimit: 100,
        identityLimit: 30,
      });
      await rate.connect();
      closes.push(async () => rate.close());
      const onboarding = createBotOnboarding({
        database,
        accounts: createAccountCreationPort(database),
        users: createUserIdentityPort(database),
        registration: createRegistrationPort(database, clock),
        clock,
        leaseMs: 15000,
        ...(supportEnabled ? { ownerAdmission } : {}),
      });
      const api = await internalHarness({
        tls,
        onboarding,
        limiter: rate.limiter,
        logger: createSafeLogger({ write: () => {} }),
      });
      closes.push(() => api.app.close());
      let messageId = 900;
      const sender = {
        send: vi.fn(async () => messageId++),
        sendSupport: vi.fn(async () => messageId++),
      };
      const outputs = [];
      async function instance(failAck = false) {
        const client = createBackend({
          origin: `https://127.0.0.1:${api.port}`,
          ca: tls.cert,
          bearer: { reveal: () => bearer },
          timeoutMs: 2000,
        });
        closes.push(async () => client.close());
        const backend = failAck
          ? {
              ...client.backend,
              async acknowledge() {
                throw new Error("Synthetic ack interruption");
              },
            }
          : client.backend;
        const logger = createBotLogger({ write: (v) => outputs.push(v) });
        const bot = createBotHttp({
          tls,
          secret: { reveal: () => "w".repeat(40) },
          backend,
          handle: createDeliveryHandler({
            backend,
            sender,
            botId: "123",
            username: "hambazi_test_bot",
            timing: createBotTiming(logger.telemetry),
            ...(supportEnabled ? { ownerAdmission } : {}),
          }),
          timeoutMs: 10000,
          maxInFlight: 8,
          logger,
        });
        await bot.server.listen({ host: "127.0.0.1", port: 0 });
        closes.push(bot.close);
        const port = bot.server.server.address().port;
        return {
          close: bot.close,
          post: (body) =>
            new Promise((resolve, reject) => {
              const req = request(
                {
                  host: "127.0.0.1",
                  port,
                  path: webhookPath,
                  method: "POST",
                  ca: tls.cert,
                  agent: false,
                  headers: {
                    "content-type": "application/json",
                    "x-telegram-bot-api-secret-token": "w".repeat(40),
                  },
                },
                (res) => {
                  res.resume();
                  res.once("end", () => resolve(res.statusCode));
                },
              );
              req.on("error", reject);
              req.end(JSON.stringify(body));
            }),
        };
      }
      const update = (text, reply) => ({
        update_id: ++sequence,
        message: {
          message_id: sequence,
          from: { id: identity, is_bot: false, first_name: "Mehdi" },
          chat: { id: identity, type: "private" },
          text,
          ...(reply
            ? {
                reply_to_message: {
                  message_id: reply,
                  from: { id: 123, is_bot: true },
                  chat: { id: identity, type: "private" },
                },
              }
            : {}),
        },
      });
      const count = () =>
        admin
          .forModule("users")
          .execute((db) => db.user.count({ where: { telegramUserId: BigInt(identity) } }));
      return { clock, rate, sender, outputs, instance, update, count };
    }
    it("confirms support through real private HTTPS/PostgreSQL in one webhook, then serves the profile without waiting for a worker/lease", async () => {
      const f = await setup(true);
      const bot = await f.instance();
      expect(await bot.post(f.update("ایجاد حساب کاربری"))).toBe(200);
      expect(await bot.post(f.update("ارتباط با پشتیبان"))).toBe(200);
      const input = f.update("Isolated private support fixture");
      const started = performance.now();
      expect(await bot.post(input)).toBe(200);
      const durationMs = performance.now() - started;
      // Safety guard against introducing a 15-second lease/schedule wait again.
      expect(durationMs).toBeLessThan(2000);
      expect(f.sender.sendSupport).toHaveBeenCalledOnce();
      expect(f.sender.send.mock.calls.at(-1)[0].reply).toBe("SUPPORT_SENT");
      expect(await bot.post(input)).toBe(200);
      expect(f.sender.sendSupport).toHaveBeenCalledOnce();
      expect(await bot.post(f.update("پروفایل من"))).toBe(200);
      expect(f.sender.send.mock.calls.at(-1)[0].reply).toBe("PROFILE");
      const stages = f.outputs
        .map((v) => JSON.parse(v))
        .filter((e) => e.event === "bot.stage_completed");
      expect(stages.some((e) => e.operation === "bot_support_send")).toBe(true);
      expect(stages.filter((e) => e.operation === "bot_support_send")).toHaveLength(1);
      expect(f.outputs.join("")).not.toContain("Isolated private support fixture");
    });
    it("registers only on explicit intent, suppresses duplicates and survives Bot restart", async () => {
      const f = await setup();
      const bot = await f.instance();
      expect(await bot.post(f.update("/start"))).toBe(200);
      expect(await f.count()).toBe(0);
      const name = f.update("ایجاد حساب کاربری");
      expect(await bot.post(name)).toBe(200);
      expect(await f.count()).toBe(1);
      expect(f.sender.send).toHaveBeenCalledTimes(2);
      await bot.close();
      const restarted = await f.instance();
      expect(await restarted.post(name)).toBe(200);
      expect(f.sender.send).toHaveBeenCalledTimes(2);
      expect(await f.count()).toBe(1);
      expect(f.outputs.join("")).not.toContain("Mehdi");
    });
    it("retries send failure after lease expiry instead of acknowledging incomplete work", async () => {
      const f = await setup();
      const bot = await f.instance();
      const update = f.update("/create");
      f.sender.send.mockRejectedValueOnce(new Error("Synthetic send failure"));
      expect(await bot.post(update)).toBe(503);
      expect(await bot.post(update)).toBe(503);
      f.clock.value += 15001;
      expect(await bot.post(update)).toBe(200);
      expect(f.sender.send).toHaveBeenCalledTimes(2);
    });
    it("recovers ambiguous send/ack interruption after restart without repeating account effects", async () => {
      const f = await setup();
      const good = await f.instance();
      expect(await good.post(f.update("/start"))).toBe(200);
      const name = f.update("ایجاد حساب کاربری");
      const interrupted = await f.instance(true);
      expect(await interrupted.post(name)).toBe(503);
      expect(await f.count()).toBe(1);
      await interrupted.close();
      f.clock.value += 15001;
      expect(await good.post(name)).toBe(200);
      expect(await f.count()).toBe(1);
      expect(f.sender.send).toHaveBeenCalledTimes(3);
    });
    it("concurrent duplicate webhooks admit one backend effect and one send", async () => {
      const f = await setup();
      const a = await f.instance();
      const b = await f.instance();
      const update = f.update("/create");
      const statuses = await Promise.all([a.post(update), b.post(update)]);
      expect(statuses).toContain(200);
      expect(statuses.every((s) => s === 200 || s === 503)).toBe(true);
      expect(f.sender.send).toHaveBeenCalledOnce();
    });
    it("does not acknowledge when distributed admission is unavailable", async () => {
      const f = await setup();
      const bot = await f.instance();
      f.rate.close();
      expect(await bot.post(f.update("/create"))).toBe(503);
      expect(f.sender.send).not.toHaveBeenCalled();
      expect(await f.count()).toBe(0);
    });
  },
);
