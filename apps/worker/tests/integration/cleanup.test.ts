import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Queue, Worker } from "bullmq";
import { createDatabase } from "@hambazi/database";
import { createBotOnboardingCleanup } from "@hambazi/api/auth";
import { startCleanupQueue } from "../../src/onboarding-cleanup.js";
import { startWorker } from "../../src/composition/runtime.js";
import { createServiceHealth, withDeadline } from "@hambazi/observability";
import { probeQueue, queueConnection, requeueForDrain } from "../../src/queue-connection.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed" ||
  !process.env.TEST_DATABASE_URL ||
  !process.env.WORKER_DATABASE_URL ||
  !process.env.TEST_WORKER_REDIS_URL
)
  throw new Error("Use the isolated root test:auth-http:local harness");
const dbConfig = {
  poolMax: 4,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 2000,
  transactionTimeoutMs: 5000,
};
const admin = createDatabase({
  ...dbConfig,
  databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL! },
});
const workerDb = createDatabase({
  ...dbConfig,
  databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
});
beforeAll(async () => {
  await Promise.all([admin.connect(), workerDb.connect()]);
});
afterAll(async () => {
  await Promise.all([admin.disconnect(), workerDb.disconnect()]);
});
let seq = 300000;
async function seed(expired = true) {
  const id = randomUUID();
  const flowId = randomUUID();
  const createdAt = new Date(expired ? "2000-01-01T00:00:00Z" : "2035-01-01T00:00:00Z");
  const updateId = ++seq;
  await admin.forModule("auth").execute(async (db) => {
    await db.botUpdateReceipt.create({
      data: {
        id,
        botId: 987n,
        updateId,
        telegramUserId: BigInt(updateId),
        messageId: 1,
        schemaVersion: 1,
        action: "START",
        phase: "PROCESSING",
        version: 1,
        receivedAt: createdAt,
        expiresAt: new Date(createdAt.getTime() + 7 * 86400000),
        leaseUntil: new Date(createdAt.getTime() + 1000),
      },
    });
    await db.botOnboardingFlow.create({
      data: {
        id: flowId,
        botId: 987n,
        telegramUserId: BigInt(updateId),
        schemaVersion: 1,
        version: 1,
        state: "WAITING",
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 900000),
        promptVersion: 1,
      },
    });
  });
  return { id, flowId };
}
async function exists(row: Awaited<ReturnType<typeof seed>>) {
  return admin.forModule("auth").execute(async (db) => ({
    receipt: await db.botUpdateReceipt.count({ where: { id: row.id } }),
    flow: await db.botOnboardingFlow.count({ where: { id: row.flowId } }),
  }));
}
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for cleanup");
    await new Promise((r) => setTimeout(r, 20));
  }
}
const redisUrl = { reveal: () => process.env.TEST_WORKER_REDIS_URL! };
const cleanup = createBotOnboardingCleanup(workerDb, { nowMs: () => Date.now() });
function queueOptions() {
  return {
    redisUrl,
    namespace: randomUUID(),
    intervalMs: 60000,
    batchSize: 2,
    attempts: 3,
    backoffMs: 100,
    cleanup,
    event: () => {},
  };
}
function inspectQueue(namespace: string) {
  const url = new URL(redisUrl.reveal());
  return new Queue("bot-onboarding-cleanup-v1", {
    prefix: `hambazi:jobs:${namespace}`,
    connection: {
      host: url.hostname,
      port: Number(url.port),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      maxRetriesPerRequest: 1,
    },
  });
}
describe("cleanup with Worker PostgreSQL grants and Redis ACL", () => {
  it("returns a fetch racing local pause to waiting without spending its only failure attempt", async () => {
    const namespace = randomUUID();
    const queue = inspectQueue(namespace);
    const worker = new Worker(
      "bot-onboarding-cleanup-v1",
      (job, token) => requeueForDrain(job, token!),
      {
        connection: queueConnection(redisUrl, true),
        prefix: `hambazi:jobs:${namespace}`,
        autorun: false,
      },
    );
    worker.on("error", () => {});
    worker.on("active", () => {
      void worker.pause(true);
    });
    let recovery: Worker | undefined;
    try {
      await worker.waitUntilReady();
      const job = await queue.add("drain-race", { schemaVersion: 1 }, { attempts: 1 });
      void worker.run();
      await until(async () => worker.isPaused() && (await job.getState()) === "waiting");
      expect((await queue.getJob(job.id!))?.attemptsMade).toBe(0);
      await worker.close();
      recovery = new Worker("bot-onboarding-cleanup-v1", async () => ({ schemaVersion: 1 }), {
        connection: queueConnection(redisUrl, true),
        prefix: `hambazi:jobs:${namespace}`,
      });
      recovery.on("error", () => {});
      await until(async () => (await job.getState()) === "completed");
      expect((await queue.getJob(job.id!))?.attemptsMade).toBe(1);
    } finally {
      await worker.close();
      await recovery?.close();
      await queue.disconnect();
      await queue.close();
    }
  });
  it("fails required queue readiness on a real connection loss and recovers on a fresh connection", async () => {
    const namespace = randomUUID();
    let queue = inspectQueue(namespace);
    const health = createServiceHealth([{ required: true, probe: () => probeQueue(queue) }], 1000);
    health.started();
    try {
      await queue.waitUntilReady();
      expect((await health.ready()).status).toBe("READY");
      await queue.disconnect();
      expect((await health.ready()).status).toBe("NOT_READY");
      await queue.close();
      queue = inspectQueue(namespace);
      await queue.waitUntilReady();
      expect((await health.ready()).status).toBe("READY");
    } finally {
      await queue.disconnect();
      await queue.close();
    }
  });
  it("stops claims and keeps an in-flight PostgreSQL transaction usable after a drain deadline", async () => {
    let entered!: () => void;
    let release!: () => void;
    let ran = 0;
    const started = new Promise<void>((r) => (entered = r));
    const gate = new Promise<void>((r) => (release = r));
    const options = queueOptions();
    const runtime = await startCleanupQueue({
      ...options,
      cleanup: async () => {
        ran++;
        return workerDb.forModule("auth").transaction(async (db) => {
          await db.botUpdateReceipt.count();
          entered();
          await gate;
          await db.botUpdateReceipt.count();
          return { ok: true, receipts: 0, flows: 0 };
        });
      },
    });
    const health = createServiceHealth([{ required: true, probe: () => runtime.probe() }], 200);
    health.started();
    try {
      await started;
      expect((await health.ready()).status).toBe("READY");
      health.stopAdmission();
      const closing = runtime.close();
      expect((await health.ready()).status).toBe("NOT_READY");
      await expect(withDeadline(closing, 20)).rejects.toThrow("Operation deadline exceeded");
      expect(ran).toBe(1);
      release();
      await closing;
      await runtime.settled();
      expect(await workerDb.probe()).toBe(true);
    } finally {
      release();
      await runtime.close();
    }
  });
  it("uses only expiry/ID reads, bounded deletes, and preserves live metadata", async () => {
    const rows = await Promise.all(Array.from({ length: 4 }, () => seed()));
    const live = await seed(false);
    expect(await cleanup({ schemaVersion: 1, limit: 2 })).toMatchObject({
      ok: true,
      receipts: 2,
      flows: 2,
    });
    const remaining = await Promise.all(rows.map(exists));
    expect(remaining.reduce((n, r) => n + r.receipt, 0)).toBe(2);
    expect(remaining.reduce((n, r) => n + r.flow, 0)).toBe(2);
    await cleanup({ schemaVersion: 1, limit: 500 });
    expect(await exists(live)).toEqual({ receipt: 1, flow: 1 });
    await expect(
      workerDb
        .forModule("auth")
        .execute((db) => db.botUpdateReceipt.findMany({ select: { telegramUserId: true } })),
    ).rejects.toThrow();
    await expect(
      workerDb.forModule("auth").execute((db) => db.session.findMany({ select: { id: true } })),
    ).rejects.toThrow();
  });
  it("allows concurrent/repeated cleanup without double deletion", async () => {
    const rows = await Promise.all(Array.from({ length: 4 }, () => seed()));
    const results = await Promise.all([
      cleanup({ schemaVersion: 1, limit: 500 }),
      cleanup({ schemaVersion: 1, limit: 500 }),
    ]);
    for (const result of results) expect(result).not.toHaveProperty("status", "RETRY");
    expect(
      (await Promise.all(rows.map(exists))).every((r) => r.receipt === 0 && r.flow === 0),
    ).toBe(true);
    expect(await cleanup({ schemaVersion: 1, limit: 500 })).toMatchObject({
      receipts: 0,
      flows: 0,
    });
  });
  it("runs a periodic versioned job and retries sanitized transient failures", async () => {
    const row = await seed();
    const options = queueOptions();
    let calls = 0;
    const events: string[] = [];
    const runtime = await startCleanupQueue({
      ...options,
      event: (e) => events.push(e),
      cleanup: async (input) => {
        if (++calls === 1) throw new Error("private failure");
        return cleanup(input);
      },
    });
    const queue = inspectQueue(options.namespace);
    try {
      await until(() => events.includes("worker.job_completed"));
      expect(events).toContain("worker.job_failed");
      expect(calls).toBe(2);
      expect(await exists(row)).toEqual({ receipt: 0, flow: 0 });
      const completed = await queue.getCompleted();
      expect(completed).toHaveLength(1);
      expect(completed[0]!.attemptsMade).toBe(2);
      expect(completed[0]!.data).toEqual({ schemaVersion: 1, limit: 2 });
      expect(JSON.stringify(completed)).not.toContain("private failure");
    } finally {
      await runtime.close();
      await queue.close();
    }
  });
  it("reuses one scheduler across restart and drains in-flight work on shutdown", async () => {
    const options = queueOptions();
    let entered = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = await startCleanupQueue({
      ...options,
      cleanup: async () => {
        entered = true;
        await gate;
        return { ok: true, receipts: 0, flows: 0 };
      },
    });
    const queue = inspectQueue(options.namespace);
    try {
      await until(() => entered);
      let closed = false;
      const closing = first.close().then(() => {
        closed = true;
      });
      await new Promise((r) => setTimeout(r, 30));
      expect(closed).toBe(false);
      release();
      await closing;
      await first.close();
      const second = await startCleanupQueue(options);
      try {
        expect(await queue.getJobSchedulersCount()).toBe(1);
      } finally {
        await second.close();
      }
    } finally {
      release();
      await first.close();
      await queue.close();
    }
  });
  it("composes a real Worker without API/session/Bot credentials", async () => {
    const row = await seed();
    const userId = randomUUID();
    const receiptId = randomUUID();
    await admin.forModule("users").execute(async (db) => {
      await db.user.create({
        data: {
          id: userId,
          telegramUserId: 995999n,
          displayName: "Synthetic",
          publicHandle: "worker_profile_fixture",
          status: "ACTIVE",
        },
      });
      await db.profileMutationReceipt.create({
        data: {
          id: receiptId,
          userId,
          commandId: randomUUID(),
          requestDigest: "a".repeat(64),
          appliedVersion: 1,
          createdAt: new Date("2000-01-01T00:00:00Z"),
          expiresAt: new Date("2000-01-08T00:00:00Z"),
        },
      });
    });
    const events: string[] = [];
    const runtime = await startWorker(
      {
        NODE_ENV: "test",
        WORKER_DATABASE_URL: process.env.WORKER_DATABASE_URL,
        WORKER_REDIS_URL: redisUrl.reveal(),
        WORKER_QUEUE_NAMESPACE: randomUUID(),
        BOT_CLEANUP_INTERVAL_MS: "1000",
        BOT_CLEANUP_BATCH_SIZE: "2",
        BOT_CLEANUP_ATTEMPTS: "2",
        BOT_CLEANUP_BACKOFF_MS: "100",
        WORKER_DB_POOL_MAX: "2",
      },
      (e) => events.push(e),
    );
    try {
      await until(() => events.includes("worker.job_completed"));
      expect(await exists(row)).toEqual({ receipt: 0, flow: 0 });
      await until(
        async () =>
          (await admin
            .forModule("users")
            .execute((db) => db.profileMutationReceipt.count({ where: { id: receiptId } }))) === 0,
      );
    } finally {
      await runtime.close();
      await runtime.close();
      expect((await runtime.health.ready()).status).toBe("NOT_READY");
    }
  });
  it("fails startup boundedly without leaking Redis credentials", async () => {
    const options = queueOptions();
    const unavailable = new URL(redisUrl.reveal());
    unavailable.port = "1";
    await expect(
      startCleanupQueue({ ...options, redisUrl: { reveal: () => unavailable.toString() } }),
    ).rejects.toThrow(/^Onboarding cleanup queue startup failed$/);
  }, 10000);
});
