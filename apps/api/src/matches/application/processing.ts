import type { AutomationGame, AutomationIntent } from "./automation.js";
import { matchCorrelationSchema, type MatchCorrelation } from "./correlation.js";
import { z } from "zod";
import { createErrorEnvelope, type ErrorEnvelope } from "@hambazi/contracts";
import type { GameVersionDescriptor, StandardGameResult } from "@hambazi/game-core";
import type { UserIdentityPort } from "../../users/index.js";
import { matchStatuses } from "../domain/lifecycle.js";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const counter = z.number().int().min(0).max(2147483647);
const envelope = z.strictObject({
  schemaVersion: z.literal(1),
  actionId: uuid,
  matchId: uuid,
  expectedVersion: counter,
});
export const matchCommandSchema = envelope.extend({ command: z.json() });
export const matchReadySchema = envelope;
export const matchLifecycleSchema = envelope.extend({
  operation: z.enum(["WAIT", "START", "ACTIVATE", "TERMINATE"]),
});
export const matchAckSchema = z.strictObject({
  schemaVersion: z.literal(1),
  matchId: uuid,
  actionId: uuid,
  stateVersion: counter,
  lastEventSeq: counter,
  status: z.enum(matchStatuses),
});
// Token-free, state-free wake-up intent; internal game events must never be broadcast raw.
export const matchChangedIntentSchema = z.object({
  schemaVersion: z.literal(1),
  matchId: uuid,
  stateVersion: counter,
  lastEventSeq: counter,
  status: z.enum(matchStatuses),
});
export type MatchAck = z.infer<typeof matchAckSchema>;
export type MatchCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "GAME_STATE_CONFLICT"
  | "INCOMPATIBLE_GAME_VERSION"
  | "INTERNAL_ERROR";
export class MatchFault extends Error {
  constructor(readonly code: MatchCode) {
    super(code);
  }
}
export type MatchOutcome = { ok: true; value: MatchAck } | ErrorEnvelope<MatchCode>;
export type MatchRequest = z.infer<typeof envelope> &
  (
    | { kind: "AUTOMATION"; intent: AutomationIntent }
    | { kind: "READY" }
    | { kind: "GAME"; command: z.infer<ReturnType<typeof z.json>> }
    | { kind: "LIFECYCLE"; operation: z.infer<typeof matchLifecycleSchema>["operation"] }
  );
/** Synchronous server adapter. Never fetch config, Users, or another service under the lock. */
export interface MatchGame {
  automation?: AutomationGame["automation"];
  automate?: AutomationGame["automate"];
  readonly gameId: string;
  readonly descriptor: GameVersionDescriptor;
  initialize(playerIds: readonly string[], at: number): unknown;
  restore(snapshot: unknown, playerIds: readonly string[]): unknown;
  execute(
    snapshot: unknown,
    command: unknown,
    actorId: string,
    at: number,
  ): {
    state: unknown;
    events: readonly { type: string; schemaVersion: number; payload: unknown }[];
    result: StandardGameResult | null;
  };
}
export interface MatchProcessingRepository {
  process(
    actor: string | null,
    request: MatchRequest,
    correlation?: MatchCorrelation,
  ): Promise<MatchAck>;
}
export function matchProcessingService(deps: {
  repository: MatchProcessingRepository;
  users: UserIdentityPort;
}) {
  async function safe(operation: () => Promise<MatchAck>): Promise<MatchOutcome> {
    try {
      return { ok: true, value: await operation() };
    } catch (error) {
      return createErrorEnvelope(error instanceof MatchFault ? error.code : "INTERNAL_ERROR");
    }
  }
  function parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new MatchFault("INVALID_INPUT");
    return result.data;
  }
  async function actor(identity: unknown) {
    const id = uuid.safeParse(identity);
    if (!id.success || !(await deps.users.findActiveById(id.data)))
      throw new MatchFault("UNAUTHENTICATED");
    return id.data;
  }
  return Object.freeze({
    // Identity is supplied by authenticated composition, never extracted from the intent.
    command: (identity: unknown, input: unknown, context: unknown = {}) =>
      safe(async () => {
        const request = parse(matchCommandSchema, input);
        return deps.repository.process(
          await actor(identity),
          { ...request, kind: "GAME" },
          parse(matchCorrelationSchema, context),
        );
      }),
    ready: (identity: unknown, input: unknown, context: unknown = {}) =>
      safe(async () => {
        const request = parse(matchReadySchema, input);
        return deps.repository.process(
          await actor(identity),
          { ...request, kind: "READY" },
          parse(matchCorrelationSchema, context),
        );
      }),
    // Trusted orchestration only. An operator route must add separate admin authorization.
    lifecycle: (input: unknown, context: unknown = {}) =>
      safe(() =>
        deps.repository.process(
          null,
          {
            ...parse(matchLifecycleSchema, input),
            kind: "LIFECYCLE",
          },
          parse(matchCorrelationSchema, context),
        ),
      ),
  });
}
export type MatchProcessingPort = ReturnType<typeof matchProcessingService>;
