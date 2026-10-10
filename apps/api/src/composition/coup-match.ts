import { randomInt } from "node:crypto";
import {
  coupModule,
  coupRulesSchema,
  coupAnarchistModule,
  coupAnarchistRulesSchema,
  CoupModuleError,
} from "@hambazi/coup-engine";
import { MatchFault, type MatchGame, type MatchViewGame } from "../matches/index.js";

import type { GameEngine, RuleConfig, Clock, RandomSource } from "@hambazi/game-core";

/** Opt-in adapter only: does not enable the catalog or select production rules/durations. */
export function createCoupMatchGame(inputRules: unknown): MatchGame & MatchViewGame {
  const parsed = coupRulesSchema.safeParse(inputRules);
  if (!parsed.success) throw new Error("Invalid Coup Match configuration");
  return createAdapter(coupModule, Object.freeze(parsed.data));
}
export function createAnarchistCoupMatchGame(inputRules: unknown): MatchGame & MatchViewGame {
  const parsed = coupAnarchistRulesSchema.safeParse(inputRules);
  if (!parsed.success) throw new Error("Invalid Coup Match configuration");
  return createAdapter(coupAnarchistModule, Object.freeze(parsed.data));
}
function createAdapter<
  Rules extends RuleConfig,
  State extends {
    readonly players: readonly { readonly id: string }[];
    readonly lastCommandAt: number;
    readonly revision: number;
    readonly deadlineAt: number | null;
    readonly rules: Rules;
  },
  Event extends { readonly type: string; readonly schemaVersion: number },
  PlayerView extends ReturnType<MatchViewGame["project"]>,
  SpectatorView extends ReturnType<MatchViewGame["project"]>,
>(
  module: {
    readonly descriptor: GameEngine<
      State,
      unknown,
      unknown,
      Event,
      PlayerView,
      Rules,
      SpectatorView
    >["descriptor"];
    readonly engine: GameEngine<State, unknown, unknown, Event, PlayerView, Rules, SpectatorView>;
    migrateState(input: unknown, fromVersion: number): State;
    readonly botPolicy: { chooseCommand(input: unknown): unknown | null };
    readonly timerPolicy: {
      getDeadline(state: State): { expectedRevision: number; deadlineAt: number } | null;
      executeTimeout(
        state: State,
        guard: { expectedRevision: number; deadlineAt: number },
        deps: { clock: Clock; random: RandomSource },
      ): readonly Event[];
    };
  },
  rules: Rules,
): MatchGame & MatchViewGame {
  const random = Object.freeze({ nextInt: (upperExclusive: number) => randomInt(upperExclusive) });
  const engine = module.engine;
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
    const state = module.migrateState(snapshot, module.descriptor.stateSchemaVersion);
    if (
      state.players.length !== playerIds.length ||
      state.players.some((p, i) => p.id !== playerIds[i])
    )
      throw new MatchFault("INCOMPATIBLE_GAME_VERSION");
    return state;
  }
  return Object.freeze({
    gameId: "coup",
    descriptor: module.descriptor,
    automation: (snapshot, botIds, at) =>
      safe(() => {
        const state = module.migrateState(snapshot, module.descriptor.stateSchemaVersion);
        const deadline = module.timerPolicy.getDeadline(state);
        if (!deadline) return null;
        if (at >= deadline.deadlineAt)
          return { ...deadline, playerId: null, kind: "TIMER" as const };
        const playerId = botIds.find(
          (id) => module.botPolicy.chooseCommand(engine.getPlayerView(state, id)) !== null,
        );
        return playerId
          ? { ...deadline, deadlineAt: state.lastCommandAt, playerId, kind: "BOT" as const }
          : { ...deadline, playerId: null, kind: "TIMER" as const };
      }),
    automate: (snapshot, intent, at) =>
      safe(() => {
        const state = module.migrateState(snapshot, module.descriptor.stateSchemaVersion);
        let events: ReturnType<typeof engine.execute> = [];
        if (intent.expectedRevision === state.revision && at >= intent.deadlineAt) {
          if (intent.kind === "TIMER")
            events = module.timerPolicy.executeTimeout(state, intent, {
              clock: { now: () => at },
              random,
            });
          else if (
            intent.playerId !== null &&
            intent.deadlineAt === state.lastCommandAt &&
            state.deadlineAt !== null &&
            at < state.deadlineAt
          ) {
            const view = engine.getPlayerView(state, intent.playerId);
            const command = module.botPolicy.chooseCommand(view);
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
        const state = module.migrateState(snapshot, module.descriptor.stateSchemaVersion);
        return role === "PLAYER"
          ? engine.getPlayerView(state, userId)
          : (engine.getSpectatorView?.(state) ??
              (() => {
                throw new MatchFault("INCOMPATIBLE_GAME_VERSION");
              })());
      }),
    execute: (snapshot, command, actorId, at) =>
      safe(() => {
        const state = module.migrateState(snapshot, module.descriptor.stateSchemaVersion);
        // Always use persisted rules: replacing server configuration cannot change active games.
        const events = engine.execute(state, command, actorId, {
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
