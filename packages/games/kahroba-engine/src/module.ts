import type { GameFrontendAdapter } from "@hambazi/game-core";
import {
  kahrobaManifest,
  kahrobaDescriptor,
  kahrobaCommandSchema,
  kahrobaEventSchema,
  freeze,
  fail,
  type KahrobaState,
} from "./model.js";
import { kahrobaEngine, executeKahrobaTimeout, upcastKahrobaEvent } from "./engine.js";
import { migrateKahrobaState } from "./state.js";
import { kahrobaBotPolicy } from "./bot-policy.js";
import {
  kahrobaViewSchema,
  getKahrobaPlayerView,
  getKahrobaSpectatorView,
  type KahrobaView,
} from "./views.js";

export const kahrobaTimerPolicy = Object.freeze({
  policyVersion: "kahroba-timer-v1",
  getDeadline(input: KahrobaState) {
    const s = migrateKahrobaState(input, 1);
    return s.deadlineAt === null
      ? null
      : freeze({ expectedRevision: s.revision, deadlineAt: s.deadlineAt });
  },
  executeTimeout: executeKahrobaTimeout,
});
export const kahrobaReconnectPolicy = Object.freeze({
  policyVersion: "kahroba-reconnect-v1",
  pauseOnDisconnect: false,
  allowSeatReclaim: false,
  viewAfterTakeover: "SPECTATOR",
});
/** Membership/seat status comes from trusted Match authorization, never a client. */
export function getKahrobaReconnectView(
  s: KahrobaState,
  playerId: string,
  role: "HUMAN" | "REPLACED_BY_BOT",
) {
  const own = getKahrobaPlayerView(s, playerId);
  return role === "HUMAN" ? own : getKahrobaSpectatorView(s);
}
export const kahrobaFrontendAdapter = Object.freeze({
  gameId: "kahroba",
  adapterVersion: "kahroba-frontend-v1",
  engineVersion: "kahroba-v1",
  route: "/games/kahroba/:matchId",
  rendererKey: "kahroba-v1",
  assets: Object.freeze([] as string[]),
  toPresentation(input: unknown): KahrobaView {
    const r = kahrobaViewSchema.safeParse(input);
    if (!r.success) fail("INCOMPATIBLE_GAME_VERSION");
    return freeze(r.data);
  },
} satisfies GameFrontendAdapter<KahrobaView>);
export const kahrobaModule = Object.freeze({
  manifest: kahrobaManifest,
  descriptor: kahrobaDescriptor,
  engine: kahrobaEngine,
  schemas: Object.freeze({
    command: kahrobaCommandSchema,
    event: kahrobaEventSchema,
    view: kahrobaViewSchema,
  }),
  botPolicy: kahrobaBotPolicy,
  timerPolicy: kahrobaTimerPolicy,
  reconnectPolicy: kahrobaReconnectPolicy,
  frontendAdapter: kahrobaFrontendAdapter,
  migrateState: migrateKahrobaState,
  upcastEvent: upcastKahrobaEvent,
});
