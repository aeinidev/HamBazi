import { admissionService } from "./application/admission.js";
import { createAdmissionRepository } from "./infrastructure/repositories/admission.js";
export function createMatchAdmissionPort(
  database: Parameters<typeof createAdmissionRepository>[0],
  options: Parameters<typeof createAdmissionRepository>[1],
  ports: Omit<Parameters<typeof admissionService>[0], "repository">,
) {
  return admissionService({ ...ports, repository: createAdmissionRepository(database, options) });
}

import { matchProcessingService } from "./application/processing.js";
import { createMatchProcessingRepository } from "./infrastructure/repositories/processing.js";
export function createMatchProcessingPort(
  database: Parameters<typeof createMatchProcessingRepository>[0],
  options: Parameters<typeof createMatchProcessingRepository>[1],
  users: Parameters<typeof matchProcessingService>[0]["users"],
) {
  return matchProcessingService({
    repository: createMatchProcessingRepository(database, options),
    users,
  });
}

import { createMatchOutboxRepository } from "./infrastructure/repositories/outbox.js";
import { matchMembershipService } from "./application/membership.js";
import { createMatchMembershipRepository } from "./infrastructure/repositories/membership.js";
export function createMatchMembershipPort(
  database: Parameters<typeof createMatchMembershipRepository>[0],
) {
  return matchMembershipService(createMatchMembershipRepository(database));
}
export function createMatchOutboxPort(
  database: Parameters<typeof createMatchOutboxRepository>[0],
  options: Parameters<typeof createMatchOutboxRepository>[1],
) {
  return createMatchOutboxRepository(database, options);
}
