import {
  kahrobaStateSchema,
  kahrobaDescriptor,
  TOKEN_COLORS,
  GEM_COLORS,
  freeze,
  fail,
  totalTokens,
  type KahrobaState,
} from "./model.js";
import {
  kahrobaCards,
  kahrobaNobles,
  getKahrobaCard,
  getKahrobaNoble,
  bonuses,
  prestige,
} from "./catalog.js";

export function gemSupply(players: number): number {
  return players === 2 ? 4 : players === 3 ? 5 : 7;
}
export function nextDeadline(at: number, duration: number | null): number | null {
  if (duration === null) return null;
  const deadline = at + duration;
  if (!Number.isSafeInteger(deadline)) fail("INVALID_INPUT");
  return deadline;
}
function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
/** Validates current snapshots; no historical semantics are silently upgraded. */
export function migrateKahrobaState(input: unknown, fromVersion: number): KahrobaState {
  if (fromVersion !== kahrobaDescriptor.stateSchemaVersion) fail("INCOMPATIBLE_GAME_VERSION");
  const parsed = kahrobaStateSchema.safeParse(input);
  if (!parsed.success) fail("INCOMPATIBLE_GAME_VERSION");
  const s = parsed.data,
    n = s.players.length;
  const bad = () => fail("INCOMPATIBLE_GAME_VERSION");
  if (
    !unique(s.players.map((p) => p.id)) ||
    s.firstPlayerIndex >= n ||
    s.turnPlayerIndex >= n ||
    s.lastCommandAt < s.createdAt ||
    s.metrics.passes > s.revision ||
    s.metrics.timeouts > s.revision ||
    (s.revision === 0 && s.lastCommandAt !== s.createdAt)
  )
    bad();
  const ended = s.phase === "GAME_OVER";
  if (
    s.turnNumber !== s.revision + (ended ? 0 : 1) ||
    s.turnPlayerIndex !== (s.firstPlayerIndex + s.revision - (ended ? 1 : 0) + n) % n ||
    (ended && s.revision === 0)
  )
    bad();
  const inventory = [
    ...s.decks.flat(),
    ...s.market.flat().filter((id): id is string => id !== null),
    ...s.players.flatMap((p) => [...p.purchased, ...p.reserved]),
  ];
  if (
    inventory.length !== 90 ||
    !unique(inventory) ||
    kahrobaCards.some((c) => !inventory.includes(c.id))
  )
    bad();
  for (let tier = 0; tier < 3; tier++) {
    if (
      [...s.decks[tier]!, ...s.market[tier]!.filter((id): id is string => id !== null)].some(
        (id) => getKahrobaCard(id).tier !== tier + 1,
      )
    )
      bad();
    if (s.decks[tier]!.length > 0 && s.market[tier]!.includes(null)) bad();
  }
  const nobleInventory = [...s.nobles, ...s.unusedNobles, ...s.players.flatMap((p) => p.nobles)];
  if (
    nobleInventory.length !== 10 ||
    !unique(nobleInventory) ||
    kahrobaNobles.some((t) => !nobleInventory.includes(t.id)) ||
    s.unusedNobles.length !== 9 - n
  )
    bad();
  for (const c of TOKEN_COLORS) {
    if (
      s.bank[c] + s.players.reduce((sum, p) => sum + p.tokens[c], 0) !==
      (c === "gold" ? 5 : gemSupply(n))
    )
      bad();
  }
  for (const [i, p] of s.players.entries()) {
    const relative = (i - s.firstPlayerIndex + n) % n;
    const turns = Math.floor(s.revision / n) + (relative < s.revision % n ? 1 : 0);
    if (
      p.seat !== i ||
      p.turnsTaken !== turns ||
      totalTokens(p.tokens) > 10 ||
      p.purchased.length + p.reserved.length > turns ||
      p.nobles.length > turns
    )
      bad();
    const owned = bonuses(p);
    if (
      p.nobles.some((id) => GEM_COLORS.some((c) => owned[c] < getKahrobaNoble(id).requirements[c]))
    )
      bad();
    if (s.revision === 0 && totalTokens(p.tokens) !== 0) bad();
  }
  const deadline =
    s.rules.turnDurationMs === null ? null : s.lastCommandAt + s.rules.turnDurationMs;
  if (
    (deadline !== null && !Number.isSafeInteger(deadline)) ||
    s.deadlineAt !== (ended ? null : deadline)
  )
    bad();
  if (!s.finalRound) {
    if (ended || s.players.some((p) => prestige(p) >= 15)) bad();
  } else {
    const f = s.finalRound;
    const actor = s.players[(s.firstPlayerIndex + f.triggerTurnNumber - 1) % n]!;
    if (
      f.triggerTurnNumber > s.revision ||
      f.endTurnNumber !== Math.ceil(f.triggerTurnNumber / n) * n ||
      actor.id !== f.triggerPlayerId ||
      prestige(actor) < 15 ||
      (ended ? s.revision !== f.endTurnNumber : s.revision >= f.endTurnNumber)
    )
      bad();
  }
  return freeze(s);
}
