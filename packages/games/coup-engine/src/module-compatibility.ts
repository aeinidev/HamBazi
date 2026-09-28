import {
  coupModuleStateSchema,
  coupModuleEventSchema,
  CoupModuleError,
  freeze,
  roleSchema,
  type CoupModuleState as State,
  type CoupModuleEvent as Event,
  type Claim,
} from "./module-model.js";
function incompatible(): never {
  throw new CoupModuleError("INCOMPATIBLE_GAME_VERSION");
}
function unique(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length;
}
function validClaim(s: State, claim: Claim): boolean {
  const a = s.pendingAction;
  if (!a || !s.players.some((p) => p.id === claim.claimantId && p.influence.length > 0))
    return false;
  if (claim.kind === "ACTION") {
    const roles: Partial<Record<NonNullable<State["pendingAction"]>["kind"], string>> = {
      TAX: "DUKE",
      STEAL: "CAPTAIN",
      ASSASSINATION: "ASSASSIN",
      EXCHANGE: "AMBASSADOR",
    };
    return claim.claimantId === a.actorId && claim.role === roles[a.kind];
  }
  if (a.kind === "FOREIGN_AID") return claim.claimantId !== a.actorId && claim.role === "DUKE";
  return (
    claim.claimantId === a.targetId &&
    (a.kind === "STEAL"
      ? ["CAPTAIN", "AMBASSADOR"].includes(claim.role)
      : a.kind === "ASSASSINATION" && claim.role === "CONTESSA")
  );
}
/** No automatic semantics-changing upgrade: earlier engines remain pinned and executable. */
export function migrateCoupState(input: unknown, fromVersion: number): State {
  if (fromVersion !== 4) incompatible();
  const parsed = coupModuleStateSchema.safeParse(input);
  if (!parsed.success) incompatible();
  const s = parsed.data,
    ids = s.players.map((p) => p.id),
    living = s.players.filter((p) => p.influence.length > 0).map((p) => p.id);
  const actor = s.players.find((p) => p.id === s.turnPlayerId);
  if (
    !unique(ids) ||
    !unique(s.eliminationOrder) ||
    !actor ||
    s.players.some(
      (p, i) => p.seat !== i || p.influence.length + p.revealed.length !== s.rules.cardsPerPlayer,
    ) ||
    s.lastCommandAt < s.createdAt ||
    s.actionCount > s.revision ||
    s.turnNumber > s.actionCount + 1 ||
    s.eliminationOrder.some((id) => !ids.includes(id) || living.includes(id)) ||
    s.eliminationOrder.length !== ids.length - living.length
  )
    incompatible();
  const cards = [
    ...s.deck,
    ...s.players.flatMap((p) => [...p.influence, ...p.revealed]),
    ...(s.exchange?.drawn ?? []),
  ];
  if (
    roleSchema.options.some(
      (role) => cards.filter((c) => c === role).length !== s.rules.copiesPerRole,
    )
  )
    incompatible();
  const ended = s.phase === "GAME_OVER",
    ready = s.phase === "WAITING_FOR_ACTION";
  if (
    ended
      ? living.length !== 1 || s.winnerId !== living[0] || s.deadlineAt !== null
      : s.winnerId !== null ||
        s.deadlineAt === null ||
        living.length < 2 ||
        s.deadlineAt < s.createdAt
  )
    incompatible();
  if (
    ended || ready
      ? s.pendingAction !== null ||
        s.window !== null ||
        s.proof !== null ||
        s.loss !== null ||
        s.exchange !== null
      : !s.pendingAction || !s.window
  )
    incompatible();
  if (ready && !living.includes(s.turnPlayerId)) incompatible();
  if (
    s.actionCount !== s.turnNumber - (ready ? 1 : 0) ||
    s.metrics.challenges !==
      s.metrics.claimsProved + s.metrics.claimsConceded + (s.phase === "PROOF" ? 1 : 0) ||
    s.metrics.challenges > s.revision ||
    s.metrics.blocks > s.actionCount ||
    s.metrics.exchanges > s.actionCount ||
    s.metrics.timeouts > s.revision ||
    ((ready || ended) && s.players.some((p) => !p.influence.length && p.coins !== 0)) ||
    (s.phase !== "EXCHANGE" && s.deck.length < 2)
  )
    incompatible();
  if (s.pendingAction) {
    const a = s.pendingAction;
    if (a.actorId !== s.turnPlayerId || !living.includes(a.actorId)) incompatible();
    const targeted = ["COUP", "STEAL", "ASSASSINATION"].includes(a.kind);
    if (
      targeted
        ? a.targetId === null || !ids.includes(a.targetId) || a.targetId === a.actorId
        : a.targetId !== null
    )
      incompatible();
  }
  if (s.window) {
    const w = s.window;
    if (
      w.id > s.revision ||
      !unique(w.eligibleIds) ||
      !unique(w.passedIds) ||
      w.eligibleIds.some((id) => !living.includes(id)) ||
      w.passedIds.some((id) => !w.eligibleIds.includes(id)) ||
      w.passedIds.length === w.eligibleIds.length
    )
      incompatible();
    if (s.phase === "CHALLENGE") {
      if (
        !w.claim ||
        !living.includes(w.claim.claimantId) ||
        w.eligibleIds.includes(w.claim.claimantId) ||
        w.eligibleIds.length !== living.length - 1
      )
        incompatible();
      if (!validClaim(s, w.claim)) incompatible();
    } else if (w.claim !== null) incompatible();
    if (s.phase === "BLOCK") {
      const a = s.pendingAction!,
        eligible =
          a.kind === "FOREIGN_AID" ? living.filter((id) => id !== a.actorId) : [a.targetId];
      if (
        !["FOREIGN_AID", "STEAL", "ASSASSINATION"].includes(a.kind) ||
        eligible.length !== w.eligibleIds.length ||
        eligible.some((id) => !w.eligibleIds.includes(id!))
      )
        incompatible();
    }
    if (!["CHALLENGE", "BLOCK"].includes(s.phase) && w.passedIds.length !== 0) incompatible();
    if (s.phase === "PROOF") {
      if (
        !s.proof ||
        w.eligibleIds.length !== 1 ||
        w.eligibleIds[0] !== s.proof.claim.claimantId ||
        !living.includes(s.proof.challengerId) ||
        s.proof.challengerId === s.proof.claim.claimantId ||
        !validClaim(s, s.proof.claim)
      )
        incompatible();
    } else if (s.proof !== null) incompatible();
    if (s.phase === "LOSS") {
      if (!s.loss || w.eligibleIds.length !== 1 || w.eligibleIds[0] !== s.loss.playerId)
        incompatible();
      const a = s.pendingAction!,
        lost = s.loss;
      if (lost.reason !== "CHALLENGE") {
        if (lost.reason !== a.kind || lost.playerId !== a.targetId || lost.resume !== "END")
          incompatible();
      } else if (lost.resume === "VERIFIED") {
        if (
          !["TAX", "STEAL", "ASSASSINATION", "EXCHANGE"].includes(a.kind) ||
          lost.playerId === a.actorId
        )
          incompatible();
      } else if (lost.resume === "RESOLVE") {
        if (
          !["FOREIGN_AID", "STEAL", "ASSASSINATION"].includes(a.kind) ||
          lost.playerId === a.actorId ||
          (a.kind !== "FOREIGN_AID" && lost.playerId !== a.targetId)
        )
          incompatible();
      } else if (
        ["INCOME", "COUP"].includes(a.kind) ||
        (["TAX", "EXCHANGE"].includes(a.kind) && lost.playerId !== a.actorId)
      )
        incompatible();
    } else if (s.loss !== null) incompatible();
    if (s.phase === "EXCHANGE") {
      if (
        !s.exchange ||
        s.pendingAction!.kind !== "EXCHANGE" ||
        s.exchange.playerId !== s.turnPlayerId ||
        w.eligibleIds.length !== 1 ||
        w.eligibleIds[0] !== s.exchange.playerId
      )
        incompatible();
    } else if (s.exchange !== null) incompatible();
  }
  return freeze(s);
}
export function upcastCoupEvent(input: unknown, fromVersion: number): Event {
  if (fromVersion !== 3) incompatible();
  const parsed = coupModuleEventSchema.safeParse(input);
  if (!parsed.success) incompatible();
  return freeze(parsed.data);
}
