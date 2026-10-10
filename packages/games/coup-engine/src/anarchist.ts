import { z } from "zod";
import type { Clock, RandomSource, GameEngine } from "@hambazi/game-core";
import { coupManifest, type CoupRole } from "./model.js";
import {
  coupDescriptor,
  freeze,
  conflict,
  CoupModuleError,
  type CoupModuleState,
  type CoupRules,
} from "./module-model.js";
import {
  createCoupModuleState,
  executeCoupModuleCommand,
  executeCoupTimeout,
  applyCoupModuleEvent,
  getCoupModuleResult,
} from "./module-engine.js";
import { validateCoupModuleCommand } from "./module-validation.js";
import { migrateCoupState } from "./module-compatibility.js";
import {
  getCoupModulePlayerView,
  getCoupModuleSpectatorView,
  coupPlayerViewSchema,
  coupSpectatorViewSchema,
  coupBotPolicy,
} from "./module-views.js";
import {
  coupAnarchistDescriptor as descriptor,
  coupAnarchistRulesSchema,
  coupAnarchistStateSchema,
  coupAnarchistCommandSchema,
  coupAnarchistEventSchema,
  coupPublicActionSchema,
  type CoupAnarchistState as State,
  type CoupAnarchistRules as Rules,
  type CoupAnarchistCommand as Command,
  type CoupAnarchistEvent as Event,
} from "./anarchist-model.js";

