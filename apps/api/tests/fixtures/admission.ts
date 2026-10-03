import type { TransportAdmissionPolicy } from "@hambazi/config";
// Synthetic test limits only; never loaded by a production composition.
export const admissionPolicy: TransportAdmissionPolicy = Object.freeze({
  httpRequestsPerMinute: 10000,
  engineRequestsPerMinute: 10000,
  socketConnectionsPerMinute: 10000,
  socketEventsPerMinute: 10000,
  maxHttpInFlight: 100,
  maxEngineInFlight: 100,
  maxConnections: 100,
  maxPendingPerSocket: 100,
  maxPendingTotal: 1000,
  maxSubscriptions: 10,
});
