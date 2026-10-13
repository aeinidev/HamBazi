import { describe, expect, it } from "vitest";
import {
  kahrobaEngine as engine,
  kahrobaCards,
  TOKEN_COLORS,
  GEM_COLORS,
  KahrobaError,
  zeroTokens,
  totalTokens,
} from "../src/index.js";
import {
  initial,
  scenario,
  validated,
  step,
  holdings,
  own,
  expose,
  giveBonuses,
  card,
  noble,
  pay,
  selectNobles,
  clone,
  ids,
  rules,
} from "./helpers.js";

describe("setup and pure complete turns", () => {
  it.each([2, 3, 4])(
    "sets up %i seats with the exact supply and persistent random starter",
    (n) => {
      const s = initial(n),
        supply = n === 2 ? 4 : n === 3 ? 5 : 7;
      expect(s.players).toHaveLength(n);
      expect(s.decks.map((d) => d.length)).toEqual([36, 26, 16]);
      expect(s.market.map((r) => r.length)).toEqual([4, 4, 4]);
      expect(s.nobles).toHaveLength(n + 1);
      expect(s.bank).toEqual(
        pay({
          diamond: supply,
          sapphire: supply,
          emerald: supply,
          ruby: supply,
          onyx: supply,
          gold: 5,
        }),
      );
      expect(s.turnPlayerIndex).toBe(s.firstPlayerIndex);
      expect(s).toEqual(initial(n));
      expect(Object.isFrozen(s.players[0]!.tokens)).toBe(true);
      expect(
        new Set(Array.from({ length: 20 }, (_, seed) => initial(n, seed).firstPlayerIndex)).size,
      ).toBe(n);
    },
  );
  it("rejects invalid identities, random indices, clocks and missing policy pairs", () => {
    const deps = { clock: { now: () => 1000 }, random: { nextInt: (n: number) => n - 1 }, rules };
    for (const input of [
      { playerIds: [ids[0], ids[0]] },
      { playerIds: ids.slice(0, 1) },
      { playerIds: [...ids, ids[0]] },
      { playerIds: ids, seed: 5 },
    ])
      expect(() => engine.createInitialState(input as never, deps)).toThrow(KahrobaError);
    for (const value of [-1, 4, 0.5, NaN])
      expect(() =>
        engine.createInitialState(
          { playerIds: ids },
          { ...deps, random: { nextInt: () => value } },
        ),
      ).toThrow(KahrobaError);
    expect(() =>
      engine.createInitialState({ playerIds: ids }, { ...deps, clock: { now: () => -1 } }),
    ).toThrow(KahrobaError);
    expect(() =>
      engine.createInitialState(
        { playerIds: ids },
        { ...deps, rules: { ...rules, turnDurationMs: 1000 } },
      ),
    ).toThrow(KahrobaError);
  });
  it("takes three different colors or two of a sufficiently large stack", () => {
    const s = initial(),
      command = {
        type: "TAKE_TOKENS",
        selection: { mode: "DISTINCT", colors: ["diamond", "ruby", "onyx"] },
      };
    const next = step(s, command);
    expect(next.events).toHaveLength(1);
    expect(totalTokens(next.state.players[s.turnPlayerIndex]!.tokens)).toBe(3);
    expect(s.players[s.turnPlayerIndex]!.tokens).toEqual(zeroTokens());
    expect(next.state.revision).toBe(1);
    const double = step(s, {
      type: "TAKE_TOKENS",
      selection: { mode: "DOUBLE", color: "diamond" },
    }).state;
    expect(double.bank.diamond).toBe(5);
    expect(double.players[s.turnPlayerIndex]!.tokens.diamond).toBe(2);
  });
  it("rejects partial collection without shortage, repeated colors, gold and mixed selections", () => {
    const s = initial();
    for (const colors of [
      ["diamond"],
      ["diamond", "ruby"],
      ["diamond", "diamond", "ruby"],
      ["gold", "ruby", "onyx"],
    ])
      expect(() =>
        step(s, { type: "TAKE_TOKENS", selection: { mode: "DISTINCT", colors } }),
      ).toThrow(KahrobaError);
    expect(() =>
      step(s, {
        type: "TAKE_TOKENS",
        selection: { mode: "DOUBLE", color: "ruby", colors: ["onyx"] },
      }),
    ).toThrow(KahrobaError);
  });
  it.each([1, 2])("collects exactly %i remaining colors under shortage", (remaining) => {
    const s = scenario(2);
    // Move depleted stacks to the other seat, staying within each holding limit.
    const other = (s.turnPlayerIndex + 1) % 2;
    if (remaining === 2) holdings(s, other, { emerald: 4, ruby: 4 });
    else {
      holdings(s, other, { emerald: 4, ruby: 4 });
      holdings(s, s.turnPlayerIndex, { onyx: 4 });
    }
    // Diamond/sapphire remain for the two-color case; onyx is also emptied there.
    if (remaining === 2) holdings(s, s.turnPlayerIndex, { onyx: 4 });
    else {
      holdings(s, s.turnPlayerIndex, { onyx: 4, sapphire: 4 });
    }
    const colors = GEM_COLORS.filter((c) => s.bank[c] > 0);
    expect(colors).toHaveLength(remaining);
    const next = step(validated(s), {
      type: "TAKE_TOKENS",
      selection: { mode: "DISTINCT", colors },
    }).state;
    expect(next.players[s.turnPlayerIndex]!.tokens.diamond).toBe(1);
    if (remaining === 2)
      expect(() =>
        step(validated(s), {
          type: "TAKE_TOKENS",
          selection: { mode: "DISTINCT", colors: ["diamond"] },
        }),
      ).toThrow(KahrobaError);
  });
  it("checks the double threshold before collection and before token returns", () => {
    const s = scenario();
    holdings(s, s.turnPlayerIndex, { diamond: 4 });
    expect(s.bank.diamond).toBe(3);
    expect(() =>
      step(validated(s), { type: "TAKE_TOKENS", selection: { mode: "DOUBLE", color: "diamond" } }),
    ).toThrow(KahrobaError);
    holdings(s, s.turnPlayerIndex, { diamond: 3 });
    expect(
      step(validated(s), { type: "TAKE_TOKENS", selection: { mode: "DOUBLE", color: "diamond" } })
        .state.bank.diamond,
    ).toBe(2);
  });
  it("returns exactly the excess, including newly drawn tokens, with no partial mutation", () => {
    const s = scenario();
    holdings(s, s.turnPlayerIndex, { diamond: 5, sapphire: 5 });
    const command = {
      type: "TAKE_TOKENS",
      selection: { mode: "DISTINCT", colors: ["emerald", "ruby", "onyx"] },
    };
    const before = JSON.stringify(s);
    for (const returnTokens of [
      undefined,
      pay({ emerald: 2, ruby: 1 }),
      pay({ diamond: 4 }),
      pay({ emerald: -1 }),
    ])
      expect(() =>
        step(validated(s), { ...command, ...(returnTokens ? { returnTokens } : {}) }),
      ).toThrow(KahrobaError);
    expect(JSON.stringify(s)).toBe(before);
    const next = step(validated(s), {
      ...command,
      returnTokens: pay({ emerald: 1, ruby: 1, onyx: 1 }),
    }).state;
    expect(next.players[s.turnPlayerIndex]!.tokens).toEqual(s.players[s.turnPlayerIndex]!.tokens);
    expect(next.revision).toBe(s.revision + 1);
    expect(() => step(initial(), { ...command, returnTokens: pay({ emerald: 1 }) })).toThrow(
      KahrobaError,
    );
  });
});

