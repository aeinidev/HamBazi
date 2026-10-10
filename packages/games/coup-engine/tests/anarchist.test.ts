import { describe, expect, it } from "vitest";
import {
  coupAnarchistModule as module,
  coupAnarchistStateSchema,
  coupAnarchistRulesSchema,
  coupAnarchistPlayerViewSchema,
  migrateCoupAnarchistState,
  type CoupAnarchistState as State,
  type CoupAnarchistCommand as Command,
  type CoupRole,
} from "../src/index.js";
const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
const rules = coupAnarchistRulesSchema.parse({
  rulesetVersion: "coup-anarchist-v1",
  anarchistCost: 5,
  copiesPerRole: 3,
  cardsPerPlayer: 2,
  startingCoins: 2,
  incomeCoins: 1,
  foreignAidCoins: 2,
  taxCoins: 3,
  stealCoins: 2,
  assassinationCost: 3,
  coupCost: 7,
  mandatoryCoupAt: 10,
  actionTimeoutMs: 30000,
  responseTimeoutMs: 15000,
  decisionTimeoutMs: 20000,
});
const random = { nextInt: (n: number) => n - 1 };
function initial(coins = 5, count = 2): State {
  const s = module.engine.createInitialState(
    { playerIds: ids.slice(0, count) },
    { clock: { now: () => 1000 }, random, rules },
  );
  return migrateCoupAnarchistState(
    { ...s, players: s.players.map((p, i) => (i ? p : { ...p, coins })) },
    5,
  );
}
function hand(s: State, id: string, roles: CoupRole[]): State {
  const copy = structuredClone(s) as unknown as {
    players: { id: string; influence: CoupRole[] }[];
    deck: CoupRole[];
  };
  const p = copy.players.find((p) => p.id === id)!;
  for (const [i, role] of roles.entries()) {
    if (p.influence[i] === role) continue;
    const deckIndex = copy.deck.indexOf(role);
    if (deckIndex >= 0) {
      [p.influence[i], copy.deck[deckIndex]] = [copy.deck[deckIndex]!, p.influence[i]!];
      continue;
    }
    const other = copy.players.find((o) => o.id !== id && o.influence.includes(role))!;
    const j = other.influence.indexOf(role);
    [p.influence[i], other.influence[j]] = [other.influence[j]!, p.influence[i]!];
  }
  return migrateCoupAnarchistState(copy, 5);
}
const attack: Command = { type: "DECLARE_ANARCHIST", targetId: ids[1]! };
function execute(s: State, c: Command = attack, actor = ids[0]!, at = s.lastCommandAt + 1) {
  const events = module.engine.execute(s, c, actor, {
    clock: { now: () => at },
    random,
    rules: s.rules,
  });
  const next = events.reduce(module.engine.applyEvent, s);
  expect(coupAnarchistStateSchema.safeParse(next).success).toBe(true);
  expect(migrateCoupAnarchistState(next, 5)).toEqual(next);
  return { next, events };
}
describe("versioned shared Anarchist", () => {
  it.each([4, 5, 7, 10])("gates %i coins and unchanged mandatory Coup", (coins) => {
    const s = initial(coins),
      view = module.engine.getPlayerView(s, ids[0]!);
    expect(view.legalCommands.some((c) => c.type === "DECLARE_ANARCHIST")).toBe(
      coins >= 5 && coins < 10,
    );
    expect(view.legalCommands.some((c) => c.type === "DECLARE_COUP")).toBe(coins >= 7);
    if (coins < 5 || coins >= 10) expect(() => execute(s)).toThrow();
  });
  it("charges once, skips claims, preserves influence inventory and replays identical loss", () => {
    const s = hand(initial(), ids[1]!, ["DUKE", "CAPTAIN"]),
      { next, events } = execute(s);
    expect(next.players[0]!.coins).toBe(0);
    expect(next.phase).toBe("LOSS");
    expect(next.loss).toEqual({ playerId: ids[1], reason: "ANARCHIST", resume: "END" });
    expect(next.window?.claim).toBeNull();
    expect(next.deck).toEqual(s.deck);
    expect(() => module.engine.applyEvent(next, events[0]!)).toThrow();
    expect(() => execute(next)).toThrow();
    const resolved = execute(
      next,
      { type: "SELECT_CARD_TO_LOSE", windowId: next.window!.id, cardIndex: 1 },
      ids[1]!,
    ).next;
    expect(resolved.players[1]!.revealed).toEqual(["CAPTAIN"]);
    expect(resolved.turnPlayerId).toBe(ids[1]);
    expect(resolved.players[0]!.coins).toBe(0);
  });
  it("automatically defends with an actual live Contessa, pays without refund, replaces once", () => {
    const s = hand(initial(7), ids[1]!, ["CONTESSA", "CAPTAIN"]),
      { next, events } = execute(s);
    expect(next.phase).toBe("WAITING_FOR_ACTION");
    expect(next.players[0]!.coins).toBe(2);
    expect(next.turnPlayerId).toBe(ids[1]);
    expect(next.players[1]!.influence).toHaveLength(2);
    expect(next.players[1]!.revealed).toHaveLength(0);
    expect(next.lastAction?.outcome).toBe("DEFENDED");
    expect(events[0]!.replacement).toBeDefined();
    expect(next).toEqual(module.engine.applyEvent(s, events[0]!));
    expect(() => module.engine.applyEvent(next, events[0]!)).toThrow();
    const invalid = { ...events[0]!, replacement: { card: "ANARCHIST", deck: [...s.deck] } };
    expect(() => module.engine.applyEvent(s, invalid as never)).toThrow();
  });
  it("lost Contessa cannot defend; influence choice ends the game and restores result", () => {
    let s = hand(initial(7), ids[1]!, ["CONTESSA", "CAPTAIN"]);
    s = execute(s, { type: "DECLARE_COUP", targetId: ids[1]! }).next;
    s = execute(
      s,
      { type: "SELECT_CARD_TO_LOSE", windowId: s.window!.id, cardIndex: 0 },
      ids[1]!,
    ).next;
    s = execute(s, { type: "DECLARE_INCOME" }, ids[1]!).next;
    s = migrateCoupAnarchistState(
      { ...s, players: s.players.map((p, i) => (i ? p : { ...p, coins: 5 })) },
      5,
    );
    s = execute(s).next;
    expect(s.phase).toBe("LOSS");
    expect(s.lastAction?.outcome).toBe("DECLARED");
    s = execute(
      s,
      { type: "SELECT_CARD_TO_LOSE", windowId: s.window!.id, cardIndex: 0 },
      ids[1]!,
    ).next;
    expect(s.phase).toBe("GAME_OVER");
    expect(module.engine.getResult(s)?.winnerId).toBe(ids[0]);
    expect(s.players[1]!.coins).toBe(0);
  });
  it("rejects other turns, self, unknown/dead target, phase, stale revisions and forged refunds", () => {
    const s = hand(initial(), ids[1]!, ["DUKE", "CAPTAIN"]);
    expect(() => execute(s, attack, ids[1]!)).toThrow();
    expect(() => execute(s, { ...attack, targetId: ids[0]! })).toThrow();
    expect(() => execute(s, { ...attack, targetId: ids[5]! })).toThrow();
    expect(() => execute(s, attack, ids[0]!, s.deadlineAt!)).toThrow();
    const { next, events } = execute(s);
    expect(() =>
      execute(next, { type: "BLOCK", windowId: next.window!.id, role: "CONTESSA" }, ids[1]!),
    ).toThrow();
    expect(() => module.engine.applyEvent(s, { ...events[0]!, expectedRevision: 9 })).toThrow();
    expect(() =>
      module.engine.applyEvent(s, {
        ...events[0]!,
        replacement: { card: "DUKE", deck: [...s.deck] },
      }),
    ).toThrow();
  });
  it("uses existing guarded loss timeout and preserves deadline over reload", () => {
    const s = execute(hand(initial(), ids[1]!, ["DUKE", "CAPTAIN"])).next;
    const guard = module.timerPolicy.getDeadline(s)!;
    expect(module.timerPolicy.getDeadline(migrateCoupAnarchistState(s, 5))).toEqual(guard);
    expect(
      module.timerPolicy.executeTimeout(s, guard, {
        clock: { now: () => s.deadlineAt! - 1 },
        random,
      }),
    ).toEqual([]);
    const e = module.timerPolicy.executeTimeout(s, guard, {
      clock: { now: () => s.deadlineAt! },
      random,
    });
    const next = e.reduce(module.engine.applyEvent, s);
    expect(next.players[1]!.revealed).toEqual(["DUKE"]);
    expect(
      module.timerPolicy.executeTimeout(next, guard, {
        clock: { now: () => s.deadlineAt! },
        random,
      }),
    ).toEqual([]);
  });
  it("public and attacker projections do not reveal defense before resolution or replacement after", () => {
    const a = hand(initial(), ids[1]!, ["DUKE", "CAPTAIN"]),
      b = hand(a, ids[1]!, ["CONTESSA", "CAPTAIN"]);
    expect(module.engine.getSpectatorView!(a)).toEqual(module.engine.getSpectatorView!(b));
    expect(module.engine.getPlayerView(a, ids[0]!)).toEqual(
      module.engine.getPlayerView(b, ids[0]!),
    );
    const next = execute(b).next,
      spectator = module.engine.getSpectatorView!(next);
    expect(Object.keys(spectator)).not.toContain("deck");
    expect(Object.keys(spectator.players[1]!)).toEqual([
      "id",
      "seat",
      "coins",
      "cardsRemaining",
      "revealed",
    ]);
    expect(spectator.players[1]!.revealed).toEqual([]);
    expect(spectator.lastAction?.outcome).toBe("DEFENDED");
    expect(
      coupAnarchistPlayerViewSchema.safeParse({
        ...module.engine.getPlayerView(next, ids[0]!),
        deck: next.deck,
      }).success,
    ).toBe(false);
    expect(() => module.botPolicy.chooseCommand(next)).toThrow();
  });
  it("uses Anarchist only from legal own-view commands and saves for Coup through repeated defenses", () => {
    let s = hand(hand(initial(3), ids[0]!, ["CONTESSA", "CAPTAIN"]), ids[1]!, [
      "CONTESSA",
      "AMBASSADOR",
    ]);
    for (let i = 0; i < 4; i++) s = execute(s, { type: "DECLARE_INCOME" }, s.turnPlayerId).next;
    expect(module.botPolicy.chooseCommand(module.engine.getPlayerView(s, ids[0]!))).toEqual(attack);
    s = execute(s).next;
    expect(s.lastAction?.outcome).toBe("DEFENDED");
    for (let step = 0; step < 500 && s.phase !== "GAME_OVER"; step++) {
      const choice = s.players
        .map((p) => ({
          id: p.id,
          command: module.botPolicy.chooseCommand(module.engine.getPlayerView(s, p.id)),
        }))
        .find((p) => p.command);
      expect(choice).toBeDefined();
      s = execute(s, choice!.command!, choice!.id).next;
    }
    expect(s.phase).toBe("GAME_OVER");
  });
  it("completes deterministic bot games for 2–6 seats without dealing the shared action", () => {
    for (let count = 2; count <= 6; count++) {
      let s = initial(2, count);
      const history: ReturnType<typeof module.engine.execute>[number][] = [];
      const start = s;
      for (let step = 0; step < 800 && s.phase !== "GAME_OVER"; step++) {
        let moved = false;
        for (const p of s.players) {
          const view = module.engine.getPlayerView(s, p.id),
            c = module.botPolicy.chooseCommand(view);
          if (!c) continue;
          const result = execute(s, c, p.id);
          s = result.next;
          history.push(...result.events);
          moved = true;
          break;
        }
        expect(moved).toBe(true);
      }
      expect(s.phase).toBe("GAME_OVER");
      expect(history.reduce(module.engine.applyEvent, start)).toEqual(s);
      expect(
        [...s.deck, ...s.players.flatMap((p) => [...p.influence, ...p.revealed])].every(
          (c) => c !== ("ANARCHIST" as CoupRole),
        ),
      ).toBe(true);
    }
  });
});
