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
  MatchDomainEvent,
  OutboxPolicy,
} from "./application/outbox.js";
export type { MatchCorrelation } from "./application/correlation.js";
export { createMatchMembershipPort } from "./module.js";
export type { MatchMembershipPort, MatchMembership } from "./application/membership.js";
