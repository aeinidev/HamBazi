import { z } from "zod";

const positive = (max: number) => z.number().int().min(1).max(max);
export const transportAdmissionPolicySchema = z
  .object({
    httpRequestsPerMinute: positive(1000000),
    engineRequestsPerMinute: positive(1000000),
    socketConnectionsPerMinute: positive(1000000),
    socketEventsPerMinute: positive(1000000),
    maxHttpInFlight: positive(100000),
    maxEngineInFlight: positive(100000),
    maxConnections: positive(100000),
    maxPendingPerSocket: positive(10000),
    maxPendingTotal: positive(100000),
    maxSubscriptions: positive(1000),
  })
  .strict()
  .refine((p) => p.maxPendingPerSocket <= p.maxPendingTotal);
export type TransportAdmissionPolicy = z.infer<typeof transportAdmissionPolicySchema>;

/** No capacity or production quota is inferred. A partial profile is always an error. */
export function parseTransportAdmissionConfig(env: Readonly<Record<string, string | undefined>>) {
  const names = {
    httpRequestsPerMinute: "ADMISSION_HTTP_PER_MINUTE",
    engineRequestsPerMinute: "ADMISSION_ENGINE_PER_MINUTE",
    socketConnectionsPerMinute: "ADMISSION_CONNECT_PER_MINUTE",
    socketEventsPerMinute: "ADMISSION_EVENT_PER_MINUTE",
    maxHttpInFlight: "ADMISSION_HTTP_IN_FLIGHT",
    maxEngineInFlight: "ADMISSION_ENGINE_IN_FLIGHT",
    maxConnections: "ADMISSION_CONNECTIONS",
    maxPendingPerSocket: "ADMISSION_PENDING_PER_SOCKET",
    maxPendingTotal: "ADMISSION_PENDING_TOTAL",
    maxSubscriptions: "ADMISSION_SUBSCRIPTIONS",
  } as const;
  if (
    Object.values(names).every((name) => env[name] === undefined) &&
    env.NODE_ENV !== "production"
  )
    return undefined;
  const values = Object.fromEntries(
    Object.entries(names).map(([field, name]) => {
      const value = env[name];
      return [field, value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined];
    }),
  );
  const result = transportAdmissionPolicySchema.safeParse(values);
  if (!result.success) throw new Error("Transport admission configuration is invalid");
  return Object.freeze(result.data);
}
