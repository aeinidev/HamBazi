import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  coupCoreEngine,
  coupClaimsEngine,
  coupEngine,
  migrateCoupState,
  upcastCoupEvent,
  coupFrontendAdapter,
  coupBotPolicy,
  type CoupState,
  type CoupEvent,
  type CoupClaimsState,
  type CoupClaimsEvent,
  type CoupModuleState,
  type CoupModuleEvent,
  type CoupModulePlayerView,
  type CoupModuleSpectatorView,
  type CoupRole,
} from "../src/index.js";
import type { StandardGameResult } from "@hambazi/game-core";
interface Fixture<State, Event> {
  initial: State;
  events: Event[];
  final: State;
  result: StandardGameResult;
}
function fixture<State, Event>(name: string): Fixture<State, Event> {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as Fixture<State, Event>;
}

describe("pinned compatibility corpus", () => {
  it("replays frozen core-v1/state-2 events with their retained engine", () => {
    const f = fixture<CoupState, CoupEvent>("core-v1");
    const replay = f.events.reduce(coupCoreEngine.applyEvent, f.initial);
    expect(replay).toEqual(f.final);
    expect(coupCoreEngine.getResult(replay)).toEqual(f.result);
    expect(() => migrateCoupState(f.initial, 2)).toThrow(
      expect.objectContaining({ code: "INCOMPATIBLE_GAME_VERSION" }),
    );
    expect(() => upcastCoupEvent(f.events[0], 1)).toThrow(
      expect.objectContaining({ code: "INCOMPATIBLE_GAME_VERSION" }),
    );
  });
  it("replays frozen claims-v1/state-3 events without injecting deadlines or changing semantics", () => {
    const f = fixture<CoupClaimsState, CoupClaimsEvent>("claims-v1");
    const replay = f.events.reduce(coupClaimsEngine.applyEvent, f.initial);
    expect(replay).toEqual(f.final);
    expect(coupClaimsEngine.getResult(replay)).toEqual(f.result);
    expect(() => migrateCoupState(f.initial, 3)).toThrow(
      expect.objectContaining({ code: "INCOMPATIBLE_GAME_VERSION" }),
    );
    expect(() => upcastCoupEvent(f.events[0], 2)).toThrow(
      expect.objectContaining({ code: "INCOMPATIBLE_GAME_VERSION" }),
    );
  });
  it("replays complete v1 fixture and compares every seat/spectator against phase goldens", () => {
    const f = JSON.parse(
      readFileSync(new URL("./fixtures/module-v1.json", import.meta.url), "utf8"),
    ) as Fixture<CoupModuleState, CoupModuleEvent> & {
      goldens: Record<
        string,
        { revision: number; players: CoupModulePlayerView[]; spectator: CoupModuleSpectatorView }
      >;
    };
    let s = migrateCoupState(f.initial, 4);
    const seen = new Set<string>();
    function check() {
      expect(migrateCoupState(JSON.parse(JSON.stringify(s)), 4)).toEqual(s);
      const golden = f.goldens[s.phase];
      if (golden?.revision === s.revision) {
        seen.add(s.phase);
        expect(coupEngine.getSpectatorView!(s)).toEqual(golden.spectator);
        for (const [index, p] of s.players.entries()) {
          const view = coupEngine.getPlayerView(s, p.id);
          expect(view).toEqual(golden.players[index]);
          expect(coupFrontendAdapter.toPresentation(JSON.parse(JSON.stringify(view))).view).toEqual(
            view,
          );
          const command = coupBotPolicy.chooseCommand(view);
          if (command) expect(() => coupEngine.validateCommand(s, command, p.id)).not.toThrow();
        }
      }
    }
    check();
    for (const e of f.events) {
      s = coupEngine.applyEvent(s, upcastCoupEvent(e, 3));
      check();
    }
    expect(s).toEqual(f.final);
    expect(coupEngine.getResult(s)).toEqual(f.result);
    expect([...seen].sort()).toEqual(
      ["WAITING_FOR_ACTION", "CHALLENGE", "BLOCK", "PROOF", "LOSS", "EXCHANGE", "GAME_OVER"].sort(),
    );
  });
  it("all phase projections and bot choices are invariant to every other player's private data", () => {
    const f = fixture<CoupModuleState, CoupModuleEvent>("module-v1");
    let s = f.initial;
    for (const current of [
      s,
      ...f.events.map((e) => {
        s = coupEngine.applyEvent(s, e);
        return s;
      }),
    ]) {
      for (const viewer of current.players) {
        const changed: CoupModuleState = {
          ...current,
          deck: [...current.deck].reverse(),
          players: current.players.map((p) =>
            p.id === viewer.id
              ? p
              : { ...p, influence: p.influence.map(() => "CONTESSA" as CoupRole) },
          ),
          exchange:
            current.exchange && current.exchange.playerId !== viewer.id
              ? { ...current.exchange, drawn: ["DUKE", "DUKE"] }
              : current.exchange,
        };
        const before = coupEngine.getPlayerView(current, viewer.id),
          after = coupEngine.getPlayerView(changed, viewer.id);
        expect(after).toEqual(before);
        expect(coupBotPolicy.chooseCommand(after)).toEqual(coupBotPolicy.chooseCommand(before));
        expect(coupEngine.getSpectatorView!(changed)).toEqual(
          coupEngine.getSpectatorView!(current),
        );
      }
    }
  });
  it("existing claims rules retain outcomes under the new engine before deadlines", () => {
    const f = fixture<CoupModuleState, CoupModuleEvent>("module-v1");
    const {
      actionTimeoutMs: _action,
      responseTimeoutMs: _response,
      decisionTimeoutMs: _decision,
      ...sharedRules
    } = f.initial.rules;
    const legacyRules = { ...sharedRules, rulesetVersion: "coup-provisional-claims-v1" as const };
    const random = { nextInt: (n: number) => n - 1 },
      clock = { now: () => 1000 };
    for (let run = 1; run <= 20; run++) {
      let value = run;
      const pick = (max: number) => {
        value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
        return value % max;
      };
      const playerIds = f.initial.players.slice(0, 2 + (run % 2)).map((p) => p.id);
      let modern = coupEngine.createInitialState(
        { playerIds },
        { clock, random, rules: f.initial.rules },
      );
      let legacy = coupClaimsEngine.createInitialState(
        { playerIds },
        { clock, random, rules: legacyRules },
      );
      for (let i = 0; i < 500 && modern.phase !== "GAME_OVER"; i++) {
        const actor =
          modern.phase === "WAITING_FOR_ACTION"
            ? modern.turnPlayerId
            : modern.window!.eligibleIds.find((id) => !modern.window!.passedIds.includes(id))!;
        const view = coupEngine.getPlayerView(modern, actor);
        const legal = view.legalCommands.filter(
          (c) => c.type !== "DECLARE_EXCHANGE" && c.type !== "SELECT_EXCHANGE",
        );
        const c = i < 80 ? legal[pick(legal.length)]! : coupBotPolicy.chooseCommand(view)!;
        modern = coupEngine
          .execute(modern, c, actor, { clock, random, rules: f.initial.rules })
          .reduce(coupEngine.applyEvent, modern);
        legacy = coupClaimsEngine
          .execute(legacy, c, actor, { clock, random, rules: legacyRules })
          .reduce(coupClaimsEngine.applyEvent, legacy);
        expect(modern).toEqual({
          ...legacy,
          engineVersion: modern.engineVersion,
          stateSchemaVersion: 4,
          rulesetVersion: modern.rulesetVersion,
          rules: modern.rules,
          lastCommandAt: modern.lastCommandAt,
          deadlineAt: modern.deadlineAt,
          exchange: null,
          metrics: modern.metrics,
        });
      }
      expect(modern.phase).toBe("GAME_OVER");
    }
  });
});
