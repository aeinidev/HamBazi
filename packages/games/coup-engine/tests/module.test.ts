import { describe, expect, it } from "vitest";
import {
  coupEngine as engine,
  coupDescriptor,
  coupModule,
  coupRulesSchema,
  coupBotPolicy,
  coupTimerPolicy,
  executeCoupTimeout,
  getCoupReconnectView,
  coupFrontendAdapter,
  migrateCoupState,
  upcastCoupEvent,
  CoupModuleError,
  type CoupRules,
  type CoupModuleState as State,
  type CoupModuleEvent as Event,
  type CoupRole,
} from "../src/index.js";
const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
const rules: CoupRules = {
  rulesetVersion: "coup-provisional-complete-v1",
  copiesPerRole: 3,
  cardsPerPlayer: 2,
  startingCoins: 2,
  incomeCoins: 1,
  foreignAidCoins: 2,
  coupCost: 7,
  mandatoryCoupAt: 10,
  taxCoins: 3,
  stealCoins: 2,
  assassinationCost: 3,
  actionTimeoutMs: 1000,
  responseTimeoutMs: 100,
  decisionTimeoutMs: 500,
};
const deps = { clock: { now: () => 1000 }, random: { nextInt: (n: number) => n - 1 }, rules };
function initial(n = 3, config = rules): State {
  return engine.createInitialState({ playerIds: ids.slice(0, n) }, { ...deps, rules: config });
}
function step(s: State, c: unknown, id = s.turnPlayerId, at = s.lastCommandAt): State {
  return engine
    .execute(s, c, id, { ...deps, clock: { now: () => at } })
    .reduce(engine.applyEvent, s);
}
function respond(s: State, type: string, id: string, extra = {}): State {
  return step(s, { type, windowId: s.window!.id, ...extra }, id);
}
function pass(s: State): State {
  while (s.phase === "CHALLENGE" || s.phase === "BLOCK")
    s = respond(
      s,
      s.phase === "CHALLENGE" ? "PASS_CHALLENGE" : "PASS_BLOCK",
      s.window!.eligibleIds.find((id) => !s.window!.passedIds.includes(id))!,
    );
  return s;
}
function exchange(s = initial()): State {
  return pass(step(s, { type: "DECLARE_EXCHANGE" }));
}
function cards(s: State) {
  return [
    ...s.deck,
    ...s.players.flatMap((p) => [...p.influence, ...p.revealed]),
    ...(s.exchange?.drawn ?? []),
  ].sort();
}
function hand(s: State, id: string, roles: CoupRole[]): State {
  const pool = [...s.deck, ...s.players.flatMap((p) => p.influence)];
  for (const role of roles) pool.splice(pool.indexOf(role), 1);
  return {
    ...s,
    players: s.players.map((p) => ({
      ...p,
      influence: p.id === id ? roles : pool.splice(0, p.influence.length),
    })),
    deck: pool,
  };
}
function expire(s: State, at = s.deadlineAt!): State {
  return executeCoupTimeout(
    s,
    { expectedRevision: s.revision, deadlineAt: s.deadlineAt! },
    { ...deps, clock: { now: () => at } },
  ).reduce(engine.applyEvent, s);
}

