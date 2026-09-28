import { describe, expect, it } from "vitest";
import {
  coupClaimsEngine as engine,
  coupClaimsDescriptor,
  type CoupClaimsState as State,
  type CoupClaimsRules,
  type CoupRole,
  type CoupClaimsCommand as Command,
  type CoupClaimsEvent as Event,
} from "../src/index.js";
const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
const rules: CoupClaimsRules = {
  rulesetVersion: "coup-provisional-claims-v1",
  copiesPerRole: 3,
  cardsPerPlayer: 2,
  startingCoins: 5,
  incomeCoins: 1,
  foreignAidCoins: 2,
  coupCost: 7,
  mandatoryCoupAt: 10,
  taxCoins: 3,
  stealCoins: 2,
  assassinationCost: 3,
};
const deps = { rules, clock: { now: () => 100 }, random: { nextInt: (n: number) => n - 1 } };
function initial(n = 3): State {
  return engine.createInitialState({ playerIds: ids.slice(0, n) }, deps);
}
function step(s: State, c: unknown, actor = s.turnPlayerId): State {
  return engine.execute(s, c, actor, deps).reduce(engine.applyEvent, s);
}
function response(s: State, type: string, actor: string, extra = {}) {
  return step(s, { type, windowId: s.window!.id, ...extra }, actor);
}
function passes(s: State): State {
  while (s.phase === "CHALLENGE" || s.phase === "BLOCK") {
    const who = s.window!.eligibleIds.find((id) => !s.window!.passedIds.includes(id))!;
    s = response(s, s.phase === "CHALLENGE" ? "PASS_CHALLENGE" : "PASS_BLOCK", who);
  }
  return s;
}
// Fixtures move cards between hands/deck, preserving the complete card multiset.
function hand(s: State, id: string, desired: CoupRole[]): State {
  const pool = [...s.deck, ...s.players.flatMap((p) => p.influence)];
  for (const role of desired) pool.splice(pool.indexOf(role), 1);
  const players = s.players.map((p) => ({
    ...p,
    influence: p.id === id ? desired : pool.splice(0, p.influence.length),
  }));
  return { ...s, players, deck: pool };
}
function cards(s: State) {
  return [...s.deck, ...s.players.flatMap((p) => [...p.influence, ...p.revealed])].sort();
}
function challenge(s: State, challenger: string) {
  return response(s, "CHALLENGE", challenger);
}
function lose(s: State) {
  return response(s, "SELECT_CARD_TO_LOSE", s.loss!.playerId, { cardIndex: 0 });
}

