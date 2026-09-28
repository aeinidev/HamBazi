import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { Queue } from "bullmq";
import { createDatabase } from "@hambazi/database";
import { createMatchOutboxPort, type MatchDomainEvent } from "@hambazi/api/matches";
import {
  createBullMqDomainPublisher,
  createOutboxDispatcher,
  outboxQueueNames,
} from "../../src/outbox-dispatcher.js";
import { queueConnection } from "../../src/queue-connection.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed" ||
  !process.env.TEST_DATABASE_URL ||
  !process.env.WORKER_DATABASE_URL ||
  !process.env.TEST_WORKER_REDIS_URL
)
  throw new Error("Use isolated test:auth-http:local harness");
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
const a = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
});
const b = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
});
const policy = { leaseMs: 1000, maxAttempts: 2, backoffMs: 100, maxBackoffMs: 500 };
let at = 1000;
const clock = { nowMs: () => at };
const first = createMatchOutboxPort(a, { clock, policy });
const second = createMatchOutboxPort(b, { clock, policy });
beforeAll(() => Promise.all([admin.connect(), a.connect(), b.connect()]));
beforeEach(async () => {
  at = 1000;
  // This harness owns every record in the disposable cluster. Isolate pending work
  // left by prior suites before exercising the global outbox scanner.
  await admin.forModule("matches").execute((db) =>
    db.outboxEvent.updateMany({
      where: { status: "PENDING" },
      data: { status: "FAILED", claimedUntil: null },
    }),
  );
});
afterAll(() => Promise.all([admin.disconnect(), a.disconnect(), b.disconnect()]));
function data(type = "MATCH_CHANGED_V1") {
  const id = randomUUID(),
    matchId = randomUUID();
  return {
    id,
    aggregateId: matchId,
    type,
    schemaVersion: 1,
    status: "PENDING",
    createdAt: new Date(at),
    nextAttemptAt: new Date(at),
    requestId: randomUUID(),
    traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
    payloadJsonb: { schemaVersion: 1, matchId, stateVersion: 5, lastEventSeq: 7, status: "ACTIVE" },
  };
}
async function seed(type?: string) {
  const row = data(type);
  await admin.forModule("matches").execute((db) => db.outboxEvent.create({ data: row }));
  return row.id;
}
function read(id: string) {
  return admin
    .forModule("matches")
    .execute((db) => db.outboxEvent.findUniqueOrThrow({ where: { id } }));
}
it("cannot see uncommitted/rolled-back outbox rows and claims only after commit", async () => {
  const row = data();
  let inserted!: () => void;
  let release!: () => void;
  const visible = new Promise<void>((r) => {
    inserted = r;
  });
  const unblock = new Promise<void>((r) => {
    release = r;
  });
  const transaction = admin.forModule("matches").transaction(async (db) => {
    await db.outboxEvent.create({ data: row });
    inserted();
    await unblock;
  });
  await visible;
  expect(await first.claim(10)).toEqual([]);
  release();
  await transaction;
  expect((await first.claim(10)).map((c) => c.eventId)).toEqual([row.id]);
  const rollback = data();
  await expect(
    admin.forModule("matches").transaction(async (db) => {
      await db.outboxEvent.create({ data: rollback });
      throw new Error("synthetic rollback");
    }),
  ).rejects.toThrow();
  expect(await second.claim(10)).toEqual([]);
});
it("partitions skip-locked claims across workers and fences expired attempts", async () => {
  const ids = await Promise.all(Array.from({ length: 6 }, () => seed()));
  const batches = await Promise.all([first.claim(3), second.claim(3)]);
  const claims = batches.flat();
  expect(new Set(claims.map((c) => c.eventId)).size).toBe(6);
  expect(claims.map((c) => c.eventId).sort()).toEqual(ids.sort());
  expect(await second.claim(10)).toEqual([]);
  at += 1000;
  expect(await first.published(claims[0]!.eventId, 1)).toBe(false);
  const reclaimed = await second.claim(10);
  expect(reclaimed).toHaveLength(6);
  expect(reclaimed.every((c) => c.attempt === 2)).toBe(true);
  expect(await first.failed(claims[0]!.eventId, 1)).toBe(false);
  expect(await second.published(claims[0]!.eventId, 2)).toBe(true);
  at += 1000;
  expect(await second.claim(10)).toEqual([]);
  expect((await read(claims[1]!.eventId)).status).toBe("FAILED");
});
it("backs off, stops exhausted delivery, rejects released claims and redrives without reusing fencing tokens", async () => {
  const id = await seed();
  await first.claim(1);
  expect(await first.failed(id, 1)).toBe(true);
  expect(await first.published(id, 1)).toBe(false);
  expect(await second.claim(1)).toEqual([]);
  at += 100;
  expect((await second.claim(1))[0]!.attempt).toBe(2);
  await second.failed(id, 2);
  expect((await read(id)).status).toBe("FAILED");
  expect(await first.redrive(id)).toBe(true);
  expect((await first.claim(1))[0]!.attempt).toBe(3);
  expect(await second.published(id, 2)).toBe(false);
  expect(await first.published(id, 3)).toBe(true);
  expect((await read(id)).publishedAt).not.toBeNull();
});
it("preserves legacy matchmaking.found v1 and quarantines malformed or unknown events", async () => {
  const row = data("matchmaking.found");
  await admin.forModule("matches").execute((db) =>
    db.outboxEvent.create({
      data: {
        ...row,
        payloadJsonb: {
          schemaVersion: 1,
          matchId: row.aggregateId,
          reservationId: randomUUID(),
          extra: "SYNTHETIC_PRIVATE",
        },
      },
    }),
  );
  await seed("unknown.event.v2");
  const claims = await first.claim(10);
  const legacy = claims.find((c) => c.eventId === row.id)!;
  expect(legacy.event?.type).toBe("matchmaking.found");
  expect(JSON.stringify(legacy.event)).not.toContain("SYNTHETIC_PRIVATE");
  const unknown = claims.find((c) => c.event === null)!;
  await first.failed(unknown.eventId, unknown.attempt, true);
  expect((await read(unknown.eventId)).status).toBe("FAILED");
});
it("survives publish-before-mark failure and preserves eventId/context through real BullMQ deduplication", async () => {
  const id = await seed();
  const namespace = randomUUID();
  const redisUrl = { reveal: () => process.env.TEST_WORKER_REDIS_URL! };
  const publisher = await createBullMqDomainPublisher({
    redisUrl,
    namespace,
    timeoutMs: 1000,
    attempts: 2,
    backoffMs: 100,
    event: () => {},
  });
  const queue = new Queue(outboxQueueNames.MATCH_CHANGED_V1, {
    prefix: `hambazi:jobs:${namespace}`,
    connection: queueConnection(redisUrl, false),
  });
  const brokenMark = {
    ...first,
    published: async () => {
      throw new Error("synthetic lost mark");
    },
  };
  const dispatch = createOutboxDispatcher({
    outbox: brokenMark,
    publisher,
    batchSize: 1,
    publishTimeoutMs: 500,
    event: () => {},
  });
  try {
    await dispatch.runOnce();
    const initial = await queue.getJob(id);
    expect(initial).toBeDefined();
    expect(initial!.data.correlation.traceparent).toBe((await read(id)).traceparent);
    expect((await read(id)).status).toBe("PENDING");
    at += 1000;
    const retry = createOutboxDispatcher({
      outbox: second,
      publisher,
      batchSize: 1,
      publishTimeoutMs: 500,
      event: () => {},
    });
    await retry.runOnce();
    await retry.close();
    expect((await read(id)).status).toBe("PUBLISHED");
    expect(await queue.getWaitingCount()).toBe(1);
    // Simulate queue data loss, then replay the retained durable event by original ID.
    await initial!.remove();
    expect(await queue.getJob(id)).toBeUndefined();
    expect(await first.redrive(id)).toBe(true);
    const recovery = createOutboxDispatcher({
      outbox: first,
      publisher,
      batchSize: 1,
      publishTimeoutMs: 500,
      event: () => {},
    });
    await recovery.runOnce();
    await recovery.close();
    expect((await queue.getJob(id))!.data.eventId).toBe(id);
  } finally {
    await dispatch.close();
    await publisher.close();
    await queue.close();
  }
});
it("keeps the database pending after an unavailable queue and recovers with the same event", async () => {
  const id = await seed();
  const sent: MatchDomainEvent[] = [];
  let unavailable = true;
  const publisher = {
    async publish(event: MatchDomainEvent) {
      if (unavailable) throw new Error("synthetic unavailable queue");
      sent.push(event);
    },
    async close() {},
  };
  const dispatcher = createOutboxDispatcher({
    outbox: first,
    publisher,
    batchSize: 1,
    publishTimeoutMs: 100,
    event: () => {},
  });
  await dispatcher.runOnce();
  expect((await read(id)).status).toBe("PENDING");
  expect(sent).toHaveLength(0);
  at += 100;
  unavailable = false;
  await dispatcher.runOnce();
  await dispatcher.close();
  expect((await read(id)).status).toBe("PUBLISHED");
  expect(sent.map((event) => event.eventId)).toEqual([id]);
});
it("restricts SQL claims to the outbox scope and Worker writes to delivery fields", async () => {
  const id = await seed();
  await expect(
    a.forModule("outbox").execute((db) => db.lockDueOutbox(new Date(at), 1)),
  ).rejects.toThrow();
  await expect(
    a
      .forModule("outbox")
      .execute((db) =>
        db.outboxEvent.update({ where: { id }, data: { payloadJsonb: { forged: true } } }),
      ),
  ).rejects.toThrow();
  await a.forModule("matches").execute(async (db) => {
    expect("lockDueOutbox" in db).toBe(false);
  });
});

