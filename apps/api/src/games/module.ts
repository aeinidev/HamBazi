import { catalogService } from "./application/catalog.js";
import { createCatalogRepository } from "./infrastructure/repositories/catalog.js";
export function createCatalogPort(database: Parameters<typeof createCatalogRepository>[0]) {
  return catalogService(createCatalogRepository(database));
}
