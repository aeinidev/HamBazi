import process from "node:process";
import { createDatabase } from "@hambazi/database";
import { createMatchOutboxPort, createMatchResultPort } from "@hambazi/api/matches";
import { createStatisticsProjection } from "@hambazi/api/leaderboard";
import { startStatisticsConsumer } from "../../dist/index.js";
import {
  createBullMqDomainPublisher,
  createOutboxDispatcher,
  startOutboxLoop,
} from "../../dist/outbox-dispatcher.js";

// Owned only by the disposable release harness; no live composition or policy defaults.
let loop, consumer, publisher, database, closing;
async function close() {
  return (closing ??= (async () => {
    let failed = false;
    for (const stop of [
      () => loop?.close(),
      () => consumer?.close(),
      () => publisher?.close(),
      () => database?.disconnect(),
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
  await database.connect();
  const clock = { nowMs: () => Date.now() };
  const redisUrl = { reveal: () => process.env.TEST_WORKER_REDIS_URL };
  const namespace = process.env.TEST_RELEASE_NAMESPACE;
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
    event() {},
  });
  const dispatcher = createOutboxDispatcher({
    outbox: createMatchOutboxPort(database, {
      clock,
      policy: { leaseMs: 1000, maxAttempts: 5, backoffMs: 100, maxBackoffMs: 1000 },
    }),
    publisher,
    batchSize: 100,
    publishTimeoutMs: 2000,
    event() {},
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
