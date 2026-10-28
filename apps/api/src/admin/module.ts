import { createAdminManagement } from "./application/management.js";
import type { AdminProductPort } from "./application/management-ports.js";
import type { AdminAction } from "@hambazi/validation";
import { createAdminRepository } from "./infrastructure/repositories/admin.js";
import { createAdminService } from "./application/service.js";
import { createAdminProvisioning } from "./application/provisioning.js";

export function createAdminModule(
  database: Parameters<typeof createAdminRepository>[0],
  realmId: string,
  options: Omit<Parameters<typeof createAdminService>[0], "repository"> & {
    restrictionsEnabled?: boolean;
  },
  products?: Partial<Record<AdminAction["operation"], AdminProductPort>>,
) {
  const repository = createAdminRepository(database, realmId);
  const service = createAdminService({ ...options, repository });
  return {
    service,
    audit: repository.auditPage,
    management: products
      ? createAdminManagement({ ...options, repository, service, products })
      : undefined,
  };
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
