export { createCatalogPort } from "./module.js";
export { createPrivateRegistrationCatalog } from "./module.js";
export type { CatalogPort, CatalogGame } from "./application/catalog.js";
export {
  createCatalogHttpModule,
  type CatalogHttpDependencies,
} from "./infrastructure/catalog-http.js";
export { createCatalogRate } from "./infrastructure/catalog-rate.js";
export { catalogOpenApiDocument } from "./infrastructure/catalog-contract.js";

export { lobbyAvailability } from "./application/availability.js";