describe("purchases and reservations", () => {
  it("supports colored and optional wildcard payment without forcing colored-token use", () => {
    const s = scenario(),
      actor = s.turnPlayerIndex;
    expose(s, card(0));
    holdings(s, actor, { ruby: 2, onyx: 1, gold: 1 });
    const next = step(validated(s), {
      type: "BUY_CARD",
      source: "MARKET",
      cardId: card(0),
      payment: pay({ ruby: 1, onyx: 1, gold: 1 }),
    }).state;
    expect(next.players[actor]!.tokens.ruby).toBe(1);
    expect(next.players[actor]!.purchased).toContain(card(0));
    expect(next.market[0]).not.toContain(card(0));
    expect(next.decks[0]).toHaveLength(s.decks[0].length - 1);
    expect(next.bank.gold).toBe(s.bank.gold + 1);
  });
  it("rejects underpayment, overpayment, unrelated colors, unavailable cards and forged costs", () => {
    const s = scenario();
    expose(s, card(0));
    holdings(s, s.turnPlayerIndex, { ruby: 2, onyx: 1, sapphire: 1, gold: 1 });
    const base = { type: "BUY_CARD", source: "MARKET", cardId: card(0) };
    for (const payment of [
      pay({ ruby: 1, onyx: 1 }),
      pay({ ruby: 2, onyx: 1, gold: 1 }),
      pay({ ruby: 2, sapphire: 1 }),
      pay({ ruby: -1 }),
    ])
      expect(() => step(validated(s), { ...base, payment })).toThrow(KahrobaError);
    expect(() => step(validated(s), { ...base, cardId: card(99), payment: zeroTokens() })).toThrow(
      KahrobaError,
    );
    expect(() =>
      step(validated(s), { ...base, payment: pay({ ruby: 2, onyx: 1 }), cost: 0 }),
    ).toThrow(KahrobaError);
  });
  it("applies permanent bonuses, allows free purchases and never grants excess-discount tokens", () => {
    const s = scenario(),
      actor = s.turnPlayerIndex;
    giveBonuses(s, actor, { ruby: 3, onyx: 2 });
    expose(s, card(0));
    const next = step(validated(s), {
      type: "BUY_CARD",
      source: "MARKET",
      cardId: card(0),
      payment: zeroTokens(),
    }).state;
    expect(next.players[actor]!.tokens).toEqual(zeroTokens());
    expect(next.players[actor]!.purchased).toHaveLength(6);
    expect(next.bank).toEqual(s.bank);
  });
  it("reserves either a public card or a private top card and takes gold", () => {
    const s = initial(),
      actor = s.turnPlayerIndex,
      id = s.market[0][0]!;
    const face = step(s, { type: "RESERVE_CARD", source: { kind: "MARKET", cardId: id } }).state;
    expect(face.players[actor]!.reserved).toEqual([id]);
    expect(face.bank.gold).toBe(4);
    expect(face.market[0][0]).toBe(s.decks[0][0]);
    const blind = step(s, { type: "RESERVE_CARD", source: { kind: "DECK", tier: 3 } }).state;
    expect(blind.players[actor]!.reserved).toEqual([s.decks[2][0]]);
    expect(blind.market).toEqual(s.market);
    expect(() =>
      step(s, { type: "RESERVE_CARD", source: { kind: "DECK", tier: 3, cardId: s.decks[2][0] } }),
    ).toThrow(KahrobaError);
  });
  it("allows reserving an affordable card with no gold remaining, and enforces the three-card limit", () => {
    const s = scenario(),
      actor = s.turnPlayerIndex,
      other = (actor + 1) % 4;
    holdings(s, other, { gold: 5 });
    const next = step(validated(s), {
      type: "RESERVE_CARD",
      source: { kind: "DECK", tier: 1 },
    }).state;
    expect(next.players[actor]!.tokens.gold).toBe(0);
    own(s, actor, s.decks[2].slice(0, 3), true);
    expect(() =>
      step(validated(s), { type: "RESERVE_CARD", source: { kind: "DECK", tier: 1 } }),
    ).toThrow(KahrobaError);
  });
  it("resolves reservation gold and a ten-token return atomically", () => {
    const s = scenario(),
      actor = s.turnPlayerIndex;
    holdings(s, actor, { diamond: 5, sapphire: 5 });
    const command = { type: "RESERVE_CARD", source: { kind: "DECK", tier: 2 } };
    expect(() => step(validated(s), command)).toThrow(KahrobaError);
    const next = step(validated(s), { ...command, returnTokens: pay({ gold: 1 }) }).state;
    expect(next.bank.gold).toBe(s.bank.gold);
    expect(next.players[actor]!.reserved).toHaveLength(1);
    expect(totalTokens(next.players[actor]!.tokens)).toBe(10);
  });
  it("buys only an owned reservation and releases its slot without refilling the market", () => {
    const s = scenario(),
      actor = s.turnPlayerIndex;
    own(s, actor, [card(0)], true);
    holdings(s, actor, { ruby: 2, onyx: 1 });
    const next = step(validated(s), {
      type: "BUY_CARD",
      source: "RESERVED",
      cardId: card(0),
      payment: pay({ ruby: 2, onyx: 1 }),
    }).state;
    expect(next.players[actor]!.reserved).toHaveLength(0);
    expect(next.market).toEqual(s.market);
    expect(() =>
      step(validated(s), {
        type: "BUY_CARD",
        source: "RESERVED",
        cardId: s.players[(actor + 1) % 4]!.reserved[0] ?? card(1),
        payment: zeroTokens(),
      }),
    ).toThrow(KahrobaError);
  });
  it("leaves an exhausted tier slot empty and rejects drawing its empty deck", () => {
    const s = scenario(),
      actor = s.turnPlayerIndex;
    const remaining = [...s.decks[0]];
    for (const [i, id] of remaining.entries()) own(s, i % 4, [id]);
    expect(s.decks[0]).toHaveLength(0);
    const v = validated(s),
      command = engine
        .getPlayerView(v, v.players[actor]!.id)
        .legalCommands.find((c) => c.type === "BUY_CARD" && s.market[0].includes(c.cardId));
    expect(command).toBeDefined();
    const next = step(v, command!).state;
    expect(next.market[0]).toContain(null);
    expect(() => step(v, { type: "RESERVE_CARD", source: { kind: "DECK", tier: 1 } })).toThrow(
      KahrobaError,
    );
  });
});

