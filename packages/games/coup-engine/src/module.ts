import type { GameBotPolicy, GameFrontendAdapter } from "@hambazi/game-core";
import { coupManifest } from "./model.js";
import {
  coupDescriptor,
  coupModuleCommandSchema,
  coupModuleEventSchema,
  assertCoupVersion,
  freeze,
  type CoupModuleState,
  type CoupModuleCommand,
} from "./module-model.js";
import { coupEngine, executeCoupTimeout } from "./module-engine.js";
import {
  coupBotPolicy,
  coupFrontendAdapter,
  getCoupModulePlayerView,
  getCoupModuleSpectatorView,
  type CoupModulePlayerView,
} from "./module-views.js";
import { migrateCoupState, upcastCoupEvent } from "./module-compatibility.js";

export const coupReconnectPolicy = Object.freeze({
  policyVersion: "coup-reconnect-v1",
  pauseOnDisconnect: false,
  allowSeatReclaim: false,
  viewAfterTakeover: "SPECTATOR",
});
/** Seat status must come from the authorized Match application, never a client field. */
export function getCoupReconnectView(
  state: CoupModuleState,
  playerId: string,
  seatStatus: "HUMAN" | "REPLACED_BY_BOT",
) {
  // Verify membership even when selecting the public projection.
  const own = getCoupModulePlayerView(state, playerId);
  return seatStatus === "HUMAN" ? own : getCoupModuleSpectatorView(state);
}
export const coupTimerPolicy = Object.freeze({
  policyVersion: "coup-timer-v1",
  getDeadline(state: CoupModuleState) {
    assertCoupVersion(state);
    return state.deadlineAt === null
      ? null
      : freeze({ expectedRevision: state.revision, deadlineAt: state.deadlineAt });
  },
  executeTimeout: executeCoupTimeout,
});
const bot: GameBotPolicy<CoupModulePlayerView, CoupModuleCommand> = coupBotPolicy;
const frontend: GameFrontendAdapter<ReturnType<typeof coupFrontendAdapter.toPresentation>> =
  coupFrontendAdapter;
export const coupModule = Object.freeze({
  manifest: coupManifest,
  descriptor: coupDescriptor,
  engine: coupEngine,
  schemas: Object.freeze({ command: coupModuleCommandSchema, event: coupModuleEventSchema }),
  botPolicy: bot,
  timerPolicy: coupTimerPolicy,
  reconnectPolicy: coupReconnectPolicy,
  frontendAdapter: frontend,
  migrateState: migrateCoupState,
  upcastEvent: upcastCoupEvent,
});
