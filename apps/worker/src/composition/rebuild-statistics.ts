import { createTelemetryLogger, createCorrelation, withCorrelation } from "@hambazi/observability";
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
const logger = createTelemetryLogger();
const context = createCorrelation();
try {
  await withCorrelation(context, async () => {
    await database.connect();
    const statistics = createStatisticsProjection(database, { nowMs: () => Date.now() });
    if (process.argv.includes("--abort-building")) {
      const id = await statistics.building();
      if (id) await statistics.abort(id);
    } else await rebuildStatistics(createMatchResultPort(database), statistics);
    logger.emit("worker.statistics_maintenance_completed");
  });
} catch {
  withCorrelation(context, () =>
    logger.emit("worker.statistics_maintenance_failed", { errorCode: "INTERNAL_ERROR" }),
  );
  process.exitCode = 1;
} finally {
  await database.disconnect();
}
