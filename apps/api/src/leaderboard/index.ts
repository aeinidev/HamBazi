export { createStatisticsPort, createStatisticsProjection } from "./module.js";
export { createStatisticsHttpModule } from "./infrastructure/http.js";
export type { StatisticsHttpDependencies } from "./infrastructure/http.js";
export {
  statsResponseSchema,
  leaderboardResponseSchema,
  statsFinishSchema,
} from "./application/contracts.js";
export type { StatsFinish } from "./application/contracts.js";
export type { StatisticsPort } from "./application/service.js";
export { statisticsOpenApiDocument } from "./infrastructure/contract.js";
