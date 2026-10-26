import { catalogService } from "./application/catalog.js";
import { createCatalogRepository } from "./infrastructure/repositories/catalog.js";
import { privateRegistrationService } from "./application/private-registration.js";
import type { CatalogGame } from "./application/catalog.js";
export function createPrivateRegistrationCatalog(
  database: Parameters<typeof createCatalogRepository>[0],
  registration: CatalogGame,
) {
  return privateRegistrationService(
    createCatalogRepository(database, registration.id),
    registration,
  );
}
export function createCatalogPort(database: Parameters<typeof createCatalogRepository>[0]) {
  return catalogService(createCatalogRepository(database));
}

export { createGamesAdminReadRepository as createGamesAdminRead } from "./infrastructure/repositories/admin-read.js";
