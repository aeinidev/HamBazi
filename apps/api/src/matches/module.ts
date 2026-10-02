import type { OutboxEvent, MatchDomainEvent } from "./application/outbox.js";
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
export function createMatchOutboxPort<T extends OutboxEvent = MatchDomainEvent>(
  database: Parameters<typeof createMatchOutboxRepository>[0],
  options: Parameters<typeof createMatchOutboxRepository<T>>[1],
) {
  return createMatchOutboxRepository(database, options);
}

import { matchResyncService } from "./application/resync.js";
import { createMatchResyncRepository } from "./infrastructure/repositories/resync.js";
export function createMatchResyncPort(
  database: Parameters<typeof createMatchResyncRepository>[0],
  games: Parameters<typeof createMatchResyncRepository>[1],
) {
  return matchResyncService(createMatchResyncRepository(database, games));
}

import { matchReconnectService } from "./application/reconnect.js";
import { createMatchReconnectRepository } from "./infrastructure/repositories/reconnect.js";
export function createMatchReconnectPort(
  database: Parameters<typeof createMatchReconnectRepository>[0],
  options: Parameters<typeof createMatchReconnectRepository>[1],
) {
  return matchReconnectService(createMatchReconnectRepository(database, options));
}

import { createMatchAutomationRepository } from "./infrastructure/repositories/automation.js";
export function createMatchAutomationPort(
  database: Parameters<typeof createMatchAutomationRepository>[0],
  options: Parameters<typeof createMatchAutomationRepository>[1],
) {
  return createMatchAutomationRepository(database, options);
}

import { createMatchResultRepository } from "./infrastructure/repositories/results.js";
export function createMatchResultPort(database: Parameters<typeof createMatchResultRepository>[0]) {
  return createMatchResultRepository(database);
}

import {
  createAdmissionDiagnosticsRepository,
  createMatchDiagnosticsRepository,
  createOutboxDiagnosticsRepository,
} from "./infrastructure/repositories/diagnostics.js";
export function createMatchDiagnostics(
  database: Parameters<typeof createMatchDiagnosticsRepository>[0],
) {
  return createMatchDiagnosticsRepository(database);
}
export function createOutboxDiagnostics(
  database: Parameters<typeof createOutboxDiagnosticsRepository>[0],
) {
  return createOutboxDiagnosticsRepository(database);
}

export function createAdmissionDiagnostics(
  database: Parameters<typeof createAdmissionDiagnosticsRepository>[0],
) {
  return createAdmissionDiagnosticsRepository(database);
}
