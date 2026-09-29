import { z } from "zod";
import { createErrorEnvelope, type ErrorEnvelope } from "@hambazi/contracts";
import { matchCorrelationSchema, type MatchCorrelation } from "./correlation.js";
import { MatchFault } from "./processing.js";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const counter = z.number().int().min(0).max(2147483647);
export const reconnectTimeSchema = z.number().int().min(0).max(8640000000000000);
export const reconnectPolicySchema = z.strictObject({
  schemaVersion: z.literal(1),
  leaseMs: z.number().int().min(1).max(86400000),
  graceMs: z.number().int().min(1).max(86400000),
  maxConnections: z.number().int().min(1).max(32),
});
export type ReconnectPolicy = z.infer<typeof reconnectPolicySchema>;
const seat = z.strictObject({ schemaVersion: z.literal(1), matchId: uuid, playerId: uuid });
export const connectionLeaseSchema = seat.extend({
  connectionId: uuid,
  sessionExpiresAt: reconnectTimeSchema,
});
export const connectionCloseSchema = seat.extend({ connectionId: uuid });
export const disconnectTimeoutSchema = seat.extend({
  expectedConnectionEpoch: counter,
  expectedStateVersion: counter,
  deadlineAt: reconnectTimeSchema,
});
export type DisconnectTimeout = z.infer<typeof disconnectTimeoutSchema>;
export type ConnectionLease = z.infer<typeof connectionLeaseSchema>;
export type ReconnectRequest =
  | (ConnectionLease & { kind: "CONNECT" | "RENEW" })
  | (z.infer<typeof connectionCloseSchema> & { kind: "DISCONNECT" })
  | (z.infer<typeof seat> & { kind: "RECONCILE" })
  | (DisconnectTimeout & { kind: "TIMEOUT" });
export interface ReconnectResult {
  schemaVersion: 1;
  matchId: string;
  stateVersion: number;
  lastEventSeq: number;
  connectionEpoch: number;
  role: "PLAYER" | "SPECTATOR";
  status: "CONNECTED" | "DISCONNECTED" | "REPLACED_BY_BOT";
  changed: boolean;
  timeout: DisconnectTimeout | null;
}
export interface ReconnectRepository {
  apply(request: ReconnectRequest, correlation?: MatchCorrelation): Promise<ReconnectResult>;
}
export type ReconnectOutcome = { ok: true; value: ReconnectResult } | ErrorEnvelope;
/** Trusted server-only boundary. The caller authenticates the session on every connect/renew,
 * supplies its real expiry, and generates connection IDs; never expose these inputs as wire DTOs.
 * Disconnect/reconcile/timeout also run after session expiry and do not accept client authority.
 */
export function matchReconnectService(repository: ReconnectRepository) {
  async function run<T extends Omit<ReconnectRequest, "kind">>(
    schema: z.ZodType<T>,
    input: unknown,
    kind: ReconnectRequest["kind"],
    context: unknown,
  ): Promise<ReconnectOutcome> {
    const parsed = schema.safeParse(input);
    const correlation = matchCorrelationSchema.safeParse(context);
    if (!correlation.success) return createErrorEnvelope("INVALID_INPUT");
    if (!parsed.success) return createErrorEnvelope("INVALID_INPUT");
    try {
      return {
        ok: true,
        value: await repository.apply(
          { ...parsed.data, kind } as ReconnectRequest,
          correlation.data,
        ),
      };
    } catch (error) {
      return createErrorEnvelope(error instanceof MatchFault ? error.code : "INTERNAL_ERROR");
    }
  }
  return Object.freeze({
    connect: (input: unknown, context: unknown = {}) =>
      run(connectionLeaseSchema, input, "CONNECT", context),
    renew: (input: unknown, context: unknown = {}) =>
      run(connectionLeaseSchema, input, "RENEW", context),
    disconnect: (input: unknown, context: unknown = {}) =>
      run(connectionCloseSchema, input, "DISCONNECT", context),
    reconcile: (input: unknown, context: unknown = {}) => run(seat, input, "RECONCILE", context),
    timeout: (input: unknown, context: unknown = {}) =>
      run(disconnectTimeoutSchema, input, "TIMEOUT", context),
  });
}
export type MatchReconnectPort = ReturnType<typeof matchReconnectService>;