describe("claims action and block matrix", () => {
  it.each([
    ["DECLARE_INCOME", 1],
    ["DECLARE_FOREIGN_AID", 2],
    ["DECLARE_TAX", 3],
    ["DECLARE_STEAL", 2],
  ] as const)("%s unopposed resolves once", (type, delta) => {
    let s = initial();
    s = step(s, { type, ...(type === "DECLARE_STEAL" ? { targetId: ids[1] } : {}) });
    s = passes(s);
    expect(s.players[0]!.coins).toBe(5 + delta);
    expect(s.turnPlayerId).toBe(ids[1]);
    expect(s.actionCount).toBe(1);
    if (type === "DECLARE_STEAL") expect(s.players[1]!.coins).toBe(3);
  });
  it.each([
    ["DECLARE_FOREIGN_AID", "DUKE"],
    ["DECLARE_STEAL", "CAPTAIN"],
    ["DECLARE_STEAL", "AMBASSADOR"],
    ["DECLARE_ASSASSINATION", "CONTESSA"],
  ] as const)("%s accepts %s block", (type, role) => {
    let s = step(initial(), {
      type,
      ...(type !== "DECLARE_FOREIGN_AID" ? { targetId: ids[1] } : {}),
    });
    while (s.phase === "CHALLENGE")
      s = response(
        s,
        "PASS_CHALLENGE",
        s.window!.eligibleIds.find((id) => !s.window!.passedIds.includes(id))!,
      );
    s = response(s, "BLOCK", ids[1]!, { role });
    s = passes(s);
    expect(s.players[0]!.coins).toBe(type === "DECLARE_ASSASSINATION" ? 2 : 5);
    expect(s.players[1]!.influence).toHaveLength(2);
    expect(s.turnNumber).toBe(2);
  });
  it.each(["DECLARE_TAX", "DECLARE_STEAL", "DECLARE_ASSASSINATION"] as const)(
    "%s conceded action fails; assassination refunded",
    (type) => {
      let s = step(initial(), { type, ...(type !== "DECLARE_TAX" ? { targetId: ids[1] } : {}) });
      s = challenge(s, ids[2]!);
      s = response(s, "CONCEDE_CLAIM", ids[0]!);
      s = lose(s);
      expect(s.players[0]!.coins).toBe(5);
      expect(s.players[0]!.influence).toHaveLength(1);
      expect(s.turnNumber).toBe(2);
    },
  );
  it.each([
    ["DECLARE_TAX", "DUKE"],
    ["DECLARE_STEAL", "CAPTAIN"],
    ["DECLARE_ASSASSINATION", "ASSASSIN"],
  ] as const)("%s proof replaces the card before challenger loss", (type, role) => {
    let s = hand(initial(), ids[0]!, [role, "CONTESSA"]);
    const before = cards(s);
    s = step(s, { type, ...(type !== "DECLARE_TAX" ? { targetId: ids[1] } : {}) });
    s = challenge(s, ids[2]!);
    const event = engine.execute(
      s,
      { type: "PROVE_CLAIM", windowId: s.window!.id, cardIndex: 0 },
      ids[0]!,
      deps,
    )[0]!;
    expect(event.replacement).toBeDefined();
    const proven = engine.applyEvent(s, event);
    expect(engine.applyEvent(s, JSON.parse(JSON.stringify(event)))).toEqual(proven);
    expect(proven.players[0]!.influence[0]).not.toBe(role);
    expect(cards(proven)).toEqual(before);
    s = passes(lose(proven));
    if (s.phase === "LOSS") s = lose(s);
    expect(s.players[2]!.influence).toHaveLength(1);
    expect(s.turnNumber).toBe(2);
  });
  it.each([
    ["DECLARE_FOREIGN_AID", "DUKE"],
    ["DECLARE_STEAL", "CAPTAIN"],
    ["DECLARE_STEAL", "AMBASSADOR"],
    ["DECLARE_ASSASSINATION", "CONTESSA"],
  ] as const)("%s false %s block resumes action", (type, role) => {
    let s = step(initial(), {
      type,
      ...(type !== "DECLARE_FOREIGN_AID" ? { targetId: ids[1] } : {}),
    });
    while (s.phase === "CHALLENGE")
      s = response(
        s,
        "PASS_CHALLENGE",
        s.window!.eligibleIds.find((id) => !s.window!.passedIds.includes(id))!,
      );
    s = response(s, "BLOCK", ids[1]!, { role });
    s = challenge(s, ids[2]!);
    s = response(s, "CONCEDE_CLAIM", ids[1]!);
    s = lose(s);
    if (type === "DECLARE_ASSASSINATION") {
      expect(s.phase).toBe("LOSS");
      s = lose(s);
      expect(s.eliminationOrder).toEqual([ids[1]]);
    } else expect(s.players[0]!.coins).toBe(7);
    expect(s.turnNumber).toBe(2);
  });
  it.each(["DUKE", "CAPTAIN", "AMBASSADOR", "CONTESSA"] as const)(
    "truthful %s block defeats challenge",
    (role) => {
      const type =
        role === "DUKE"
          ? "DECLARE_FOREIGN_AID"
          : role === "CONTESSA"
            ? "DECLARE_ASSASSINATION"
            : "DECLARE_STEAL";
      let s = hand(initial(), ids[1]!, [role, "ASSASSIN"]);
      s = step(s, { type, ...(type !== "DECLARE_FOREIGN_AID" ? { targetId: ids[1] } : {}) });
      while (s.phase === "CHALLENGE")
        s = response(
          s,
          "PASS_CHALLENGE",
          s.window!.eligibleIds.find((id) => !s.window!.passedIds.includes(id))!,
        );
      s = response(s, "BLOCK", ids[1]!, { role });
      s = challenge(s, ids[0]!);
      s = response(s, "PROVE_CLAIM", ids[1]!, { cardIndex: 0 });
      s = lose(s);
      expect(s.players[0]!.influence).toHaveLength(1);
      expect(s.players[0]!.coins).toBe(type === "DECLARE_ASSASSINATION" ? 2 : 5);
      expect(s.players[1]!.influence).toHaveLength(2);
    },
  );
  it("target can lose two influence after unsuccessfully challenging assassination", () => {
    let s = hand(initial(), ids[0]!, ["ASSASSIN", "DUKE"]);
    s = challenge(step(s, { type: "DECLARE_ASSASSINATION", targetId: ids[1] }), ids[1]!);
    s = response(s, "PROVE_CLAIM", ids[0]!, { cardIndex: 0 });
    s = lose(s);
    expect(s.phase).toBe("BLOCK");
    s = lose(passes(s));
    expect(s.players[1]!.influence).toHaveLength(0);
    expect(s.turnPlayerId).toBe(ids[2]);
  });
  it("steals available coins before eliminated target's remaining treasury is cleared", () => {
    let s = initial();
    s = {
      ...s,
      players: s.players.map((p, i) =>
        i === 1 ? { ...p, influence: p.influence.slice(1), revealed: p.influence.slice(0, 1) } : p,
      ),
    };
    s = step(s, { type: "DECLARE_STEAL", targetId: ids[1] });
    while (s.phase === "CHALLENGE")
      s = response(
        s,
        "PASS_CHALLENGE",
        s.window!.eligibleIds.find((id) => !s.window!.passedIds.includes(id))!,
      );
    s = response(s, "BLOCK", ids[1]!, { role: "AMBASSADOR" });
    s = challenge(s, ids[0]!);
    s = response(s, "CONCEDE_CLAIM", ids[1]!);
    s = lose(s);
    expect(s.players[0]!.coins).toBe(7);
    expect(s.players[1]!.coins).toBe(0);
  });
});

