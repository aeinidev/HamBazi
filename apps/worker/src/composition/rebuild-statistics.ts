import { parseRuntimeConfig, parseOnboardingWorkerConfig } from "@hambazi/config";
import { createDatabase } from "@hambazi/database";
import { createMatchResultPort } from "@hambazi/api/matches";
import { createStatisticsProjection } from "@hambazi/api/leaderboard";
import { rebuildStatistics } from "../statistics.js";
const runtime = parseRuntimeConfig(process.env, "worker");
const config = parseOnboardingWorkerConfig(process.env);
const database = createDatabase({
  databaseUrl: runtime.databaseUrl,
  poolMax: config.poolMax,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 10000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 5000,
});
try {
  await database.connect();
  const statistics = createStatisticsProjection(database, { nowMs: () => Date.now() });
  if (process.argv.includes("--abort-building")) {
    const id = await statistics.building();
    if (id) await statistics.abort(id);
  } else await rebuildStatistics(createMatchResultPort(database), statistics);
  console.info("Statistics maintenance completed");
} catch {
  console.error("Statistics maintenance failed");
  process.exitCode = 1;
} finally {
  await database.disconnect();
}
