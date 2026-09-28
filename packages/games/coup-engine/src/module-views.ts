import { z } from "zod";
import {
  coupDescriptor,
  coupModuleStateSchema,
  coupModuleCommandSchema,
  roleSchema,
  idSchema,
  freeze,
  assertCoupVersion,
  conflict,
  CoupModuleError,
  type CoupModuleState as State,
  type CoupModuleCommand as Command,
} from "./module-model.js";
import { validateCoupModuleCommand } from "./module-validation.js";

const publicShape = {
  engineVersion: z.literal("coup-v1"),
  stateSchemaVersion: z.literal(4),
  rulesetVersion: z.literal("coup-provisional-complete-v1"),
  viewSchemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  phase: coupModuleStateSchema.shape.phase,
  turnNumber: z.number().int().positive(),
  turnPlayerId: idSchema,
  winnerId: idSchema.nullable(),
  deadlineAt: z.number().int().nonnegative().nullable(),
  pendingAction: coupModuleStateSchema.shape.pendingAction,
  window: coupModuleStateSchema.shape.window,
  proof: coupModuleStateSchema.shape.proof,
  loss: z
    .strictObject({ playerId: idSchema, reason: z.enum(["COUP", "ASSASSINATION", "CHALLENGE"]) })
    .nullable(),
  players: z
    .array(
      z.strictObject({
        id: idSchema,
        seat: z.number().int().nonnegative(),
        coins: z.number().int().nonnegative(),
        cardsRemaining: z.number().int().min(0).max(3),
        revealed: z.array(roleSchema).max(3),
      }),
    )
    .min(2)
    .max(6),
};
export const coupSpectatorViewSchema = z.strictObject({
  ...publicShape,
  kind: z.literal("SPECTATOR"),
});
export const coupPlayerViewSchema = z.strictObject({
  ...publicShape,
  kind: z.literal("PLAYER"),
  viewerId: idSchema,
  myCards: z.array(roleSchema).max(3),
  exchangeChoices: z.array(roleSchema).min(3).max(5).nullable(),
  legalCommands: z.array(coupModuleCommandSchema).max(64),
});
export type CoupModulePlayerView = z.infer<typeof coupPlayerViewSchema>;
export type CoupModuleSpectatorView = z.infer<typeof coupSpectatorViewSchema>;
export function getCoupModuleSpectatorView(s: State): CoupModuleSpectatorView {
  assertCoupVersion(s);
  return freeze({
    engineVersion: "coup-v1",
    stateSchemaVersion: 4,
    rulesetVersion: "coup-provisional-complete-v1",
    viewSchemaVersion: 1,
    kind: "SPECTATOR",
    revision: s.revision,
    phase: s.phase,
    turnNumber: s.turnNumber,
    turnPlayerId: s.turnPlayerId,
    winnerId: s.winnerId,
    deadlineAt: s.deadlineAt,
    pendingAction: s.pendingAction ? { ...s.pendingAction } : null,
    window: s.window
      ? {
          ...s.window,
          eligibleIds: [...s.window.eligibleIds],
          passedIds: [...s.window.passedIds],
          claim: s.window.claim ? { ...s.window.claim } : null,
        }
      : null,
    proof: s.proof ? { ...s.proof, claim: { ...s.proof.claim } } : null,
    loss: s.loss ? { playerId: s.loss.playerId, reason: s.loss.reason } : null,
    players: s.players.map((p) => ({
      id: p.id,
      seat: p.seat,
      coins: p.coins,
      cardsRemaining: p.influence.length,
      revealed: [...p.revealed],
    })),
  });
}
function commands(s: State, actorId: string): Command[] {
  const p = s.players.find((p) => p.id === actorId) ?? conflict();
  const windowId = s.window?.id ?? 1;
  const candidates: Command[] = [
    { type: "DECLARE_INCOME" },
    { type: "DECLARE_FOREIGN_AID" },
    { type: "DECLARE_TAX" },
    { type: "DECLARE_EXCHANGE" },
    { type: "PASS_CHALLENGE", windowId },
    { type: "PASS_BLOCK", windowId },
    { type: "CHALLENGE", windowId },
    { type: "CONCEDE_CLAIM", windowId },
  ];
  for (const target of s.players)
    for (const type of ["DECLARE_COUP", "DECLARE_STEAL", "DECLARE_ASSASSINATION"] as const)
      candidates.push({ type, targetId: target.id });
  for (const role of roleSchema.options) candidates.push({ type: "BLOCK", windowId, role });
  for (let cardIndex = 0; cardIndex < p.influence.length; cardIndex++)
    candidates.push(
      { type: "PROVE_CLAIM", windowId, cardIndex },
      { type: "SELECT_CARD_TO_LOSE", windowId, cardIndex },
    );
  if (s.exchange?.playerId === actorId) {
    const length = p.influence.length + s.exchange.drawn.length;
    for (let mask = 0; mask < 2 ** length; mask++) {
      const cardIndices = Array.from({ length }, (_, i) => i).filter(
        (i) => (mask & (2 ** i)) !== 0,
      );
      if (cardIndices.length === p.influence.length)
        candidates.push({ type: "SELECT_EXCHANGE", windowId, cardIndices });
    }
  }
  return candidates.filter((c) => {
    try {
      validateCoupModuleCommand(s, c, actorId);
      return true;
    } catch (error) {
      if (error instanceof CoupModuleError) return false;
      throw error;
    }
  });
}
export function getCoupModulePlayerView(s: State, viewerId: string): CoupModulePlayerView {
  const p = s.players.find((p) => p.id === viewerId) ?? conflict();
  return freeze({
    ...getCoupModuleSpectatorView(s),
    kind: "PLAYER",
    viewerId,
    myCards: [...p.influence],
    exchangeChoices:
      s.exchange?.playerId === viewerId ? [...p.influence, ...s.exchange.drawn] : null,
    legalCommands: commands(s, viewerId),
  });
}
function parsePlayer(input: unknown): CoupModulePlayerView {
  const parsed = coupPlayerViewSchema.safeParse(input);
  if (!parsed.success) throw new CoupModuleError("INCOMPATIBLE_GAME_VERSION");
  return parsed.data;
}
export function chooseCoupTimeoutCommand(input: unknown): Command | null {
  const view = parsePlayer(input);
  const types: Command["type"][] = [
    "PASS_CHALLENGE",
    "PASS_BLOCK",
    "PROVE_CLAIM",
    "CONCEDE_CLAIM",
    "SELECT_CARD_TO_LOSE",
    "SELECT_EXCHANGE",
    "DECLARE_INCOME",
    "DECLARE_COUP",
  ];
  for (const type of types) {
    const command = view.legalCommands.find((c) => c.type === type);
    if (command) return freeze(command);
  }
  return null;
}
export const coupBotPolicy = Object.freeze({
  strategyVersion: "coup-bot-v1",
  chooseCommand(input: unknown): Command | null {
    const view = parsePlayer(input),
      commands = view.legalCommands;
    const coup = commands.find((c) => c.type === "DECLARE_COUP");
    if (coup) return freeze(coup);
    const block = commands.find((c) => c.type === "BLOCK" && view.myCards.includes(c.role));
    if (block) return freeze(block);
    const tax = commands.find((c) => c.type === "DECLARE_TAX" && view.myCards.includes("DUKE"));
    if (tax) return freeze(tax);
    return chooseCoupTimeoutCommand(view);
  },
});
// Trusted timer orchestration selects a seat, then uses exactly its human view.
export function timeoutDecision(s: State): { actorId: string; command: Command } | null {
  if (s.phase === "GAME_OVER") return null;
  const actorId =
    s.phase === "WAITING_FOR_ACTION"
      ? s.turnPlayerId
      : s.window?.eligibleIds.find((id) => !s.window!.passedIds.includes(id));
  if (!actorId) return null;
  const command = chooseCoupTimeoutCommand(getCoupModulePlayerView(s, actorId));
  return command ? { actorId, command } : null;
}
const anyView = z.discriminatedUnion("kind", [coupPlayerViewSchema, coupSpectatorViewSchema]);
export const coupFrontendAdapter = Object.freeze({
  gameId: "coup",
  adapterVersion: "coup-ui-contract-v1",
  engineVersion: coupDescriptor.engineVersion,
  route: "/games/coup/:matchId",
  rendererKey: "coup-v1",
  assets: Object.freeze([] as string[]),
  toPresentation(input: unknown) {
    const parsed = anyView.safeParse(input);
    if (!parsed.success) throw new CoupModuleError("INCOMPATIBLE_GAME_VERSION");
    const view = parsed.data;
    return freeze({
      view,
      prompt: view.phase,
      commands: view.kind === "PLAYER" ? view.legalCommands : [],
      deadlineAt: view.deadlineAt,
    });
  },
});
