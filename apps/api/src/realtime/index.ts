export { createRealtimeGateway } from "./gateway.js";
export type { RealtimeDependencies, RealtimeRate } from "./gateway.js";
export { realtimeEventCatalog, incomingEvents, outgoingEvents } from "./contracts.js";

export { createRealtimeRedisAdapter } from "./redis-adapter.js";
export { createRealtimeConsumer, realtimeJobProcessor } from "./consumer.js";
export {
  createRedisTransportAdmission,
  createPeerResolver,
  canonicalIp,
} from "./transport-admission.js";
export type { IpAdmission, AdmissionDecision } from "./transport-admission.js";
export { createPersonalGateway } from "./personal-gateway.js";
export type { PersonalGatewayDependencies } from "./personal-gateway.js";

export { personalEventCatalog } from "./personal-contracts.js";
