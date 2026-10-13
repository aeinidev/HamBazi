import { describe, expect, it } from "vitest";
import {
  kahrobaEngine as engine,
  kahrobaModule,
  kahrobaManifest,
  kahrobaDescriptor,
  kahrobaBotPolicy,
  kahrobaFrontendAdapter,
  kahrobaTimerPolicy,
  executeKahrobaTimeout,
  getKahrobaReconnectView,
  KahrobaError,
  migrateKahrobaState,
  upcastKahrobaEvent,
  zeroTokens,
} from "../src/index.js";
import { gameManifestSchema, gameVersionDescriptorSchema } from "@hambazi/game-core";
import { initial, step, clone, validated, ids, rules } from "./helpers.js";

describe("safe projections and adapter boundaries", () => {
  it("publishes a disabled manifest and independently pinned descriptors", () => {
    expect(gameManifestSchema.parse(kahrobaManifest)).toMatchObject({
      status: "DISABLED",
      minPlayers: 2,
      maxPlayers: 4,
      matchmakingEnabled: false,
      privateRoomsEnabled: false,
    });
    expect(gameVersionDescriptorSchema.parse(kahrobaDescriptor)).toEqual(kahrobaDescriptor);
    expect(kahrobaModule.engine).toBe(engine);
    expect(kahrobaFrontendAdapter.assets).toHaveLength(0);
  });
  it("hides every opponent reservation and deck while revealing the owner's hand", () => {
    const setup = initial(),
      actor = setup.turnPlayerIndex;
    const s = step(setup, { type: "RESERVE_CARD", source: { kind: "DECK", tier: 3 } }).state;
    const owner = s.players[actor]!.id,
      viewer = s.players[s.turnPlayerIndex]!.id;
    const ownView = engine.getPlayerView(s, owner),
      otherView = engine.getPlayerView(s, viewer),
      spectator = engine.getSpectatorView(s);
    expect(ownView.myReserved.map((c) => c.id)).toEqual(s.players[actor]!.reserved);
    expect(otherView.myReserved).toHaveLength(0);
    for (const view of [ownView, otherView, spectator]) {
      expect(view.players[actor]!.reservedCount).toBe(1);
      expect(view).not.toHaveProperty("decks");
      expect(view).not.toHaveProperty("unusedNobles");
      expect(view.players[actor]).not.toHaveProperty("reserved");
      expect(Object.isFrozen(view.players[actor]!.tokens)).toBe(true);
    }
    expect(spectator).not.toHaveProperty("myReserved");
    expect(spectator).not.toHaveProperty("legalCommands");
    const changed = clone(s),
      hidden = changed.players[actor]!.reserved[0]!;
    changed.players[actor]!.reserved[0] = changed.decks[2][0]!;
    changed.decks[2][0] = hidden;
    [changed.decks[1][0], changed.decks[1][1]] = [changed.decks[1][1]!, changed.decks[1][0]!];
    expect(engine.getPlayerView(validated(changed), viewer)).toEqual(otherView);
    expect(engine.getSpectatorView(validated(changed))).toEqual(spectator);
    expect(
      kahrobaBotPolicy.chooseCommand(engine.getPlayerView(validated(changed), viewer)),
    ).toEqual(kahrobaBotPolicy.chooseCommand(otherView));
    expect(engine.getPlayerView(validated(changed), owner).myReserved).not.toEqual(
      ownView.myReserved,
    );
  });
  it("requires membership for projections and downgrades replaced humans without a private hand", () => {
    const s = step(initial(), { type: "RESERVE_CARD", source: { kind: "DECK", tier: 1 } }).state;
    const id = s.players[s.firstPlayerIndex]!.id;
    expect(getKahrobaReconnectView(s, id, "HUMAN").kind).toBe("PLAYER");
    expect(getKahrobaReconnectView(s, id, "REPLACED_BY_BOT")).toEqual(engine.getSpectatorView(s));
    expect(() =>
      getKahrobaReconnectView(s, "ffffffff-ffff-4fff-8fff-ffffffffffff", "REPLACED_BY_BOT"),
    ).toThrow(KahrobaError);
  });
  it("rejects internal states, unknown pins and hidden extra fields in presentations", () => {
    const s = initial(),
      view = engine.getPlayerView(s, s.players[s.turnPlayerIndex]!.id);
    expect(kahrobaFrontendAdapter.toPresentation(view)).toEqual(view);
    for (const bad of [
      s,
      { ...view, decks: s.decks },
      { ...view, viewSchemaVersion: 2 },
      { ...view, engineVersion: "coup-v1" },
      { ...view, rulesetVersion: "kahroba-new-v2" },
      { ...view, viewerId: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
      { ...view, players: view.players.map((p) => ({ ...p, id: view.players[0]!.id })) },
      { ...view, result: { schemaVersion: 1 } },
      { ...view, players: view.players.map((p) => ({ ...p, reserved: [] })) },
    ])
      expect(() => kahrobaFrontendAdapter.toPresentation(bad)).toThrow(KahrobaError);
    expect(kahrobaBotPolicy.chooseCommand(s as never)).toBeNull();
  });
});

describe("explicit timing policy without runtime defaults", () => {
  const config = { ...rules, turnDurationMs: 100, timeoutPolicyVersion: "fixture-timeout-v1" };
  it("has no timer when disabled and accepts no implicit automatic fallback", () => {
    const s = initial();
    expect(kahrobaTimerPolicy.getDeadline(s)).toBeNull();
    let called = false;
    expect(
      executeKahrobaTimeout(
        s,
        { expectedRevision: 0, deadlineAt: 1000 },
        {
          clock: { now: () => 5000 },
          policy: {
            policyVersion: "fixture-timeout-v1",
            chooseCommand() {
              called = true;
              return null;
            },
          },
        },
      ),
    ).toEqual([]);
    expect(called).toBe(false);
  });
  it("fences exact expiry, stale/early jobs, callback authority and duplicate replay", () => {
    const s = initial(3, 1, config),
      guard = kahrobaTimerPolicy.getDeadline(s)!;
    expect(guard).toEqual({ expectedRevision: 0, deadlineAt: 1100 });
    const command = engine.getPlayerView(s, s.players[s.turnPlayerIndex]!.id).legalCommands[0]!;
    expect(step(s, command, 1099).state.deadlineAt).toBe(1199);
    expect(() => step(s, command, 1100)).toThrow(KahrobaError);
    let calls = 0;
    const policy = {
      policyVersion: "fixture-timeout-v1",
      chooseCommand(view: ReturnType<typeof engine.getPlayerView>) {
        calls++;
        expect(view).not.toHaveProperty("decks");
        return view.legalCommands[0]!;
      },
    };
    expect(executeKahrobaTimeout(s, guard, { clock: { now: () => 1099 }, policy })).toEqual([]);
    expect(
      executeKahrobaTimeout(
        s,
        { ...guard, expectedRevision: 2 },
        { clock: { now: () => 1100 }, policy },
      ),
    ).toEqual([]);
    expect(calls).toBe(0);
    const events = executeKahrobaTimeout(s, guard, { clock: { now: () => 1200 }, policy }),
      next = events.reduce(engine.applyEvent, s);
    expect(calls).toBe(1);
    expect(next.deadlineAt).toBe(1300);
    expect(next.metrics.timeouts).toBe(1);
    expect(events[0]).toMatchObject({
      source: "TIMEOUT",
      timeoutPolicyVersion: "fixture-timeout-v1",
      occurredAt: 1200,
    });
    expect(executeKahrobaTimeout(next, guard, { clock: { now: () => 1200 }, policy })).toEqual([]);
    expect(() => engine.applyEvent(next, events[0]!)).toThrow(KahrobaError);
    expect(() =>
      executeKahrobaTimeout(s, guard, {
        clock: { now: () => 1100 },
        policy: { ...policy, policyVersion: "another-policy" },
      }),
    ).toThrow(KahrobaError);
    expect(() =>
      executeKahrobaTimeout(s, guard, {
        clock: { now: () => 1100 },
        policy: { ...policy, chooseCommand: () => ({ type: "PASS" }) },
      }),
    ).toThrow(KahrobaError);
    expect(
      executeKahrobaTimeout(s, guard, {
        clock: { now: () => 1100 },
        policy: { ...policy, chooseCommand: () => null },
      }),
    ).toEqual([]);
    expect(s.revision).toBe(0);
  });
  it("rejects source injection and rules changes instead of altering a pinned game", () => {
    const s = initial(2, 1, config),
      actor = s.players[s.turnPlayerIndex]!.id,
      command = engine.getPlayerView(s, actor).legalCommands[0]!;
    expect(() => step(s, { ...command, source: "TIMEOUT" }, 1100)).toThrow(KahrobaError);
    expect(() =>
      engine.execute(s, command, actor, {
        clock: { now: () => 1001 },
        random: { nextInt: () => 0 },
        rules: { ...config, turnDurationMs: 200 },
      }),
    ).toThrow(KahrobaError);
    const event = step(s, command, 1001).events[0]!;
    expect(() =>
      engine.applyEvent(s, {
        ...event,
        source: "TIMEOUT",
        timeoutPolicyVersion: config.timeoutPolicyVersion,
      }),
    ).toThrow(KahrobaError);
    expect(() =>
      engine.applyEvent(s, { ...event, timeoutPolicyVersion: config.timeoutPolicyVersion }),
    ).toThrow(KahrobaError);
  });
});

describe("restoration and compatibility", () => {
  it("restores a detached frozen state and validates only supported event/state versions", () => {
    const s = initial(),
      command = engine.getPlayerView(s, s.players[s.turnPlayerIndex]!.id).legalCommands[0]!,
      next = step(s, command);
    const wire = clone(next.state),
      restored = migrateKahrobaState(wire, 1);
    expect(restored).toEqual(next.state);
    wire.bank.gold = 0;
    expect(restored.bank.gold).toBe(5);
    expect(() => {
      Object.assign(restored.bank, { gold: 4 });
    }).toThrow(TypeError);
    expect(upcastKahrobaEvent(JSON.parse(JSON.stringify(next.events[0])), 1)).toEqual(
      next.events[0],
    );
    expect(() => migrateKahrobaState(next.state, 2)).toThrow(KahrobaError);
    expect(() => upcastKahrobaEvent(next.events[0], 2)).toThrow(KahrobaError);
    expect(() => upcastKahrobaEvent({ ...next.events[0], deck: [] }, 1)).toThrow(KahrobaError);
  });
  it("rejects corrupt inventories, ownership, turn counters, pins, timing, scoring and unknown fields", () => {
    const s = initial();
    const changes: Array<(v: ReturnType<typeof clone>) => void> = [
      (v) => {
        v.bank.diamond--;
      },
      (v) => {
        v.bank.gold++;
      },
      (v) => {
        v.players[0]!.id = ids[1]!;
      },
      (v) => {
        v.players[0]!.seat = 3;
      },
      (v) => {
        v.decks[0].pop();
      },
      (v) => {
        v.decks[0][0] = v.decks[0][1]!;
      },
      (v) => {
        [v.decks[0][0], v.decks[1][0]] = [v.decks[1][0]!, v.decks[0][0]!];
      },
      (v) => {
        v.market[0][0] = null;
      },
      (v) => {
        v.nobles[0] = v.nobles[1]!;
      },
      (v) => {
        v.firstPlayerIndex = 4;
      },
      (v) => {
        v.turnPlayerIndex = (v.turnPlayerIndex + 1) % 4;
      },
      (v) => {
        v.turnNumber++;
      },
      (v) => {
        v.players[0]!.turnsTaken++;
      },
      (v) => {
        v.lastCommandAt--;
      },
      (v) => {
        v.deadlineAt = 2000;
      },
      (v) => {
        v.metrics.passes = 1;
      },
      (v) => {
        v.metrics.timeouts = 1;
      },
      (v) => {
        v.phase = "GAME_OVER";
      },
      (v) => {
        v.finalRound = {
          triggerPlayerId: v.players[0]!.id,
          triggerTurnNumber: 1,
          endTurnNumber: 4,
        };
      },
      (v) => {
        v.players[0]!.tokens = { ...zeroTokens(), gold: 11 };
      },
    ];
    for (const change of changes) {
      const bad = clone(s);
      change(bad);
      expect(() => migrateKahrobaState(bad, 1)).toThrow(KahrobaError);
    }
    for (const extra of [
      { ...s, seed: 1 },
      { ...s, engineVersion: "kahroba-v2" },
      { ...s, rules: { ...s.rules, datasetVersion: "fabricated" } },
    ])
      expect(() => migrateKahrobaState(extra, 1)).toThrow(KahrobaError);
  });
});
