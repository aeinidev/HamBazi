import { randomInt } from "node:crypto";
import {
  coupModule,
  coupRulesSchema,
  CoupModuleError,
  getCoupModulePlayerView,
  getCoupModuleSpectatorView,
  coupPlayerViewSchema,
  coupSpectatorViewSchema,
} from "@hambazi/coup-engine";
import { MatchFault, type MatchGame, type MatchViewGame } from "../matches/index.js";

/** Opt-in adapter only: does not enable the catalog or select production rules/durations. */
export function createCoupMatchGame(inputRules: unknown): MatchGame & MatchViewGame {
  const parsed = coupRulesSchema.safeParse(inputRules);
  if (!parsed.success) throw new Error("Invalid Coup Match configuration");
  const rules = Object.freeze(parsed.data);
  const random = Object.freeze({ nextInt: (upperExclusive: number) => randomInt(upperExclusive) });
  const engine = coupModule.engine;
  function safe<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof MatchFault) throw error;
      if (error instanceof CoupModuleError) throw new MatchFault(error.code);
      throw new MatchFault("INTERNAL_ERROR");
    }
  }
  function restore(snapshot: unknown, playerIds: readonly string[]) {
    const state = coupModule.migrateState(snapshot, coupModule.descriptor.stateSchemaVersion);
    if (
      state.players.length !== playerIds.length ||
      state.players.some((p, i) => p.id !== playerIds[i])
    )
      throw new MatchFault("INCOMPATIBLE_GAME_VERSION");
    return state;
  }
  return Object.freeze({
    gameId: "coup",
    descriptor: coupModule.descriptor,
    automation: (snapshot, botIds, at) =>
      safe(() => {
        const state = coupModule.migrateState(snapshot, coupModule.descriptor.stateSchemaVersion);
        const deadline = coupModule.timerPolicy.getDeadline(state);
        if (!deadline) return null;
        if (at >= deadline.deadlineAt)
          return { ...deadline, playerId: null, kind: "TIMER" as const };
        const playerId = botIds.find(
          (id) => coupModule.botPolicy.chooseCommand(getCoupModulePlayerView(state, id)) !== null,
        );
        return playerId
          ? { ...deadline, deadlineAt: state.lastCommandAt, playerId, kind: "BOT" as const }
          : { ...deadline, playerId: null, kind: "TIMER" as const };
      }),
    automate: (snapshot, intent, at) =>
      safe(() => {
        const state = coupModule.migrateState(snapshot, coupModule.descriptor.stateSchemaVersion);
        let events: ReturnType<typeof engine.execute> = [];
        if (intent.expectedRevision === state.revision && at >= intent.deadlineAt) {
          if (intent.kind === "TIMER")
            events = coupModule.timerPolicy.executeTimeout(state, intent, {
              clock: { now: () => at },
              random,
            });
          else if (
            intent.playerId !== null &&
            intent.deadlineAt === state.lastCommandAt &&
            state.deadlineAt !== null &&
            at < state.deadlineAt
          ) {
            const view = coupPlayerViewSchema.parse(
              getCoupModulePlayerView(state, intent.playerId),
            );
            const command = coupModule.botPolicy.chooseCommand(view);
            if (command)
              events = engine.execute(state, command, intent.playerId, {
                clock: { now: () => at },
                random,
                rules: state.rules,
              });
          }
        }
        const next = events.reduce(engine.applyEvent, state);
        return {
          state: next,
          events: events.map((event) => ({
            type: event.type,
            schemaVersion: event.schemaVersion,
            payload: event,
          })),
          result: engine.getResult(next),
        };
      }),
    initialize: (playerIds, at) =>
      safe(() =>
        engine.createInitialState(
          { playerIds: [...playerIds] },
          { clock: { now: () => at }, random, rules },
        ),
      ),
    restore: (snapshot, playerIds) => safe(() => restore(snapshot, playerIds)),
    project: (snapshot, userId, role) =>
      safe(() => {
        const state = coupModule.migrateState(snapshot, coupModule.descriptor.stateSchemaVersion);
        return role === "PLAYER"
          ? coupPlayerViewSchema.parse(getCoupModulePlayerView(state, userId))
          : coupSpectatorViewSchema.parse(getCoupModuleSpectatorView(state));
      }),
    execute: (snapshot, command, actorId, at) =>
      safe(() => {
        const state = coupModule.migrateState(snapshot, coupModule.descriptor.stateSchemaVersion);
        const parsedCommand = coupModule.schemas.command.safeParse(command);
        if (!parsedCommand.success) throw new MatchFault("INVALID_INPUT");
        // Always use persisted rules: replacing server configuration cannot change active games.
        const events = engine.execute(state, parsedCommand.data, actorId, {
          clock: { now: () => at },
          random,
          rules: state.rules,
        });
        const next = events.reduce(engine.applyEvent, state);
        return {
          state: next,
          result: engine.getResult(next),
          events: events.map((event) => ({
            type: event.type,
            schemaVersion: event.schemaVersion,
            payload: event,
          })),
        };
      }),
  } satisfies MatchGame & MatchViewGame);
}