describe("nobles, authorization and replay guards", () => {
  it("requires choosing exactly one eligible noble and never spends bonuses", () => {
    const s = scenario(),
      actor = s.turnPlayerIndex;
    giveBonuses(s, actor, { diamond: 4, sapphire: 4, onyx: 4 });
    selectNobles(s, [noble(5), noble(6)]);
    const command = { type: "TAKE_TOKENS", selection: { mode: "DOUBLE", color: "ruby" } };
    expect(() => step(validated(s), command)).toThrow(KahrobaError);
    expect(() => step(validated(s), { ...command, nobleId: noble(9) })).toThrow(KahrobaError);
    const next = step(validated(s), { ...command, nobleId: noble(6) }).state;
    expect(next.players[actor]!.nobles).toEqual([noble(6)]);
    expect(next.nobles).toContain(noble(5));
    expect(next.players[actor]!.purchased).toEqual(s.players[actor]!.purchased);
  });
  it("automatically acquires one noble, including the just-purchased bonus", () => {
    const s = scenario(),
      actor = s.turnPlayerIndex;
    giveBonuses(s, actor, { diamond: 3, sapphire: 4 }, [card(0)]);
    selectNobles(s, [noble(6), noble(1), noble(3), noble(7), noble(8)]);
    expose(s, card(0));
    holdings(s, actor, { ruby: 2, onyx: 1 });
    const next = step(validated(s), {
      type: "BUY_CARD",
      source: "MARKET",
      cardId: card(0),
      payment: pay({ ruby: 2, onyx: 1 }),
    }).state;
    expect(next.players[actor]!.nobles).toEqual([noble(6)]);
  });
  it("rejects non-turn actors, unknown commands, outcome injection, repeat events and altered deadlines", () => {
    const s = initial(),
      command = engine.getPlayerView(s, s.players[s.turnPlayerIndex]!.id).legalCommands[0]!;
    expect(() => step(s, command, 1001, ids[(s.turnPlayerIndex + 1) % 4]!)).toThrow(KahrobaError);
    for (const input of [
      { type: "DISCARD_CARD", cardId: card(0) },
      { ...command, actorId: ids[0] },
      { ...command, prestige: 15 },
      { type: "PASS" },
    ])
      expect(() => step(s, input)).toThrow(KahrobaError);
    const next = step(s, command),
      event = next.events[0]!;
    expect(() => engine.applyEvent(next.state, event)).toThrow(KahrobaError);
    expect(() => engine.applyEvent(s, { ...event, deadlineAt: 1005 })).toThrow(KahrobaError);
    expect(() => engine.applyEvent(s, { ...event, occurredAt: 999 })).toThrow(KahrobaError);
    expect(engine.applyEvent(s, event)).toEqual(next.state);
    expect(() => step(s, command, 999)).toThrow(KahrobaError);
    const corrupted = clone(s);
    corrupted.bank.gold++;
    expect(() =>
      engine.execute(corrupted, command, s.players[s.turnPlayerIndex]!.id, {
        clock: { now: () => 1001 },
        random: { nextInt: () => 0 },
        rules,
      }),
    ).toThrow(KahrobaError);
    expect(TOKEN_COLORS.reduce((n, c) => n + s.bank[c], 0)).toBe(40);
    expect(kahrobaCards).toHaveLength(90);
  });
});
