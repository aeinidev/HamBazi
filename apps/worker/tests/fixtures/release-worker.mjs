import process from "node:process";
import { createDatabase } from "@hambazi/database";
import { createRequire } from "node:module";
import { URL } from "node:url";
import {
  observeCapacityDatabase,
  observeCapacityPgClient,
  observeCapacityPgPool,
  observeCapacityAutomation,
} from "../../../../infra/scripts/capacity-diagnostics.mjs";
import { createCoupMatchGame } from "@hambazi/api";
import {
  createMatchOutboxPort,
  createMatchResultPort,
  createMatchAutomationPort,
  createMatchReconnectPort,
} from "@hambazi/api/matches";
import { createStatisticsProjection } from "@hambazi/api/leaderboard";
import { startStatisticsConsumer, startMatchAutomation } from "../../dist/index.js";
import { capacityFixturePresencePolicy } from "../../../../infra/scripts/capacity-model.mjs";
import {
  createBullMqDomainPublisher,
  createOutboxDispatcher,
  startOutboxLoop,
} from "../../dist/outbox-dispatcher.js";

// Owned only by the disposable release harness; no live composition or policy defaults.
let loop, consumer, publisher, automation, database, closing;
const restores = [];
const capacity = process.env.TEST_CAPACITY_MODE === "isolated";
async function close() {
  return (closing ??= (async () => {
    let failed = false;
    for (const stop of [
      () => loop?.close(),
      () => automation?.close(),
      () => consumer?.close(),
      () => publisher?.close(),
      () => database?.disconnect(),
      () =>
        restores
          .splice(0)
          .reverse()
          .forEach((restore) => restore()),
    ]) {
      try {
        await stop();
      } catch {
        failed = true;
      }
    }
    if (failed) throw new Error("Release worker cleanup failed");
  })());
}
async function main() {
  if (
    process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
    process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed" ||
    process.env.TEST_RELEASE_BROWSER !== "isolated" ||
    !process.env.WORKER_DATABASE_URL ||
    !process.env.TEST_WORKER_REDIS_URL ||
    !/^[a-f0-9-]{36}$/.test(process.env.TEST_RELEASE_NAMESPACE ?? "")
  )
    throw new Error("Use the isolated release harness");
  database = createDatabase({
    databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL },
    poolMax: 4,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    transactionMaxWaitMs: 5000,
    transactionTimeoutMs: 5000,
  });
  if (capacity) {
    const pg = createRequire(
      new URL("../../../../packages/database/package.json", import.meta.url),
    )("pg");
    const emit = (message) => process.send?.(message);
    restores.push(observeCapacityPgClient(pg.Client, emit), observeCapacityPgPool(pg.Pool, emit));
    database = observeCapacityDatabase(database, emit);
  }
  await database.connect();
  const clock = { nowMs: () => Date.now() };
  const redisUrl = { reveal: () => process.env.TEST_WORKER_REDIS_URL };
  const namespace = process.env.TEST_RELEASE_NAMESPACE;
  if (process.env.TEST_CAPACITY_MODE === "isolated") {
    // Same retained server adapter and real BullMQ jobs; no extended engine deadline.
    const game = createCoupMatchGame({
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
    });
    const { leaseMs, graceMs, maxConnections } = capacityFixturePresencePolicy;
    const automationPort = createMatchAutomationPort(database, { clock, games: [game] });
    automation = await startMatchAutomation({
      redisUrl,
      namespace,
      intervalMs: 1000,
      batchSize: 100,
      attempts: 3,
      backoffMs: 100,
      drainTimeoutMs: 5000,
      event() {},
      automation: {
        ...automationPort,
        execute: observeCapacityAutomation(automationPort.execute, (message) =>
          process.send?.(message),
        ),
      },
      reconnect: createMatchReconnectPort(database, {
        clock,
        policy: { schemaVersion: 1, leaseMs, graceMs, maxConnections },
      }),
    });
  }
  consumer = await startStatisticsConsumer({
    matches: createMatchResultPort(database),
    statistics: createStatisticsProjection(database, clock),
    redisUrl,
    namespace,
    concurrency: 1,
    drainTimeoutMs: 5000,
    unavailable() {},
    telemetry: { emit() {} },
  });
  publisher = await createBullMqDomainPublisher({
    redisUrl,
    namespace,
    timeoutMs: 1000,
    attempts: 3,
    backoffMs: 100,
    event(name) {
      if (capacity) process.send?.({ type: "capacity-outbox", name });
    },
  });
  const dispatcher = createOutboxDispatcher({
    outbox: createMatchOutboxPort(database, {
      clock,
      policy: { leaseMs: 1000, maxAttempts: 5, backoffMs: 100, maxBackoffMs: 1000 },
    }),
    publisher,
    batchSize: 100,
    publishTimeoutMs: 2000,
    event(name) {
      if (capacity) process.send?.({ type: "capacity-outbox", name });
    },
  });
  loop = startOutboxLoop(dispatcher, 100);
  process.send?.({ ready: true });
}
process.once("SIGTERM", () => {
  void close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
});
process.once("disconnect", () => {
  void close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
});
void main().catch(async () => {
  process.send?.({ failed: true });
  await close().catch(() => {});
  process.exit(1);
});