describe("guards, replay and information flow", () => {
  it("rejects invalid actors, turns, targets, cost, roles, phase, duplicates and stale windows", () => {
    const base = initial();
    for (const [c, id] of [
      [{ type: "DECLARE_TAX" }, ids[1]],
      [{ type: "DECLARE_COUP", targetId: ids[1] }, ids[0]],
      [{ type: "DECLARE_STEAL", targetId: ids[0] }, ids[0]],
      [{ type: "DECLARE_EXCHANGE" }, ids[0]],
    ] as const)
      expect(() => step(base, c, id)).toThrow();
    let s = step(base, { type: "DECLARE_STEAL", targetId: ids[1] });
    const first = s.window!.id;
    expect(() => response(s, "BLOCK", ids[1]!, { role: "CAPTAIN" })).toThrow();
    s = response(s, "PASS_CHALLENGE", ids[1]!);
    expect(() => response(s, "CHALLENGE", ids[1]!)).toThrow();
    s = response(s, "PASS_CHALLENGE", ids[2]!);
    expect(() => response(s, "BLOCK", ids[2]!, { role: "CAPTAIN" })).toThrow();
    expect(() => response(s, "BLOCK", ids[1]!, { role: "DUKE" })).toThrow();
    expect(() => step(s, { type: "PASS_BLOCK", windowId: first }, ids[1])).toThrow();
    const e = engine.execute(s, { type: "PASS_BLOCK", windowId: s.window!.id }, ids[1]!, deps)[0]!;
    expect(() => engine.applyEvent(engine.applyEvent(s, e), e)).toThrow();
    expect(() =>
      step(
        { ...base, players: base.players.map((p, i) => (i === 0 ? { ...p, coins: 10 } : p)) },
        { type: "DECLARE_TAX" },
      ),
    ).toThrow();
    expect(() =>
      step({ ...base, engineVersion: "coup-core-v1" }, { type: "DECLARE_INCOME" }),
    ).toThrow();
  });
  it("rejects false proof, extra hidden payloads, corrupt replacement and invalid random output", () => {
    let s = hand(initial(), ids[0]!, ["DUKE", "CONTESSA"]);
    s = challenge(step(s, { type: "DECLARE_TAX" }), ids[1]!);
    expect(() => response(s, "PROVE_CLAIM", ids[0]!, { cardIndex: 1 })).toThrow();
    const c = { type: "PROVE_CLAIM", windowId: s.window!.id, cardIndex: 0 };
    expect(() =>
      engine.execute(s, c, ids[0]!, { ...deps, random: { nextInt: () => -1 } }),
    ).toThrow();
    const e = engine.execute(s, c, ids[0]!, deps)[0]!;
    expect(() => engine.applyEvent(s, { ...e, replacement: { card: "DUKE", deck: [] } })).toThrow();
    const extra = { ...e, seed: 1 };
    expect(() => engine.applyEvent(s, extra)).toThrow();
  });
  it("views are independent of other hands/deck and omit private continuation", () => {
    const s = step(initial(), { type: "DECLARE_TAX" });
    const altered = {
      ...s,
      deck: [...s.deck].reverse(),
      players: s.players.map((p, i) =>
        i ? { ...p, influence: ["CONTESSA", "ASSASSIN"] as CoupRole[] } : p,
      ),
    };
    expect(engine.getPlayerView(s, ids[0]!)).toEqual(engine.getPlayerView(altered, ids[0]!));
    expect(engine.getSpectatorView!(s)).toEqual(engine.getSpectatorView!(altered));
    for (const id of ids.slice(0, 3)) {
      const view = engine.getPlayerView(s, id);
      expect(view.myCards).toEqual(s.players.find((p) => p.id === id)!.influence);
      expect(Object.keys(view).sort()).toEqual(
        [
          "engineVersion",
          "stateSchemaVersion",
          "rulesetVersion",
          "revision",
          "phase",
          "turnNumber",
          "turnPlayerId",
          "winnerId",
          "pendingAction",
          "window",
          "proof",
          "loss",
          "players",
          "myCards",
        ].sort(),
      );
      expect(Object.keys(view.players[0]!).sort()).toEqual(
        ["id", "seat", "coins", "cardsRemaining", "revealed"].sort(),
      );
    }
    expect(() => engine.getPlayerView(s, ids[5]!)).toThrow();
  });
  it("model sweep preserves cards, nonnegative coins, immutable inputs, and replays to a unique winner", () => {
    for (let n = 2; n <= 6; n++)
      for (let run = 0; run < 12; run++) {
        const start = initial(n);
        let s = start;
        const events: Event[] = [];
        const inventory = cards(s);
        for (let turn = 0; turn < 1200 && s.phase !== "GAME_OVER"; turn++) {
          let actor = s.turnPlayerId;
          let c: Command;
          if (s.phase === "WAITING_FOR_ACTION") {
            const p = s.players.find((p) => p.id === actor)!;
            const target = s.players.find((p) => p.id !== actor && p.influence.length)!.id;
            c =
              p.coins >= 7
                ? { type: "DECLARE_COUP", targetId: target }
                : (turn + run) % 4 === 0 && p.coins >= 3
                  ? { type: "DECLARE_ASSASSINATION", targetId: target }
                  : (turn + run) % 4 === 1
                    ? { type: "DECLARE_STEAL", targetId: target }
                    : (turn + run) % 4 === 2
                      ? { type: "DECLARE_TAX" }
                      : { type: "DECLARE_FOREIGN_AID" };
          } else {
            actor = s.window!.eligibleIds.find((id) => !s.window!.passedIds.includes(id))!;
            const windowId = s.window!.id;
            if (s.phase === "LOSS") c = { type: "SELECT_CARD_TO_LOSE", windowId, cardIndex: 0 };
            else if (s.phase === "PROOF") {
              const index = s.players
                .find((p) => p.id === actor)!
                .influence.indexOf(s.proof!.claim.role);
              c =
                index < 0
                  ? { type: "CONCEDE_CLAIM", windowId }
                  : { type: "PROVE_CLAIM", windowId, cardIndex: index };
            } else if (s.phase === "CHALLENGE")
              c = { type: (turn + run) % 3 === 0 ? "CHALLENGE" : "PASS_CHALLENGE", windowId };
            else
              c =
                (turn + run) % 4 === 0
                  ? {
                      type: "BLOCK",
                      windowId,
                      role:
                        s.pendingAction!.kind === "FOREIGN_AID"
                          ? "DUKE"
                          : s.pendingAction!.kind === "STEAL"
                            ? "AMBASSADOR"
                            : "CONTESSA",
                    }
                  : { type: "PASS_BLOCK", windowId };
          }
          const before = JSON.stringify(s);
          const next = engine.execute(s, c, actor, deps);
          const updated = next.reduce(engine.applyEvent, s);
          expect(JSON.stringify(s)).toBe(before);
          s = updated;
          events.push(...next);
          expect(cards(s)).toEqual(inventory);
          expect(s.players.every((p) => p.coins >= 0)).toBe(true);
          expect(new Set(s.eliminationOrder).size).toBe(s.eliminationOrder.length);
        }
        expect(s.phase).toBe("GAME_OVER");
        expect(events.reduce(engine.applyEvent, start)).toEqual(s);
        expect(engine.getResult(s)!.placements).toHaveLength(n);
        expect(Object.isFrozen(s.players[0]!.influence)).toBe(true);
      }
    expect(coupClaimsDescriptor.stateSchemaVersion).toBe(3);
  });
});

