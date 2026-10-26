import { createAdminRepository } from "./infrastructure/repositories/admin.js";
import { createAdminService } from "./application/service.js";
import { createAdminProvisioning } from "./application/provisioning.js";

export function createAdminModule(
  database: Parameters<typeof createAdminRepository>[0],
  realmId: string,
  options: Omit<Parameters<typeof createAdminService>[0], "repository">,
) {
  const repository = createAdminRepository(database, realmId);
  return { service: createAdminService({ ...options, repository }), audit: repository.auditPage };
}
export function createAdminProvisioningModule(
  database: Parameters<typeof createAdminRepository>[0],
  options: Omit<Parameters<typeof createAdminProvisioning>[0], "repository">,
) {
  return createAdminProvisioning({
    ...options,
    repository: createAdminRepository(database, options.realmId),
  });
}
