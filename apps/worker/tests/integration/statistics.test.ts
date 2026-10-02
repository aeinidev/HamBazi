import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, afterAll, expect, it } from "vitest";
import { Queue } from "bullmq";
import { queueConnection } from "../../src/queue-connection.js";
import { createStatisticsPort } from "@hambazi/api/leaderboard";
import { createUserIdentityPort, createPublicNamesPort } from "@hambazi/api/users";
import { createDatabase } from "@hambazi/database";
import { createMatchResultPort, type MatchDomainEvent } from "@hambazi/api/matches";
import { createStatisticsProjection } from "@hambazi/api/leaderboard";
import { startStatisticsConsumer, rebuildStatistics } from "../../src/statistics.js";
import { createBullMqDomainPublisher } from "../../src/outbox-dispatcher.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed" ||
  !process.env.TEST_DATABASE_URL ||
  !process.env.WORKER_DATABASE_URL ||
  !process.env.TEST_WORKER_REDIS_URL
)
  throw new Error("Use isolated test:auth-http:local harness");
const options = {
  poolMax: 8,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 5000,
};
const admin = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL! },
});
const worker = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
});
beforeAll(() => Promise.all([admin.connect(), worker.connect()]));
afterAll(() => Promise.all([admin.disconnect(), worker.disconnect()]));
it("consumes real BullMQ finish jobs, redelivery and drain using Worker-only grants", async () => {
  const ids = [randomUUID(), randomUUID()],
    matchId = randomUUID(),
    eventId = randomUUID(),
    at = Date.parse("2026-10-02T16:00:00Z");
  for (const [i, id] of ids.entries())
    await admin.forModule("users").execute((db) =>
      db.user.create({
        data: {
          id,
          telegramUserId: BigInt(36000000 + i),
          publicHandle: `stats_queue_${i}`,
          displayName: "Queue fixture",
          status: "ACTIVE",
        },
      }),
    );
  const event: MatchDomainEvent = {
    schemaVersion: 1,
    eventId,
    aggregateId: matchId,
    occurredAt: at,
    type: "MATCH_FINISHED_V1",
    correlation: {},
    payload: {
      schemaVersion: 1,
      matchId,
      gameId: "coup",
      stateVersion: 1,
      lastEventSeq: 1,
      finishedAt: at,
      engineVersion: "coup-v1",
      stateSchemaVersion: 4,
      rulesetVersion: "v1",
      result: {
        placements: ids.map((playerId, i) => ({ playerId, place: i + 1 })),
        winnerId: ids[0]!,
        reason: "LAST_PLAYER_STANDING",
        metrics: { turnsPlayed: 2 },
      },
    },
  };
  await admin.forModule("matches").transaction(async (db) => {
    await db.match.create({
      data: {
        id: matchId,
        gameId: "coup",
        matchType: "MATCHMAKING",
        status: "FINISHED",
        stateJsonb: { synthetic: true },
        stateVersion: 1,
        lastEventSeq: 1,
        engineVersion: "coup-v1",
        stateSchemaVersion: 4,
        rulesetVersion: "v1",
        finishedAt: new Date(at),
      },
    });
    for (const [seat, userId] of ids.entries())
      await db.matchPlayer.create({
        data: { matchId, userId, seat, agentType: "HUMAN", connectionStatus: "CONNECTED" },
      });
    await db.outboxEvent.create({
      data: {
        id: eventId,
        aggregateId: matchId,
        type: event.type,
        schemaVersion: 1,
        payloadJsonb: event.payload,
        status: "PENDING",
        createdAt: new Date(at),
      },
    });
  });
  const redisUrl = { reveal: () => process.env.TEST_WORKER_REDIS_URL! },
    namespace = `statistics_${randomUUID()}`;
  const projection = createStatisticsProjection(worker, { nowMs: () => at });
  let consumptions = 0;
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const observed = {
    ...projection,
    async consume(input: unknown) {
      const outcome = await projection.consume(input);
      consumptions++;
      if (consumptions === 2) await held;
      return outcome;
    },
  };
  const queue = new Queue("match-finished-v1", {
    connection: queueConnection(redisUrl, false, 2000),
    prefix: `hambazi:jobs:${namespace}`,
  });
  const publisher = await createBullMqDomainPublisher({
    redisUrl,
    namespace,
    timeoutMs: 2000,
    attempts: 3,
    backoffMs: 100,
    event: () => {},
  });
  let consumer: Awaited<ReturnType<typeof startStatisticsConsumer>> | undefined;
  try {
    consumer = await startStatisticsConsumer({
      redisUrl,
      namespace,
      matches: createMatchResultPort(worker),
      statistics: observed,
      concurrency: 2,
      drainTimeoutMs: 5000,
      unavailable: () => {},
      diagnostics: true,
    });
    await publisher.publish(event);
    expect(await consumer.counts()).toMatchObject({
      waiting: expect.any(Number),
      active: expect.any(Number),
      delayed: expect.any(Number),
      failed: expect.any(Number),
    });
    await expect
      .poll(
        () =>
          worker
            .forModule("leaderboard")
            .execute((db) =>
              db.consumerReceipt.count({ where: { consumer: "statistics-v1", eventId } }),
            ),
        { timeout: 5000 },
      )
      .toBe(1);
    await expect
      .poll(async () => (await queue.getJob(eventId)) === undefined, { timeout: 5000 })
      .toBe(true);
    await publisher.publish(event);
    await expect.poll(() => consumptions, { timeout: 5000 }).toBe(2);
    let drained = false;
    const closing = consumer.close().then(() => {
      drained = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(drained).toBe(false);
    release!();
    await closing;
    consumer = undefined;
    const values = await worker
      .forModule("leaderboard")
      .execute((db) =>
        db.statsValue.findMany({ where: { userId: ids[0]!, metric: "wins", period: "all_time" } }),
      );
    expect(values).toHaveLength(1);
    expect(values[0]!.value).toBe(1n);
    const receipt = await createMatchResultPort(worker).record(event);
    expect(await projection.consume(receipt)).toBe("DUPLICATE");
  } finally {
    release?.();
    await consumer?.close();
    await publisher.close();
    await queue.close();
  }
}, 15000);

it("rebuilds multiple pages of legacy finish truth and repairs corrupt aggregate counts", async () => {
  const ids = [randomUUID(), randomUUID()],
    at = Date.parse("2026-10-02T00:00:00Z");
  for (const [i, id] of ids.entries())
    await admin.forModule("users").execute((db) =>
      db.user.create({
        data: {
          id,
          telegramUserId: BigInt(37000000 + i),
          publicHandle: `stats_rebuild_${i}`,
          displayName: "Rebuild fixture",
          status: "ACTIVE",
        },
      }),
    );
  for (let i = 0; i < 30; i++) {
    const matchId = randomUUID(),
      eventId = randomUUID();
    const payload = {
      schemaVersion: 1,
      matchId,
      gameId: "coup",
      stateVersion: 1,
      lastEventSeq: 1,
      finishedAt: at,
      engineVersion: "coup-v1",
      stateSchemaVersion: 4,
      rulesetVersion: "v1",
      result: {
        placements: ids.map((playerId, n) => ({ playerId, place: n + 1 })),
        winnerId: ids[0],
        reason: "LAST_PLAYER_STANDING",
        metrics: {},
      },
    };
    await admin.forModule("matches").transaction(async (db) => {
      await db.match.create({
        data: {
          id: matchId,
          gameId: "coup",
          matchType: "MATCHMAKING",
          status: "FINISHED",
          stateJsonb: { synthetic: true },
          stateVersion: 1,
          lastEventSeq: 1,
          engineVersion: "coup-v1",
          stateSchemaVersion: 4,
          rulesetVersion: "v1",
          finishedAt: new Date(at),
        },
      });
      for (const [seat, userId] of ids.entries())
        await db.matchPlayer.create({
          data: { matchId, userId, seat, agentType: "HUMAN", connectionStatus: "CONNECTED" },
        });
      await db.outboxEvent.create({
        data: {
          id: eventId,
          aggregateId: matchId,
          type: "MATCH_FINISHED_V1",
          schemaVersion: 1,
          payloadJsonb: payload,
          status: "PENDING",
          createdAt: new Date(at),
        },
      });
    });
  }
  const projection = createStatisticsProjection(worker, { nowMs: () => at }),
    matches = createMatchResultPort(worker);
  const reads = createStatisticsPort(admin, {
    clock: { nowMs: () => at },
    users: createUserIdentityPort(admin),
    names: createPublicNamesPort(admin),
  });
  expect(await reads.own(ids[0], {})).toMatchObject({ value: { games: [] } });
  await rebuildStatistics(matches, projection);
  expect(await reads.own(ids[0], {})).toMatchObject({
    value: { games: [{ completed: "30", wins: "30", losses: "0" }] },
  });
  const active = await worker
    .forModule("leaderboard")
    .execute((db) => db.statsHead.findUniqueOrThrow({ where: { id: "statistics-v1" } }));
  await admin.forModule("leaderboard").execute((db) =>
    db.statsValue.updateMany({
      where: { generationId: active.activeId, userId: ids[0]!, metric: "wins" },
      data: { value: 999n },
    }),
  );
  await rebuildStatistics(matches, projection);
  expect(await reads.own(ids[0], {})).toMatchObject({
    value: { games: [{ completed: "30", wins: "30", losses: "0" }] },
  });
  expect(await projection.building()).toBeNull();
}, 20000);

it("executes the declared trusted maintenance CLI and recovers an abandoned builder", async () => {
  const projection = createStatisticsProjection(worker, {
    nowMs: () => Date.parse("2026-10-02T00:00:00Z"),
  });
  await projection.begin();
  const env = {
    ...process.env,
    NODE_ENV: "test",
    WORKER_REDIS_URL: process.env.TEST_WORKER_REDIS_URL,
    WORKER_QUEUE_NAMESPACE: "statistics_maintenance_fixture",
    WORKER_DB_POOL_MAX: "2",
    BOT_CLEANUP_INTERVAL_MS: "1000",
    BOT_CLEANUP_BATCH_SIZE: "1",
    BOT_CLEANUP_ATTEMPTS: "1",
    BOT_CLEANUP_BACKOFF_MS: "100",
  };
  const run = promisify(execFile);
  const aborted = await run("pnpm", ["stats:rebuild", "--abort-building"], {
    env,
    timeout: 15000,
    maxBuffer: 8192,
  });
  expect(aborted.stdout).toContain('"event":"worker.statistics_maintenance_completed"');
  expect(await projection.building()).toBeNull();
  const rebuilt = await run("pnpm", ["stats:rebuild"], { env, timeout: 15000, maxBuffer: 8192 });
  expect(rebuilt.stdout).toContain('"event":"worker.statistics_maintenance_completed"');
  expect(await projection.building()).toBeNull();
  expect(rebuilt.stdout).not.toContain(process.env.WORKER_DATABASE_URL!);
}, 35000);
