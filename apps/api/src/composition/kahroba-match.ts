import { randomInt } from "node:crypto";
import { z } from "zod";
import {
  kahrobaModule,
  kahrobaRulesSchema,
  kahrobaResultSchema,
  KahrobaError,
} from "@hambazi/kahroba-engine";
import { gameResultV2Schema } from "@hambazi/validation";
import {
  MatchFault,
  type MatchGame,
  type MatchViewGame,
  type ExecutableDescriptor,
} from "../matches/index.js";

/** Trusted opt-in composition. No catalog/admission/runtime activation or timing default. */
export function createKahrobaMatchGame(inputRules: unknown): MatchGame & MatchViewGame {
  const parsed = kahrobaRulesSchema.safeParse(inputRules);
  if (
    !parsed.success ||
    parsed.data.turnDurationMs !== null ||
    parsed.data.timeoutPolicyVersion !== null
  )
    throw new Error("Kahroba runtime timing is not approved");
  const rules = Object.freeze(parsed.data);
  const engine = kahrobaModule.engine;
  const random = Object.freeze({ nextInt: (bound: number) => randomInt(bound) });
  function safe<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof MatchFault) throw error;
      if (error instanceof KahrobaError) throw new MatchFault(error.code);
      throw new MatchFault("INTERNAL_ERROR");
    }
  }
  function restore(snapshot: unknown) {
    const state = kahrobaModule.migrateState(snapshot, 1);
    if (state.rules.turnDurationMs !== null || state.rules.timeoutPolicyVersion !== null)
      throw new MatchFault("INCOMPATIBLE_GAME_VERSION");
    return state;
  }
  function outcome(state: ReturnType<typeof restore>, events: ReturnType<typeof engine.execute>) {
    const next = events.reduce(engine.applyEvent, state);
    const result = engine.getResult(next);
    const local = result === null ? null : kahrobaResultSchema.parse(result);
    return {
      state: next,
      events: events.map((e) => ({ type: e.type, schemaVersion: e.schemaVersion, payload: e })),
      result:
        local === null
          ? null
          : gameResultV2Schema.parse({
              schemaVersion: 2,
              placements: local.placements,
              winnerId: local.winnerId,
              winnerIds: local.winnerIds,
              outcome: local.winnerIds.length === 1 ? "SOLE_VICTORY" : "SHARED_VICTORY",
              reason: local.reason,
              metrics: local.metrics,
            }),
    };
  }
  return Object.freeze({
    gameId: "kahroba",
    descriptor: kahrobaModule.descriptor,
    resultSchemaVersion: 2,
    initialize: (ids, at) =>
      safe(() =>
        engine.createInitialState(
          { playerIds: [...ids] },
          { clock: { now: () => at }, random, rules },
        ),
      ),
    restore: (snapshot, ids) =>
      safe(() => {
        const state = restore(snapshot);
        if (state.players.length !== ids.length || state.players.some((p, i) => p.id !== ids[i]))
          throw new MatchFault("INCOMPATIBLE_GAME_VERSION");
        return state;
      }),
    project: (snapshot, userId, role) =>
      safe(() => {
        const state = restore(snapshot);
        if (!state.players.some((p) => p.id === userId)) throw new MatchFault("FORBIDDEN");
        return z
          .json()
          .parse(
            role === "PLAYER"
              ? engine.getPlayerView(state, userId)
              : engine.getSpectatorView!(state),
          );
      }),
    execute: (snapshot, command, actorId, at) =>
      safe(() => {
        const state = restore(snapshot);
        return outcome(
          state,
          engine.execute(state, command, actorId, {
            clock: { now: () => at },
            random,
            rules: state.rules,
          }),
        );
      }),
    // Only an already committed BOT seat is eligible. No human timeout fallback exists.
    automation: (snapshot, botIds) =>
      safe(() => {
        const state = restore(snapshot);
        const playerId = state.players[state.turnPlayerIndex]!.id;
        return state.phase === "WAITING_FOR_ACTION" && botIds.includes(playerId)
          ? {
              expectedRevision: state.revision,
              deadlineAt: state.lastCommandAt,
              playerId,
              kind: "BOT" as const,
            }
          : null;
      }),
    automate: (snapshot, intent, at) =>
      safe(() => {
        const state = restore(snapshot);
        const actor = state.players[state.turnPlayerIndex]!.id;
        if (
          state.phase !== "WAITING_FOR_ACTION" ||
          intent.kind !== "BOT" ||
          intent.playerId !== actor ||
          intent.expectedRevision !== state.revision ||
          intent.deadlineAt !== state.lastCommandAt ||
          at < state.lastCommandAt
        )
          return outcome(state, []);
        const command = kahrobaModule.botPolicy.chooseCommand(engine.getPlayerView(state, actor));
        return outcome(
          state,
          command === null
            ? []
            : engine.execute(state, command, actor, {
                clock: { now: () => at },
                random,
                rules: state.rules,
              }),
        );
      }),
  } satisfies MatchGame & MatchViewGame);
}

/** Explicit local registry lookup; callers must separately enforce catalog eligibility. */
export function kahrobaMatchDescriptor(input: {
  gameId: string;
  mode?: string;
  capacity: number;
}): ExecutableDescriptor | null {
  return input.gameId === "kahroba" &&
    (input.mode === undefined || input.mode === "standard") &&
    Number.isInteger(input.capacity) &&
    input.capacity >= 2 &&
    input.capacity <= 4
    ? {
        engineVersion: kahrobaModule.descriptor.engineVersion,
        stateSchemaVersion: kahrobaModule.descriptor.stateSchemaVersion,
        rulesetVersion: kahrobaModule.descriptor.rulesetVersion,
      }
    : null;
}
