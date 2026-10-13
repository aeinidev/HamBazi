import { CARD_ROWS, NOBLE_ROWS } from "./data.js";
import {
  GEM_COLORS,
  developmentCardSchema,
  nobleSchema,
  freeze,
  zeroGems,
  fail,
  type DevelopmentCard,
  type Noble,
  type GemVector,
  type KahrobaState,
} from "./model.js";

export const kahrobaCards: readonly DevelopmentCard[] = freeze(
  CARD_ROWS.map(([sourceId, tier, bonus, prestige, diamond, sapphire, emerald, ruby, onyx]) =>
    developmentCardSchema.parse({
      id: `kahroba-card-${String(sourceId).padStart(2, "0")}`,
      tier,
      bonus,
      prestige,
      cost: { diamond, sapphire, emerald, ruby, onyx },
    }),
  ),
);
export const kahrobaNobles: readonly Noble[] = freeze(
  NOBLE_ROWS.map(([sourceId, prestige, diamond, sapphire, emerald, ruby, onyx]) =>
    nobleSchema.parse({
      id: `kahroba-noble-${String(sourceId).padStart(2, "0")}`,
      prestige,
      requirements: { diamond, sapphire, emerald, ruby, onyx },
    }),
  ),
);
const cards = new Map(kahrobaCards.map((c) => [c.id, c]));
const nobles = new Map(kahrobaNobles.map((n) => [n.id, n]));
export function getKahrobaCard(id: string): DevelopmentCard {
  return cards.get(id) ?? fail("GAME_STATE_CONFLICT");
}
export function getKahrobaNoble(id: string): Noble {
  return nobles.get(id) ?? fail("GAME_STATE_CONFLICT");
}
export function bonuses(player: KahrobaState["players"][number]): GemVector {
  const result = zeroGems();
  for (const id of player.purchased) result[getKahrobaCard(id).bonus]++;
  return result;
}
export function prestige(player: KahrobaState["players"][number]): number {
  return (
    player.purchased.reduce((n, id) => n + getKahrobaCard(id).prestige, 0) +
    player.nobles.length * 3
  );
}
export function eligibleNobles(
  state: KahrobaState,
  player: KahrobaState["players"][number],
): string[] {
  const owned = bonuses(player);
  return state.nobles.filter((id) =>
    GEM_COLORS.every((c) => owned[c] >= getKahrobaNoble(id).requirements[c]),
  );
}
