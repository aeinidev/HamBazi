import process from "node:process";
import { createDatabase } from "@hambazi/database";
import { createMatchResultPort } from "@hambazi/api/matches";
import { createStatisticsProjection } from "@hambazi/api/leaderboard";
import { startStatisticsConsumer } from "../../dist/index.js";
if (
  process.env.TEST_KAHROBA_RUN !== "isolated-k2" ||
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  !/^kahroba_[a-f0-9-]+$/.test(process.env.TEST_KAHROBA_NAMESPACE ?? "")
)
  throw new Error("Disposable harness required");
const database = createDatabase({
  databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL },
  poolMax: 8,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 10000,
});
await database.connect();
const consumer = await startStatisticsConsumer({
  matches: createMatchResultPort(database),
  statistics: createStatisticsProjection(database, { nowMs: () => Date.now() }),
  redisUrl: { reveal: () => process.env.TEST_WORKER_REDIS_URL },
  namespace: process.env.TEST_KAHROBA_NAMESPACE,
  concurrency: 2,
  drainTimeoutMs: 5000,
  unavailable: () => {},
});
process.send?.({ ready: true });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await consumer.close();
  await database.disconnect();
  process.exit(0);
}
process.on("message", (m) => {
  if (m === "close") void close();
});
process.on("disconnect", () => void close());