describe("Exchange and deck integrity", () => {
  it.each([1, 2, 3])(
    "keeps exactly %i live cards and returns two; no revealed card is selectable",
    (count) => {
      let s = initial(3, { ...rules, cardsPerPlayer: count });
      const inventory = cards(s);
      if (count === 1) {
        // Also cover a reduced hand under a two-card ruleset.
        s = initial();
        s = {
          ...s,
          players: s.players.map((p, i) =>
            i === 0
              ? { ...p, influence: p.influence.slice(1), revealed: p.influence.slice(0, 1) }
              : p,
          ),
        };
      }
      const before = s,
        drawn = s.deck.slice(0, 2);
      s = exchange(s);
      expect(s.phase).toBe("EXCHANGE");
      expect(s.exchange!.drawn).toEqual(drawn);
      const view = engine.getPlayerView(s, ids[0]!);
      expect(view.exchangeChoices).toEqual([...before.players[0]!.influence, ...drawn]);
      expect(engine.getPlayerView(s, ids[1]!).exchangeChoices).toBeNull();
      expect(engine.getSpectatorView!(s)).not.toHaveProperty("exchangeChoices");
      const selection = Array.from({ length: count }, (_, i) => i + 1);
      s = respond(s, "SELECT_EXCHANGE", ids[0]!, { cardIndices: selection });
      expect(s.players[0]!.influence).toEqual(selection.map((i) => view.exchangeChoices![i]));
      expect(s.players[0]!.revealed).toEqual(before.players[0]!.revealed);
      expect(s.deck).toHaveLength(before.deck.length);
      expect(cards(s)).toEqual(count === 1 ? cards(before) : inventory);
      expect(s.metrics.exchanges).toBe(1);
      expect(s.turnNumber).toBe(2);
      expect(migrateCoupState(s, 4)).toEqual(s);
    },
  );
  it.each([[0], [0, 0], [0, 4], [0, 1, 2], [-1, 0]].map((cardIndices) => ({ cardIndices })))(
    "rejects invalid keep selection $cardIndices without mutation",
    ({ cardIndices }) => {
      const s = exchange(),
        before = JSON.stringify(s);
      expect(() => respond(s, "SELECT_EXCHANGE", ids[0]!, { cardIndices })).toThrow();
      expect(JSON.stringify(s)).toBe(before);
    },
  );
  it("rejects foreign selection, stale window, outcome injection and corrupt replay deck", () => {
    const s = exchange();
    const command = { type: "SELECT_EXCHANGE", windowId: s.window!.id, cardIndices: [0, 1] };
    expect(() => step(s, command, ids[1])).toThrow();
    expect(() => step(s, { ...command, windowId: s.window!.id - 1 })).toThrow();
    expect(() => step(s, { ...command, returnedDeck: [] })).toThrow();
    const event = engine.execute(s, command, ids[0]!, deps)[0]!;
    expect(() => engine.applyEvent(s, { ...event, returnedDeck: [] })).toThrow();
    const done = engine.applyEvent(s, event);
    expect(() => engine.applyEvent(done, event)).toThrow();
    expect(cards(done)).toEqual(cards(s));
    expect(upcastCoupEvent(event, 3)).toEqual(event);
  });
  it("Exchange is challengeable as Ambassador, never blockable", () => {
    let s = step(hand(initial(), ids[0]!, ["AMBASSADOR", "DUKE"]), { type: "DECLARE_EXCHANGE" });
    expect(s.window!.claim!.role).toBe("AMBASSADOR");
    expect(() => respond(s, "BLOCK", ids[1]!, { role: "DUKE" })).toThrow();
    s = respond(s, "CHALLENGE", ids[1]!);
    s = respond(s, "PROVE_CLAIM", ids[0]!, { cardIndex: 0 });
    expect(s.exchange).toBeNull();
    s = respond(s, "SELECT_CARD_TO_LOSE", ids[1]!, { cardIndex: 0 });
    expect(s.phase).toBe("EXCHANGE");
    expect(s.metrics).toMatchObject({ challenges: 1, claimsProved: 1 });
  });
  it("conceded Exchange never draws; winning final challenge ends without selection", () => {
    let s = step(initial(), { type: "DECLARE_EXCHANGE" });
    const deck = s.deck;
    s = respond(s, "CHALLENGE", ids[1]!);
    s = respond(s, "CONCEDE_CLAIM", ids[0]!);
    s = respond(s, "SELECT_CARD_TO_LOSE", ids[0]!, { cardIndex: 0 });
    expect(s.deck).toEqual(deck);
    expect(s.phase).toBe("WAITING_FOR_ACTION");
    s = hand(initial(2), ids[0]!, ["AMBASSADOR", "DUKE"]);
    s = {
      ...s,
      players: s.players.map((p, i) =>
        i === 1 ? { ...p, influence: p.influence.slice(1), revealed: p.influence.slice(0, 1) } : p,
      ),
    };
    s = respond(step(s, { type: "DECLARE_EXCHANGE" }), "CHALLENGE", ids[1]!);
    s = respond(s, "PROVE_CLAIM", ids[0]!, { cardIndex: 0 });
    s = respond(s, "SELECT_CARD_TO_LOSE", ids[1]!, { cardIndex: 0 });
    expect(s.phase).toBe("GAME_OVER");
    expect(s.exchange).toBeNull();
  });
  it("requires two spare cards and explicit valid timer configuration", () => {
    expect(() => initial(2, { ...rules, copiesPerRole: 1 })).toThrow();
    expect(coupRulesSchema.safeParse({ ...rules, actionTimeoutMs: 0 }).success).toBe(false);
    expect(coupRulesSchema.safeParse({ ...rules, mandatoryCoupAt: 6 }).success).toBe(false);
    const { responseTimeoutMs: _timeout, ...missing } = rules;
    expect(coupRulesSchema.safeParse(missing).success).toBe(false);
  });
});

