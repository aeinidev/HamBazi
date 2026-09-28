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
