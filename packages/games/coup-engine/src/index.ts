export {
  coupManifest,
  coupFoundationDescriptor,
  coupCoreDescriptor,
  coupInitialInputSchema,
  coupRuleConfigSchema,
  coupCommandSchema,
  coupEventSchema,
  createCoupInitialState,
} from "./model.js";
export type { CoupState, CoupRole, CoupCommand, CoupEvent, CoupRuleConfig } from "./model.js";
export {
  CoupError,
  coupCoreEngine,
  validateCoupCommand,
  executeCoupCommand,
  applyCoupEvent,
  getCoupPlayerView,
  getCoupSpectatorView,
  getCoupResult,
} from "./engine.js";
export type { CoupErrorCode, CoupPlayerView, CoupSpectatorView } from "./engine.js";