describe("persisted deadlines and trusted timeouts", () => {
  it("checks exact deadline, rejects player timeout injection, and ignores early/stale/duplicate jobs", () => {
    const s = initial(),
      guard = coupTimerPolicy.getDeadline(s)!;
    expect(guard.deadlineAt).toBe(2000);
    expect(executeCoupTimeout(s, guard, { ...deps, clock: { now: () => 1999 } })).toEqual([]);
    expect(() => step(s, { type: "TIMEOUT", ...guard })).toThrow();
    expect(() => step(s, { type: "DECLARE_INCOME" }, ids[0], 2000)).toThrow();
    const result = expire(s);
    expect(result.players[0]!.coins).toBe(3);
    expect(result.lastCommandAt).toBe(2000);
    expect(result.deadlineAt).toBe(3000);
    expect(executeCoupTimeout(result, guard, { ...deps, clock: { now: () => 3000 } })).toEqual([]);
    expect(
      executeCoupTimeout(
        s,
        { ...guard, deadlineAt: 2001 },
        { ...deps, clock: { now: () => 3000 } },
      ),
    ).toEqual([]);
  });
  it("passes keep the shared response deadline; next decision receives a fresh deadline", () => {
    let s = step(initial(), { type: "DECLARE_EXCHANGE" });
    expect(s.deadlineAt).toBe(1100);
    s = expire(s);
    expect(s.phase).toBe("CHALLENGE");
    expect(s.deadlineAt).toBe(1100);
    const old = s;
    s = expire(s);
    expect(s.phase).toBe("EXCHANGE");
    expect(s.deadlineAt).toBe(1600);
    const own = s.players[0]!.influence;
    s = expire(s);
    expect(s.players[0]!.influence).toEqual(own);
    expect(s.deadlineAt).toBe(2600);
    expect(s.metrics.timeouts).toBe(3);
    expect(s.metrics.exchanges).toBe(1);
    expect(
      executeCoupTimeout(s, coupTimerPolicy.getDeadline(old)!, {
        ...deps,
        clock: { now: () => 3000 },
      }),
    ).toEqual([]);
  });
  it("timeout selects mandatory Coup and deterministic loss; late jobs do not shorten a new turn", () => {
    let s = initial(2, { ...rules, startingCoins: 10 });
    s = expire(s, 5000);
    expect(s.pendingAction!.kind).toBe("COUP");
    expect(s.players[0]!.coins).toBe(3);
    expect(s.deadlineAt).toBe(5500);
    s = expire(s);
    expect(s.players[1]!.influence).toHaveLength(1);
    expect(s.deadlineAt).toBe(6500);
  });
  it.each([true, false])("timeout resolves proof when matching card exists: %s", (truthful) => {
    let s = hand(initial(), ids[0]!, truthful ? ["DUKE", "ASSASSIN"] : ["CONTESSA", "ASSASSIN"]);
    s = respond(step(s, { type: "DECLARE_TAX" }), "CHALLENGE", ids[1]!);
    s = expire(s);
    expect(s.loss!.playerId).toBe(truthful ? ids[1] : ids[0]);
    expect(s.metrics[truthful ? "claimsProved" : "claimsConceded"]).toBe(1);
  });
  it("rejects time reversal, corrupt deadline events and forged timeout decisions", () => {
    const s = initial(),
      c = { type: "DECLARE_INCOME" };
    expect(() => step(s, c, ids[0], 999)).toThrow();
    expect(() => step(s, c, ids[0], Number.NaN)).toThrow();
    const event = engine.execute(s, c, ids[0]!, deps)[0]!;
    expect(() => engine.applyEvent(s, { ...event, deadlineAt: 9999 })).toThrow();
    expect(() => engine.applyEvent(s, { ...event, source: "TIMEOUT" })).toThrow();
    const timed = executeCoupTimeout(s, coupTimerPolicy.getDeadline(s)!, {
      ...deps,
      clock: { now: () => 2000 },
    })[0]!;
    expect(() => engine.applyEvent(s, { ...timed, command: { type: "DECLARE_TAX" } })).toThrow();
    expect(() => engine.applyEvent(s, { ...timed, actorId: ids[1]! })).toThrow();
  });
  it("reconnect never resets time or restores a replaced seat's private view", () => {
    const s = exchange(),
      before = JSON.stringify(s);
    expect(getCoupReconnectView(s, ids[0]!, "HUMAN")).toEqual(engine.getPlayerView(s, ids[0]!));
    expect(getCoupReconnectView(s, ids[0]!, "REPLACED_BY_BOT")).toEqual(
      engine.getSpectatorView!(s),
    );
    expect(() => getCoupReconnectView(s, ids[5]!, "REPLACED_BY_BOT")).toThrow();
    expect(JSON.stringify(s)).toBe(before);
    expect(coupModule.reconnectPolicy.allowSeatReclaim).toBe(false);
  });
});

