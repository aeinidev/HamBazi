import type { GemColor } from "./adapters/index.js";
const root = "/assets/kahroba";
export const kahrobaAssets = {
  background: `${root}/palace-background.webp`,
  logo: `${root}/kahroba-logo.webp`,
  art: (color: GemColor) => `${root}/card-art-${color}.webp`,
  token: (color: GemColor | "gold") =>
    `${root}/${color === "gold" ? "token-gold" : `gem-${color}`}.webp`,
  noble: (id: string) =>
    `${root}/noble-${["queen-ivory", "king", "queen-ruby", "elder"][Number(id.slice(-2)) % 4]}.webp`,
};
export const gemNames: Record<GemColor | "gold", string> = {
  diamond: "الماس",
  sapphire: "یاقوت آبی",
  emerald: "زمرد",
  ruby: "یاقوت سرخ",
  onyx: "اونیکس",
  gold: "طلا",
};
