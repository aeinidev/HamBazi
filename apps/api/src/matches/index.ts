import type { createMatchAutomationPort } from "./module.js";
export { createPrivateRoomMatchPort } from "./module.js";
export { privateRoomReadinessSchema } from "./application/private-room.js";
export type { PrivateRoomMatchPort } from "./application/private-room.js";
export { createMatchAdmissionPort } from "./module.js";
export type {
  MatchAdmissionPort,
  AdmissionTicket,
  ExecutableDescriptor,
  AdmissionOutcome,
} from "./application/admission.js";

export { matchmakingFoundIntentSchema } from "./application/admission.js";
export { createMatchProcessingPort } from "./module.js";
export {
  MatchFault,
  matchCommandSchema,
  matchReadySchema,
  matchLifecycleSchema,
  matchChangedIntentSchema,
} from "./application/processing.js";
export type {
  MatchProcessingPort,
  MatchGame,
  MatchAck,
  MatchOutcome,
} from "./application/processing.js";

export { createMatchOutboxPort } from "./module.js";
export { matchDomainEventSchema } from "./application/outbox.js";
export { matchFinishedInputSchema } from "./application/result-input.js";
export type {
  MatchOutboxPort,
  OutboxClaim,
  OutboxEvent,
  MatchDomainEvent,
  OutboxPolicy,
} from "./application/outbox.js";
export type { MatchCorrelation } from "./application/correlation.js";
export { createMatchMembershipPort } from "./module.js";
export type { MatchMembershipPort, MatchMembership } from "./application/membership.js";

export { createMatchResyncPort } from "./module.js";
export {
  matchSnapshotRequestSchema,
  matchCatchupRequestSchema,
  matchSnapshotSchema,
  matchDeliveryEventSchema,
  matchCatchupSchema,
} from "./application/resync.js";
export type {
  MatchResyncPort,
  MatchViewGame,
  MatchSnapshot,
  MatchCatchup,
} from "./application/resync.js";

export { createMatchReconnectPort } from "./module.js";
export { disconnectTimeoutSchema, reconnectPolicySchema } from "./application/reconnect.js";
export type {
  MatchReconnectPort,
  ReconnectPolicy,
  ReconnectResult,
  ReconnectOutcome,
  DisconnectTimeout,
} from "./application/reconnect.js";

export { createMatchAutomationPort } from "./module.js";
export { automationIntentSchema } from "./application/automation.js";
export type { AutomationIntent } from "./application/automation.js";
export type MatchAutomationPort = ReturnType<typeof createMatchAutomationPort>;

export { matchCorrelationSchema } from "./application/correlation.js";

export { createMatchResultPort } from "./module.js";
export type { FinishedResult } from "./application/result-input.js";
export {
  createMatchDiagnostics,
  createAdmissionDiagnostics,
  createOutboxDiagnostics,
} from "./module.js";
export { createPersonalMatchPort } from "./module.js";
import type { createPersonalMatchPort } from "./module.js";
export type PersonalMatchPort = ReturnType<typeof createPersonalMatchPort>;

export {
  personalStartSchema,
  personalReadSchema,
  personalCloseSchema,
  personalCurrentSchema,
  personalCurrentResultSchema,
} from "./application/personal.js";
export { matchAckSchema } from "./application/processing.js";

export { createPublicLobbyPort } from "./module.js";
export {
  publicLobbySchema,
  publicSearchSchema,
  type PublicLobbyPort,
} from "./application/public-lobby.js";

export { createMatchesAdminRead } from "./module.js";