it("starts configured polling in the Worker runtime and drains before closing database/publisher", async () => {
  const { startWorker } = await import("../../src/composition/runtime.js");
  const id = await seed();
  const events: string[] = [];
  const runtime = await startWorker(
    {
      NODE_ENV: "test",
      WORKER_DATABASE_URL: process.env.WORKER_DATABASE_URL,
      WORKER_REDIS_URL: process.env.TEST_WORKER_REDIS_URL,
      WORKER_QUEUE_NAMESPACE: randomUUID(),
      BOT_CLEANUP_INTERVAL_MS: "60000",
      BOT_CLEANUP_BATCH_SIZE: "2",
      BOT_CLEANUP_ATTEMPTS: "2",
      BOT_CLEANUP_BACKOFF_MS: "100",
      WORKER_DB_POOL_MAX: "4",
      MATCH_OUTBOX_ENABLED: "true",
      MATCH_OUTBOX_INTERVAL_MS: "100",
      MATCH_OUTBOX_BATCH_SIZE: "3",
      MATCH_OUTBOX_LEASE_MS: "10000",
      MATCH_OUTBOX_ATTEMPTS: "3",
      MATCH_OUTBOX_BACKOFF_MS: "100",
      MATCH_OUTBOX_MAX_BACKOFF_MS: "500",
      MATCH_OUTBOX_PUBLISH_TIMEOUT_MS: "1000",
    },
    (event) => events.push(event),
  );
  try {
    const deadline = Date.now() + 5000;
    while ((await read(id)).status !== "PUBLISHED") {
      if (Date.now() >= deadline) throw new Error("Outbox runtime did not publish fixture");
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(events).toContain("worker.outbox_published");
  } finally {
    await runtime.close();
    await runtime.close();
  }
});
