import { z } from "zod";
import type { Snapshot } from "../../../platform/contracts.js";

const id = z.uuid();
const role = z.enum(["DUKE", "ASSASSIN", "CAPTAIN", "AMBASSADOR", "CONTESSA"]);
const count = z.number().int().nonnegative();
const claim = z.strictObject({ kind: z.enum(["ACTION", "BLOCK"]), claimantId: id, role });
const command = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("DECLARE_INCOME") }),
  z.strictObject({ type: z.literal("DECLARE_FOREIGN_AID") }),
  z.strictObject({ type: z.literal("DECLARE_TAX") }),
  z.strictObject({ type: z.literal("DECLARE_EXCHANGE") }),
  z.strictObject({ type: z.literal("DECLARE_COUP"), targetId: id }),
  z.strictObject({ type: z.literal("DECLARE_STEAL"), targetId: id }),
  z.strictObject({ type: z.literal("DECLARE_ASSASSINATION"), targetId: id }),
  z.strictObject({ type: z.literal("PASS_CHALLENGE"), windowId: count.positive() }),
  z.strictObject({ type: z.literal("PASS_BLOCK"), windowId: count.positive() }),
  z.strictObject({ type: z.literal("CHALLENGE"), windowId: count.positive() }),
  z.strictObject({ type: z.literal("CONCEDE_CLAIM"), windowId: count.positive() }),
  z.strictObject({ type: z.literal("BLOCK"), windowId: count.positive(), role }),
  z.strictObject({ type: z.literal("PROVE_CLAIM"), windowId: count.positive(), cardIndex: count }),
  z.strictObject({
    type: z.literal("SELECT_CARD_TO_LOSE"),
    windowId: count.positive(),
    cardIndex: count,
  }),
  z.strictObject({
    type: z.literal("SELECT_EXCHANGE"),
    windowId: count.positive(),
    cardIndices: z.array(count).min(1).max(3),
  }),
]);
const base = {
  engineVersion: z.literal("coup-v1"),
  stateSchemaVersion: z.literal(4),
  rulesetVersion: z.literal("coup-provisional-complete-v1"),
  viewSchemaVersion: z.literal(1),
  revision: count,
  phase: z.enum([
    "WAITING_FOR_ACTION",
    "CHALLENGE",
    "BLOCK",
    "PROOF",
    "LOSS",
    "EXCHANGE",
    "GAME_OVER",
  ]),
  turnNumber: count.positive(),
  turnPlayerId: id,
  winnerId: id.nullable(),
  deadlineAt: count.nullable(),
  pendingAction: z
    .strictObject({
      actorId: id,
      kind: z.enum(["INCOME", "FOREIGN_AID", "COUP", "TAX", "STEAL", "ASSASSINATION", "EXCHANGE"]),
      targetId: id.nullable(),
    })
    .nullable(),
  window: z
    .strictObject({
      id: count.positive(),
      eligibleIds: z.array(id).min(1).max(5),
      passedIds: z.array(id).max(5),
      claim: claim.nullable(),
    })
    .nullable(),
  proof: z.strictObject({ claim, challengerId: id }).nullable(),
  loss: z
    .strictObject({ playerId: id, reason: z.enum(["COUP", "ASSASSINATION", "CHALLENGE"]) })
    .nullable(),
  players: z
    .array(
      z.strictObject({
        id,
        seat: count,
        coins: count,
        cardsRemaining: count.max(3),
        revealed: z.array(role).max(3),
      }),
    )
    .min(2)
    .max(6),
};
const spectator = z.strictObject({ ...base, kind: z.literal("SPECTATOR") });
const player = z.strictObject({
  ...base,
  kind: z.literal("PLAYER"),
  viewerId: id,
  myCards: z.array(role).max(3),
  exchangeChoices: z.array(role).min(3).max(5).nullable(),
  legalCommands: z.array(command).max(64),
});
const viewSchema = z.discriminatedUnion("kind", [player, spectator]);
export type CoupView = z.infer<typeof viewSchema>;
export type CoupCommand = z.infer<typeof command>;

// The wire snapshot accepts JSON. The game boundary accepts only this exact public projection.
export function toCoupView(snapshot: Snapshot, viewerId: string): CoupView | null {
  if (
    snapshot.gameId !== "coup" ||
    snapshot.engineVersion !== "coup-v1" ||
    snapshot.stateSchemaVersion !== 4 ||
    snapshot.rulesetVersion !== "coup-provisional-complete-v1"
  )
    return null;
  const result = viewSchema.safeParse(snapshot.view);
  if (!result.success) return null;
  const view = result.data;
  if (
    view.kind !== snapshot.role ||
    view.engineVersion !== snapshot.engineVersion ||
    view.stateSchemaVersion !== snapshot.stateSchemaVersion ||
    view.rulesetVersion !== snapshot.rulesetVersion ||
    (view.kind === "PLAYER" && view.viewerId !== viewerId)
  )
    return null;
  return view;
}
