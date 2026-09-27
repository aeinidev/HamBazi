import { admissionService } from "./application/admission.js";
import { createAdmissionRepository } from "./infrastructure/repositories/admission.js";
export function createMatchAdmissionPort(
  database: Parameters<typeof createAdmissionRepository>[0],
  options: Parameters<typeof createAdmissionRepository>[1],
  ports: Omit<Parameters<typeof admissionService>[0], "repository">,
) {
  return admissionService({ ...ports, repository: createAdmissionRepository(database, options) });
}