describe("bots, frontend and compatibility boundaries", () => {
  it("bot sees only a human view; hidden-state changes do not change decisions or presentation", () => {
    const s = exchange(),
      id = ids[1]!,
      view = engine.getPlayerView(s, id);
    const altered = {
      ...s,
      deck: [...s.deck].reverse(),
      exchange: { ...s.exchange!, drawn: ["CONTESSA", "CONTESSA"] as CoupRole[] },
      players: s.players.map((p) =>
        p.id === ids[0] ? { ...p, influence: ["ASSASSIN", "CAPTAIN"] as CoupRole[] } : p,
      ),
    };
    expect(engine.getPlayerView(altered, id)).toEqual(view);
    expect(engine.getSpectatorView!(altered)).toEqual(engine.getSpectatorView!(s));
    expect(coupBotPolicy.chooseCommand(view)).toBe(
      coupBotPolicy.chooseCommand(engine.getPlayerView(altered, id)),
    );
    expect(coupFrontendAdapter.toPresentation(view)).toEqual(
      coupFrontendAdapter.toPresentation(engine.getPlayerView(altered, id)),
    );
    expect(() => coupBotPolicy.chooseCommand(s)).toThrow(CoupModuleError);
    expect(() => coupFrontendAdapter.toPresentation({ ...view, deck: s.deck })).toThrow(
      CoupModuleError,
    );
    expect(() => coupFrontendAdapter.toPresentation({ ...view, engineVersion: "future" })).toThrow(
      CoupModuleError,
    );
    expect(coupFrontendAdapter.toPresentation(engine.getSpectatorView!(s)).commands).toEqual([]);
  });
  it("validates current snapshots/events and fails old, unknown, malformed versions with stable errors", () => {
    const s = initial();
    expect(migrateCoupState(JSON.parse(JSON.stringify(s)), 4)).toEqual(s);
    for (const version of [1, 2, 3, 5])
      expect(() => migrateCoupState(s, version)).toThrow(
        expect.objectContaining({ code: "INCOMPATIBLE_GAME_VERSION" }),
      );
    for (const bad of [
      { ...s, deck: [] },
      { ...s, engineVersion: "coup-claims-v1" },
      { ...s, deadlineAt: null },
      { ...s, players: [s.players[0], s.players[0]] },
      { ...s, seed: "private" },
    ])
      expect(() => migrateCoupState(bad, 4)).toThrow(
        expect.objectContaining({ code: "INCOMPATIBLE_GAME_VERSION" }),
      );
    expect(() => upcastCoupEvent({}, 2)).toThrow(
      expect.objectContaining({ code: "INCOMPATIBLE_GAME_VERSION" }),
    );
    expect(coupModule.manifest.status).toBe("DISABLED");
    expect(coupModule.descriptor).toEqual(coupDescriptor);
  });
  it("every server phase projects bot-valid commands; generated games conserve cards and replay with time/randomness absent", () => {
    const phases = new Set<string>();
    for (let n = 2; n <= 6; n++)
      for (let run = 1; run <= 10; run++) {
        let value = run;
        const random = {
          nextInt: (max: number) => {
            value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
            return value % max;
          },
        };
        const start = engine.createInitialState(
          { playerIds: ids.slice(0, n) },
          { ...deps, random },
        );
        let s = start;
        const events: Event[] = [];
        const inventory = cards(s);
        for (let i = 0; i < 1000 && s.phase !== "GAME_OVER"; i++) {
          phases.add(s.phase);
          const before = JSON.stringify(s);
          for (const p of s.players) {
            const view = engine.getPlayerView(s, p.id),
              command = coupBotPolicy.chooseCommand(view);
            if (command) expect(() => engine.validateCommand(s, command, p.id)).not.toThrow();
            for (const legal of view.legalCommands)
              expect(() => engine.validateCommand(s, legal, p.id)).not.toThrow();
            expect(coupFrontendAdapter.toPresentation(view).view).toEqual(view);
          }
          let next: readonly Event[];
          if (i % 11 === 0 || s.lastCommandAt >= s.deadlineAt!)
            next = executeCoupTimeout(s, coupTimerPolicy.getDeadline(s)!, {
              ...deps,
              random,
              clock: { now: () => s.deadlineAt! },
            });
          else {
            const actor =
              s.phase === "WAITING_FOR_ACTION"
                ? s.turnPlayerId
                : s.window!.eligibleIds.find((id) => !s.window!.passedIds.includes(id))!;
            const view = engine.getPlayerView(s, actor),
              legal = view.legalCommands;
            // Explore rules for the opening, then use the terminating bot strategy.
            const command =
              i < 80 ? legal[random.nextInt(legal.length)]! : coupBotPolicy.chooseCommand(view)!;
            next = engine.execute(s, command, actor, {
              ...deps,
              random,
              clock: { now: () => s.lastCommandAt },
            });
          }
          s = next.reduce(engine.applyEvent, s);
          events.push(...next);
          expect(JSON.stringify(s)).not.toBe(before);
          expect(cards(s)).toEqual(inventory);
          expect(migrateCoupState(s, 4)).toEqual(s);
          expect(s.players.every((p) => p.coins >= 0)).toBe(true);
        }
        expect(s.phase).toBe("GAME_OVER");
        expect(coupTimerPolicy.getDeadline(s)).toBeNull();
        expect(expire(s)).toEqual(s);
        expect(events.reduce(engine.applyEvent, start)).toEqual(s);
        const result = engine.getResult(s)!;
        expect(result.placements).toHaveLength(n);
        expect(result.metrics.durationMs).toBe(s.lastCommandAt - start.createdAt);
        expect(result.metrics.timeouts).toBe(events.filter((e) => e.source === "TIMEOUT").length);
        expect(result.metrics.exchanges).toBe(
          events.filter((e) => e.command.type === "SELECT_EXCHANGE").length,
        );
        expect(Object.isFrozen(s)).toBe(true);
      }
    expect([...phases].sort()).toEqual(
      ["WAITING_FOR_ACTION", "CHALLENGE", "BLOCK", "PROOF", "LOSS", "EXCHANGE"].sort(),
    );
  });
});

