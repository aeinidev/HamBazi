// Trusted server composition only; does not activate catalog or select live policy.
export { createCoupMatchGame } from "./composition/coup-match.js";
export { createKahrobaMatchGame, kahrobaMatchDescriptor } from "./composition/kahroba-match.js";
export {
  createPersonalCoupGame,
  createPersonalAnarchistCoupGame,
  createPersonalCoupGames,
} from "./composition/personal-coup.js";