function legacyRules(r: Rules): CoupRules {
  const { anarchistCost: _cost, ...rest } = r;
  return { ...rest, rulesetVersion: coupDescriptor.rulesetVersion };
}
/** Reuse unchanged v1 transitions; ANARCHIST may delegate only its ordinary LOSS choice. */
function legacy(s: State): CoupModuleState {
  const { lastAction: _action, lastDefense: _defense, ...rest } = s;
  return {
    ...rest,
    engineVersion: "coup-v1",
    stateSchemaVersion: 4,
    rulesetVersion: coupDescriptor.rulesetVersion,
    rules: legacyRules(s.rules),
    pendingAction: s.pendingAction
      ? {
          ...s.pendingAction,
          kind: s.pendingAction.kind === "ANARCHIST" ? "ASSASSINATION" : s.pendingAction.kind,
        }
      : null,
    loss: s.loss
      ? { ...s.loss, reason: s.loss.reason === "ANARCHIST" ? "ASSASSINATION" : s.loss.reason }
      : null,
  };
}
function current(
  s: CoupModuleState,
  rules: Rules,
  lastAction: State["lastAction"],
  lastDefense: State["lastDefense"] = null,
): State {
  return freeze({
    ...s,
    engineVersion: descriptor.engineVersion,
    stateSchemaVersion: 5,
    rulesetVersion: descriptor.rulesetVersion,
    rules,
    lastAction,
    lastDefense,
    pendingAction:
      s.pendingAction?.kind === "ASSASSINATION" && lastAction?.kind === "ANARCHIST"
        ? { ...s.pendingAction, kind: "ANARCHIST" }
        : s.pendingAction,
    loss:
      s.loss?.reason === "ASSASSINATION" && lastAction?.kind === "ANARCHIST"
        ? { ...s.loss, reason: "ANARCHIST" }
        : s.loss,
  });
}
function version(s: State) {
  if (
    s.engineVersion !== descriptor.engineVersion ||
    s.stateSchemaVersion !== 5 ||
    s.rulesetVersion !== descriptor.rulesetVersion ||
    s.rules.rulesetVersion !== descriptor.rulesetVersion
  )
    throw new CoupModuleError("INCOMPATIBLE_GAME_VERSION");
}
function player(s: State, id: string) {
  return s.players.find((p) => p.id === id) ?? conflict();
}
export function validateCoupAnarchistCommand(s: State, input: unknown, actorId: string): Command {
  version(s);
  const parsed = coupAnarchistCommandSchema.safeParse(input);
  if (!parsed.success) throw new CoupModuleError("INVALID_INPUT");
  const c = parsed.data;
  if (c.type !== "DECLARE_ANARCHIST") return validateCoupModuleCommand(legacy(s), c, actorId);
  const p = player(s, actorId);
  if (
    s.phase !== "WAITING_FOR_ACTION" ||
    s.turnPlayerId !== actorId ||
    !p.influence.length ||
    p.coins < s.rules.anarchistCost ||
    p.coins >= s.rules.mandatoryCoupAt ||
    c.targetId === actorId ||
    !player(s, c.targetId).influence.length
  )
    conflict();
  return c;
}
export function migrateCoupAnarchistState(input: unknown, fromVersion: number): State {
  if (fromVersion !== 5) throw new CoupModuleError("INCOMPATIBLE_GAME_VERSION");
  const parsed = coupAnarchistStateSchema.safeParse(input);
  if (!parsed.success) throw new CoupModuleError("INCOMPATIBLE_GAME_VERSION");
  const s = parsed.data;
  if (
    s.lastDefense &&
    (s.lastDefense.revision > s.revision ||
      s.lastDefense.occurredAt > s.lastCommandAt ||
      !s.players.some((p) => p.id === s.lastDefense!.targetId))
  )
    throw new CoupModuleError("INCOMPATIBLE_GAME_VERSION");
  migrateCoupState(legacy(s), 4);
  if (
    (s.pendingAction?.kind === "ANARCHIST") !== (s.loss?.reason === "ANARCHIST") ||
    (s.pendingAction?.kind === "ANARCHIST" &&
      (s.phase !== "LOSS" ||
        s.lastAction?.kind !== "ANARCHIST" ||
        s.lastAction.outcome !== "DECLARED")) ||
    (s.lastAction &&
      (s.lastAction.revision > s.revision ||
        s.lastAction.occurredAt > s.lastCommandAt ||
        !s.players.some((p) => p.id === s.lastAction!.actorId) ||
        (s.lastAction.targetId && !s.players.some((p) => p.id === s.lastAction!.targetId)) ||
        (s.lastAction.outcome === "DEFENDED" &&
          (s.lastAction.kind !== "ANARCHIST" || !s.lastAction.targetId))))
  )
    throw new CoupModuleError("INCOMPATIBLE_GAME_VERSION");
  return freeze(s);
}
function advance(s: State): State {
  const seat = player(s, s.turnPlayerId).seat;
  for (let offset = 1; offset <= s.players.length; offset++) {
    const p = s.players[(seat + offset) % s.players.length]!;
    if (p.influence.length)
      return {
        ...s,
        phase: "WAITING_FOR_ACTION",
        turnNumber: s.turnNumber + 1,
        turnPlayerId: p.id,
        pendingAction: null,
        window: null,
        proof: null,
        loss: null,
        exchange: null,
      };
  }
  return conflict();
}
function cardsEqual(a: readonly CoupRole[], b: readonly CoupRole[]) {
  return [...a].sort().join() === [...b].sort().join();
}
function reduceAnarchist(s: State, e: Event): State {
  if (
    e.command.type !== "DECLARE_ANARCHIST" ||
    e.source !== "PLAYER" ||
    e.returnedDeck !== undefined
  )
    conflict();
  const target = player(s, e.command.targetId),
    cardIndex = target.influence.indexOf("CONTESSA"),
    defended = cardIndex >= 0;
  if (defended !== (e.replacement !== undefined)) conflict();
  let next: State = {
    ...s,
    revision: s.revision + 1,
    actionCount: s.actionCount + 1,
    lastCommandAt: e.occurredAt,
    players: s.players.map((p) =>
      p.id === e.actorId ? { ...p, coins: p.coins - s.rules.anarchistCost } : p,
    ),
    lastAction: {
      revision: s.revision + 1,
      occurredAt: e.occurredAt,
      actorId: e.actorId,
      targetId: target.id,
      kind: "ANARCHIST",
      outcome: defended ? "DEFENDED" : "DECLARED",
    },
  };
  if (defended) {
    const replacement = e.replacement!;
    if (!cardsEqual([...s.deck, "CONTESSA"], [replacement.card, ...replacement.deck])) conflict();
    next = advance({
      ...next,
      lastDefense: { revision: next.revision, occurredAt: e.occurredAt, targetId: target.id },
      deck: replacement.deck,
      metrics: { ...next.metrics, blocks: next.metrics.blocks + 1 },
      players: next.players.map((p) =>
        p.id === target.id
          ? { ...p, influence: p.influence.map((c, i) => (i === cardIndex ? replacement.card : c)) }
          : p,
      ),
    });
  } else
    next = {
      ...next,
      phase: "LOSS",
      pendingAction: { actorId: e.actorId, kind: "ANARCHIST", targetId: target.id },
      window: { id: next.revision, eligibleIds: [target.id], passedIds: [], claim: null },
      proof: null,
      exchange: null,
      loss: { playerId: target.id, reason: "ANARCHIST", resume: "END" },
    };
  return {
    ...next,
    deadlineAt: e.occurredAt + (defended ? s.rules.actionTimeoutMs : s.rules.decisionTimeoutMs),
  };
}
export function applyCoupAnarchistEvent(s: State, input: unknown): State {
  version(s);
  const parsed = coupAnarchistEventSchema.safeParse(input);
  if (!parsed.success) throw new CoupModuleError("INVALID_INPUT");
  const e = parsed.data;
  if (e.command.type !== "DECLARE_ANARCHIST") {
    const before = legacy(s),
      next = applyCoupModuleEvent(before, { ...e, schemaVersion: 3 });
    const declared = !("windowId" in e.command);
    const lastAction: State["lastAction"] = declared
      ? {
          revision: next.revision,
          occurredAt: e.occurredAt,
          actorId: e.actorId,
          targetId: "targetId" in e.command ? e.command.targetId : null,
          kind: e.command.type.slice(8) as NonNullable<State["lastAction"]>["kind"],
          outcome: next.pendingAction ? "DECLARED" : "RESOLVED",
        }
      : s.lastAction && !next.pendingAction
        ? { ...s.lastAction, outcome: "RESOLVED" }
        : s.lastAction;
    return current(next, s.rules, lastAction, s.lastDefense);
  }
  validateCoupAnarchistCommand(s, e.command, e.actorId);
  if (
    e.expectedRevision !== s.revision ||
    e.occurredAt < s.lastCommandAt ||
    s.deadlineAt === null ||
    e.occurredAt >= s.deadlineAt
  )
    conflict();
  const next = reduceAnarchist(s, e);
  if (!Number.isSafeInteger(next.deadlineAt) || e.deadlineAt !== next.deadlineAt) conflict();
  return freeze(next);
}
export function executeCoupAnarchistCommand(
  s: State,
  input: unknown,
  actorId: string,
  deps: { clock: Clock; random: RandomSource },
): readonly Event[] {
  const command = validateCoupAnarchistCommand(s, input, actorId);
  if (command.type !== "DECLARE_ANARCHIST")
    return freeze(
      executeCoupModuleCommand(legacy(s), command, actorId, deps).map((e) => ({
        ...e,
        schemaVersion: 4 as const,
      })),
    );
  let replacement: Event["replacement"];
  if (player(s, command.targetId).influence.includes("CONTESSA")) {
    const cards: CoupRole[] = [...s.deck, "CONTESSA"];
    for (let i = cards.length - 1; i > 0; i--) {
      const j = deps.random.nextInt(i + 1);
      if (!Number.isSafeInteger(j) || j < 0 || j > i) conflict();
      [cards[i], cards[j]] = [cards[j]!, cards[i]!];
    }
    replacement = { card: cards[0]!, deck: cards.slice(1) };
  }
  const occurredAt = deps.clock.now();
  const e: Event = {
    type: "COMMAND_RESOLVED",
    schemaVersion: 4,
    expectedRevision: s.revision,
    actorId,
    command,
    source: "PLAYER",
    occurredAt,
    deadlineAt: occurredAt + (replacement ? s.rules.actionTimeoutMs : s.rules.decisionTimeoutMs),
    ...(replacement ? { replacement } : {}),
  };
  applyCoupAnarchistEvent(s, e);
  return freeze([e]);
}
const publicShape = {
  ...coupSpectatorViewSchema.shape,
  engineVersion: z.literal("coup-anarchist-v1"),
  stateSchemaVersion: z.literal(5),
  rulesetVersion: z.literal("coup-anarchist-v1"),
  viewSchemaVersion: z.literal(2),
  players: z
    .array(
      coupSpectatorViewSchema.shape.players.element.extend({
        displayName: z.string().min(1).max(256).nullable().default(null),
      }),
    )
    .min(2)
    .max(6),
  pendingAction: coupAnarchistStateSchema.shape.pendingAction,
  loss: z
    .strictObject({
      playerId: z.uuid(),
      reason: z.enum(["COUP", "ASSASSINATION", "CHALLENGE", "ANARCHIST"]),
    })
    .nullable(),
  lastAction: coupPublicActionSchema.nullable(),
  lastDefense: coupAnarchistStateSchema.shape.lastDefense,
  actionRules: z.strictObject({
    incomeCoins: coupAnarchistRulesSchema.shape.incomeCoins,
    foreignAidCoins: coupAnarchistRulesSchema.shape.foreignAidCoins,
    taxCoins: coupAnarchistRulesSchema.shape.taxCoins,
    stealCoins: coupAnarchistRulesSchema.shape.stealCoins,
    assassinationCost: coupAnarchistRulesSchema.shape.assassinationCost,
    coupCost: coupAnarchistRulesSchema.shape.coupCost,
    mandatoryCoupAt: coupAnarchistRulesSchema.shape.mandatoryCoupAt,
    anarchistCost: z.literal(5),
  }),
};
export const coupAnarchistSpectatorViewSchema = z.strictObject(publicShape);
export const coupAnarchistPlayerViewSchema = z.strictObject({
  ...publicShape,
  kind: z.literal("PLAYER"),
  viewerId: coupPlayerViewSchema.shape.viewerId,
  myCards: coupPlayerViewSchema.shape.myCards,
  exchangeChoices: coupPlayerViewSchema.shape.exchangeChoices,
  legalCommands: z.array(coupAnarchistCommandSchema).max(64),
});
export function getCoupAnarchistSpectatorView(s: State) {
  version(s);
  return freeze({
    ...getCoupModuleSpectatorView(legacy(s)),
    engineVersion: descriptor.engineVersion,
    stateSchemaVersion: 5 as const,
    rulesetVersion: descriptor.rulesetVersion,
    viewSchemaVersion: 2 as const,
    pendingAction: s.pendingAction,
    loss: s.loss ? { playerId: s.loss.playerId, reason: s.loss.reason } : null,
    lastAction: s.lastAction,
    lastDefense: s.lastDefense,
    actionRules: {
      incomeCoins: s.rules.incomeCoins,
      foreignAidCoins: s.rules.foreignAidCoins,
      taxCoins: s.rules.taxCoins,
      stealCoins: s.rules.stealCoins,
      assassinationCost: s.rules.assassinationCost,
      coupCost: s.rules.coupCost,
      mandatoryCoupAt: s.rules.mandatoryCoupAt,
      anarchistCost: s.rules.anarchistCost,
    },
  });
}
export function getCoupAnarchistPlayerView(s: State, viewerId: string) {
  const own = getCoupModulePlayerView(legacy(s), viewerId),
    legalCommands: Command[] = [...own.legalCommands];
  for (const target of s.players) {
    const c: Command = { type: "DECLARE_ANARCHIST", targetId: target.id };
    try {
      validateCoupAnarchistCommand(s, c, viewerId);
      legalCommands.push(c);
    } catch (e) {
      if (!(e instanceof CoupModuleError)) throw e;
    }
  }
  return freeze({
    ...getCoupAnarchistSpectatorView(s),
    kind: "PLAYER" as const,
    viewerId,
    myCards: own.myCards,
    exchangeChoices: own.exchangeChoices,
    legalCommands,
  });
}
type PlayerView = ReturnType<typeof getCoupAnarchistPlayerView>;
const botPolicy = Object.freeze({
  strategyVersion: "coup-anarchist-bot-v1",
  chooseCommand(input: unknown): Command | null {
    const parsed = coupAnarchistPlayerViewSchema.safeParse(input);
    if (!parsed.success) throw new CoupModuleError("INCOMPATIBLE_GAME_VERSION");
    const view = parsed.data;
    const own = view.players.find((p) => p.id === view.viewerId);
    // Occasionally try the shared attack, but still save toward unavoidable Coup.
    // Repeated automatic defenses cannot trap both bots in a five-coin spend loop.
    const attack =
      view.legalCommands.find((c) => c.type === "DECLARE_COUP") ??
      (own?.coins === 5 && view.turnNumber % 5 === 0
        ? view.legalCommands.find((c) => c.type === "DECLARE_ANARCHIST")
        : undefined);
    if (attack) return freeze(attack);
    const { lastAction: _last, lastDefense: _defense, actionRules: _rules, ...rest } = view;
    return coupBotPolicy.chooseCommand({
      ...rest,
      players: view.players.map(({ displayName: _name, ...player }) => player),
      engineVersion: "coup-v1",
      stateSchemaVersion: 4,
      rulesetVersion: coupDescriptor.rulesetVersion,
      viewSchemaVersion: 1,
      pendingAction: view.pendingAction
        ? {
            ...view.pendingAction,
            kind:
              view.pendingAction.kind === "ANARCHIST" ? "ASSASSINATION" : view.pendingAction.kind,
          }
        : null,
      loss: view.loss
        ? {
            ...view.loss,
            reason: view.loss.reason === "ANARCHIST" ? "ASSASSINATION" : view.loss.reason,
          }
        : null,
      legalCommands: view.legalCommands.filter((c) => c.type !== "DECLARE_ANARCHIST"),
    });
  },
});
function timeout(
  s: State,
  guard: { expectedRevision: number; deadlineAt: number },
  deps: { clock: Clock; random: RandomSource },
): readonly Event[] {
  version(s);
  return freeze(
    executeCoupTimeout(legacy(s), guard, deps).map((e) => ({ ...e, schemaVersion: 4 as const })),
  );
}
const engine: GameEngine<
  State,
  unknown,
  unknown,
  Event,
  PlayerView,
  Rules,
  ReturnType<typeof getCoupAnarchistSpectatorView>