describe("boundary regressions", () => {
  it("human-vs-timeout ordering has one winner with revision/window guards", () => {
    const initialState = initial();
    const guard = coupTimerPolicy.getDeadline(initialState)!;
    const humanEvents = engine.execute(initialState, { type: "DECLARE_TAX" }, ids[0]!, {
      ...deps,
      clock: { now: () => 1999 },
    });
    const humanFirst = humanEvents.reduce(engine.applyEvent, initialState);
    expect(executeCoupTimeout(humanFirst, guard, { ...deps, clock: { now: () => 2000 } })).toEqual(
      [],
    );
    const timeoutEvents = executeCoupTimeout(initialState, guard, {
      ...deps,
      clock: { now: () => 2000 },
    });
    const timerFirst = timeoutEvents.reduce(engine.applyEvent, initialState);
    expect(() => engine.applyEvent(timerFirst, humanEvents[0]!)).toThrow();
    expect(() => engine.applyEvent(humanFirst, timeoutEvents[0]!)).toThrow();
  });
  it("restoration rejects corrupted proof, loss, metrics and window ownership", () => {
    let s = respond(step(initial(), { type: "DECLARE_TAX" }), "CHALLENGE", ids[1]!);
    expect(() =>
      migrateCoupState(
        { ...s, proof: { ...s.proof!, claim: { ...s.proof!.claim, role: "CAPTAIN" } } },
        4,
      ),
    ).toThrow();
    expect(() => migrateCoupState({ ...s, metrics: { ...s.metrics, challenges: 0 } }, 4)).toThrow();
    expect(() =>
      migrateCoupState({ ...s, window: { ...s.window!, eligibleIds: [ids[2]] } }, 4),
    ).toThrow();
    s = respond(s, "CONCEDE_CLAIM", ids[0]!);
    expect(() => migrateCoupState({ ...s, loss: { ...s.loss!, resume: "RESOLVE" } }, 4)).toThrow();
    expect(() => migrateCoupState({ ...s, loss: { ...s.loss!, reason: "COUP" } }, 4)).toThrow();
  });
  it("Exchange return shuffle is deterministic with injected randomness and rejects invalid random indices", () => {
    const s = exchange();
    const command = { type: "SELECT_EXCHANGE", windowId: s.window!.id, cardIndices: [2, 3] };
    const first = engine.execute(s, command, ids[0]!, deps),
      second = engine.execute(s, command, ids[0]!, deps);
    expect(first).toEqual(second);
    for (const value of [-1, 0.5, 999, Number.NaN])
      expect(() =>
        engine.execute(s, command, ids[0]!, { ...deps, random: { nextInt: () => value } }),
      ).toThrow();
    const different = engine.execute(s, command, ids[0]!, {
      ...deps,
      random: { nextInt: () => 0 },
    });
    expect(different[0]!.returnedDeck).not.toEqual(first[0]!.returnedDeck);
    expect(cards(different.reduce(engine.applyEvent, s))).toEqual(cards(s));
  });
});