describe("resolution edge cases", () => {
  it.each([0, 1])("steal takes only the target's %i available coins", (amount) => {
    const base = initial();
    let s: State = {
      ...base,
      players: base.players.map((p, i) => (i === 1 ? { ...p, coins: amount } : p)),
    };
    s = passes(step(s, { type: "DECLARE_STEAL", targetId: ids[1] }));
    expect(s.players[0]!.coins).toBe(5 + amount);
    expect(s.players[1]!.coins).toBe(0);
  });
  it("skips assassination and block choices when its target loses their last card challenging", () => {
    let s = hand(initial(2), ids[0]!, ["ASSASSIN", "DUKE"]);
    s = {
      ...s,
      players: s.players.map((p, i) =>
        i === 1 ? { ...p, influence: p.influence.slice(1), revealed: p.influence.slice(0, 1) } : p,
      ),
    };
    s = challenge(step(s, { type: "DECLARE_ASSASSINATION", targetId: ids[1] }), ids[1]!);
    s = response(s, "PROVE_CLAIM", ids[0]!, { cardIndex: 0 });
    s = lose(s);
    expect(s.phase).toBe("GAME_OVER");
    expect(s.winnerId).toBe(ids[0]);
    expect(s.players[0]!.coins).toBe(2);
    expect(() => step(s, { type: "DECLARE_INCOME" })).toThrow();
  });
  it("foreign aid allows a third-party block; actor can challenge after passing another claim", () => {
    let s = step(initial(), { type: "DECLARE_FOREIGN_AID" });
    s = response(s, "PASS_BLOCK", ids[1]!);
    s = response(s, "BLOCK", ids[2]!, { role: "DUKE" });
    expect(s.window!.eligibleIds).toEqual([ids[0], ids[1]]);
    expect(() => challenge(s, ids[2]!)).toThrow();
    s = challenge(s, ids[0]!);
    s = response(s, "CONCEDE_CLAIM", ids[2]!);
    expect(() => response(s, "SELECT_CARD_TO_LOSE", ids[2]!, { cardIndex: 2 })).toThrow();
    s = lose(s);
    expect(s.players[0]!.coins).toBe(7);
  });
  it("projects proof/loss decisions without revealing replacement or continuation", () => {
    let s = hand(initial(), ids[0]!, ["DUKE", "ASSASSIN"]);
    s = challenge(step(s, { type: "DECLARE_TAX" }), ids[1]!);
    const proof = engine.getSpectatorView!(s);
    expect(proof.proof).toEqual({
      claim: { kind: "ACTION", claimantId: ids[0], role: "DUKE" },
      challengerId: ids[1],
    });
    s = response(s, "PROVE_CLAIM", ids[0]!, { cardIndex: 0 });
    const view = engine.getSpectatorView!(s);
    expect(view.loss).toEqual({ playerId: ids[1], reason: "CHALLENGE" });
    expect(view).not.toHaveProperty("deck");
    expect(view).not.toHaveProperty("replacement");
    expect(view).not.toHaveProperty("myCards");
    expect(view.loss).not.toHaveProperty("resume");
  });
});
