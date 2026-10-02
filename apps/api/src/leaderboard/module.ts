import { createStatisticsRepository } from "./infrastructure/repositories/statistics.js";
import { statisticsService } from "./application/service.js";
export function createStatisticsProjection(
  database: Parameters<typeof createStatisticsRepository>[0],
  clock: Parameters<typeof createStatisticsRepository>[1],
) {
  const repository = createStatisticsRepository(database, clock);
  return {
    consume: repository.consume,
    begin: repository.begin,
    applyBatch: repository.applyBatch,
    finish: repository.finish,
    abort: repository.abort,
    building: repository.building,
  };
}
export function createStatisticsPort(
  database: Parameters<typeof createStatisticsRepository>[0],
  options: Omit<Parameters<typeof statisticsService>[0], "repository">,
) {
  return statisticsService({
    ...options,
    repository: createStatisticsRepository(database, options.clock),
  });
}
