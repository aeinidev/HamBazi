import {
  coupModuleCommandSchema,
  assertCoupVersion as version,
  conflict as fail,
  CoupModuleError,
  type CoupModuleState as State,
  type CoupModuleCommand as Command,
} from "./module-model.js";
function player(s: State, id: string) {
  return s.players.find((p) => p.id === id) ?? fail();
}
export function validateCoupModuleCommand(s: State, input: unknown, actorId: string): Command {
  version(s);
  const parsed = coupModuleCommandSchema.safeParse(input);
  if (!parsed.success) throw new CoupModuleError("INVALID_INPUT");
  const c = parsed.data,
    p = player(s, actorId);
  if (!p.influence.length || s.phase === "GAME_OVER") fail();
  if (!("windowId" in c)) {
    if (s.phase !== "WAITING_FOR_ACTION" || s.turnPlayerId !== actorId) fail();
    if (p.coins >= s.rules.mandatoryCoupAt && c.type !== "DECLARE_COUP") fail();
    if ("targetId" in c && (c.targetId === actorId || !player(s, c.targetId).influence.length))
      fail();
    if (c.type === "DECLARE_COUP" && p.coins < s.rules.coupCost) fail();
    if (c.type === "DECLARE_ASSASSINATION" && p.coins < s.rules.assassinationCost) fail();
    return c;
  }
  const w = s.window;
  if (
    !w ||
    c.windowId !== w.id ||
    !w.eligibleIds.includes(actorId) ||
    w.passedIds.includes(actorId)
  )
    fail();
  switch (c.type) {
    case "PASS_CHALLENGE":
    case "CHALLENGE":
      if (s.phase !== "CHALLENGE") fail();
      break;
    case "PASS_BLOCK":
      if (s.phase !== "BLOCK") fail();
      break;
    case "BLOCK": {
      const kind = s.pendingAction?.kind;
      if (
        s.phase !== "BLOCK" ||
        !(kind === "FOREIGN_AID"
          ? c.role === "DUKE"
          : kind === "STEAL"
            ? c.role === "CAPTAIN" || c.role === "AMBASSADOR"
            : kind === "ASSASSINATION" && c.role === "CONTESSA")
      )
        fail();
      break;
    }
    case "PROVE_CLAIM":
      if (s.phase !== "PROOF" || p.influence[c.cardIndex] !== s.proof?.claim.role) fail();
      break;
    case "CONCEDE_CLAIM":
      if (s.phase !== "PROOF") fail();
      break;
    case "SELECT_EXCHANGE":
      if (
        s.phase !== "EXCHANGE" ||
        s.exchange?.playerId !== actorId ||
        c.cardIndices.length !== p.influence.length ||
        new Set(c.cardIndices).size !== c.cardIndices.length ||
        c.cardIndices.some((i) => i >= p.influence.length + s.exchange!.drawn.length)
      )
        fail();
      break;
    case "SELECT_CARD_TO_LOSE":
      if (s.phase !== "LOSS" || c.cardIndex >= p.influence.length) fail();
      break;
  }
  return c;
}
