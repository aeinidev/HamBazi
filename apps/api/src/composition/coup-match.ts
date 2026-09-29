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