> = Object.freeze({
  descriptor,
  createInitialState(input: unknown, deps: { clock: Clock; random: RandomSource; rules: Rules }) {
    const parsed = coupAnarchistRulesSchema.safeParse(deps.rules);
    if (!parsed.success) throw new CoupModuleError("INVALID_INPUT");
    return current(
      createCoupModuleState(input, { ...deps, rules: legacyRules(parsed.data) }),
      parsed.data,
      null,
    );
  },
  validateCommand: validateCoupAnarchistCommand,
  execute: executeCoupAnarchistCommand,
  applyEvent: applyCoupAnarchistEvent,
  getPlayerView: getCoupAnarchistPlayerView,
  getSpectatorView: getCoupAnarchistSpectatorView,
  getResult(s: State) {
    version(s);
    return getCoupModuleResult(legacy(s));
  },
  migrateState: migrateCoupAnarchistState,
});
const views = z.discriminatedUnion("kind", [
  coupAnarchistPlayerViewSchema,
  coupAnarchistSpectatorViewSchema,
]);
export const coupAnarchistModule = Object.freeze({
  manifest: coupManifest,
  descriptor,
  engine,
  schemas: { command: coupAnarchistCommandSchema, event: coupAnarchistEventSchema },
  botPolicy,
  timerPolicy: {
    policyVersion: "coup-anarchist-timer-v1",
    getDeadline(s: State) {
      version(s);
      return s.deadlineAt === null
        ? null
        : freeze({ expectedRevision: s.revision, deadlineAt: s.deadlineAt });
    },
    executeTimeout: timeout,
  },
  reconnectPolicy: {
    policyVersion: "coup-reconnect-v1",
    pauseOnDisconnect: false,
    allowSeatReclaim: false,
    viewAfterTakeover: "SPECTATOR",
  },
  migrateState: migrateCoupAnarchistState,
  upcastEvent(input: unknown, fromVersion: number) {
    if (fromVersion !== 4) throw new CoupModuleError("INCOMPATIBLE_GAME_VERSION");
    const parsed = coupAnarchistEventSchema.safeParse(input);
    if (!parsed.success) throw new CoupModuleError("INCOMPATIBLE_GAME_VERSION");
    return freeze(parsed.data);
  },
  frontendAdapter: {
    gameId: "coup",
    adapterVersion: "coup-anarchist-ui-v1",
    engineVersion: descriptor.engineVersion,
    route: "/games/coup/:matchId",
    rendererKey: descriptor.engineVersion,
    assets: Object.freeze([] as string[]),
    toPresentation(input: unknown) {
      const parsed = views.safeParse(input);
      if (!parsed.success) throw new CoupModuleError("INCOMPATIBLE_GAME_VERSION");
      return freeze({
        view: parsed.data,
        prompt: parsed.data.phase,
        commands: parsed.data.kind === "PLAYER" ? parsed.data.legalCommands : [],
        deadlineAt: parsed.data.deadlineAt,
      });
    },
  },
});
