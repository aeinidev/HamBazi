import { z } from "zod";
import type { Clock, RandomSource, GameEngine } from "@hambazi/game-core";
import {
  kahrobaDescriptor,
  kahrobaRulesSchema,
  kahrobaEventSchema,
  playerIdSchema,
  timeSchema,
  countSchema,
  GEM_COLORS,
  zeroTokens,
  freeze,
  fail,
  type KahrobaRules,
  type KahrobaState,
  type KahrobaEvent,
  type KahrobaCommand,
  type MutableKahrobaState,
} from "./model.js";
import { kahrobaCards, kahrobaNobles } from "./catalog.js";
import { gemSupply, migrateKahrobaState, nextDeadline } from "./state.js";
import { parseKahrobaCommand, resolveTurn } from "./turn.js";
import {
  getKahrobaPlayerView,
  getKahrobaSpectatorView,
  getKahrobaResult,
  type KahrobaPlayerView,
  type KahrobaSpectatorView,
} from "./views.js";

const initialSchema = z.strictObject({ playerIds: z.array(playerIdSchema).min(2).max(4) });
type InitialInput = z.infer<typeof initialSchema>;
function time(input: unknown): number {
  const r = timeSchema.safeParse(input);
  if (!r.success) fail("INVALID_INPUT");
  return r.data;
}
function shuffle<T>(items: readonly T[], random: RandomSource): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random.nextInt(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) fail("INVALID_INPUT");
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
export function createKahrobaInitialState(
  input: unknown,
  deps: { clock: Clock; random: RandomSource; rules: KahrobaRules },
): KahrobaState {
  const parsed = initialSchema.safeParse(input),
    rules = kahrobaRulesSchema.safeParse(deps.rules);
  if (
    !parsed.success ||
    !rules.success ||
    new Set(parsed.data.playerIds).size !== parsed.data.playerIds.length
  )
    fail("INVALID_INPUT");
  const at = time(deps.clock.now()),
    n = parsed.data.playerIds.length,
    first = deps.random.nextInt(n);
  if (!Number.isInteger(first) || first < 0 || first >= n) fail("INVALID_INPUT");
  const decks = [1, 2, 3].map((tier) =>
    shuffle(
      kahrobaCards.filter((c) => c.tier === tier).map((c) => c.id),
      deps.random,
    ),
  ) as MutableKahrobaState["decks"];
  const market = decks.map((deck) => deck.splice(0, 4)) as MutableKahrobaState["market"];
  const nobles = shuffle(
    kahrobaNobles.map((t) => t.id),
    deps.random,
  );
  const bank = zeroTokens();
  for (const c of GEM_COLORS) bank[c] = gemSupply(n);
  bank.gold = 5;
  return migrateKahrobaState(
    {
      engineVersion: kahrobaDescriptor.engineVersion,
      stateSchemaVersion: 1,
      rulesetVersion: kahrobaDescriptor.rulesetVersion,
      rules: rules.data,
      phase: "WAITING_FOR_ACTION",
      createdAt: at,
      lastCommandAt: at,
      deadlineAt: nextDeadline(at, rules.data.turnDurationMs),
      revision: 0,
      turnNumber: 1,
      firstPlayerIndex: first,
      turnPlayerIndex: first,
      players: parsed.data.playerIds.map((id, seat) => ({
        id,
        seat,
        tokens: zeroTokens(),
        purchased: [],
        reserved: [],
        nobles: [],
        turnsTaken: 0,
      })),
      bank,
      decks,
      market,
      nobles: nobles.slice(0, n + 1),
      unusedNobles: nobles.slice(n + 1),
      finalRound: null,
      metrics: { passes: 0, timeouts: 0 },
    },
    1,
  );
}
function validateAt(s: KahrobaState, at: number, timeout: boolean): void {
  if (
    at < s.lastCommandAt ||
    s.phase === "GAME_OVER" ||
    (timeout
      ? s.deadlineAt === null || at < s.deadlineAt
      : s.deadlineAt !== null && at >= s.deadlineAt)
  )
    fail("GAME_STATE_CONFLICT");
}
export function upcastKahrobaEvent(input: unknown, fromVersion: number): KahrobaEvent {
  if (fromVersion !== 1) fail("INCOMPATIBLE_GAME_VERSION");
  const r = kahrobaEventSchema.safeParse(input);
  if (!r.success) fail("INCOMPATIBLE_GAME_VERSION");
  return freeze(r.data);
}
export function applyKahrobaEvent(input: KahrobaState, event: KahrobaEvent): KahrobaState {
  const s = migrateKahrobaState(input, 1),
    e = upcastKahrobaEvent(event, 1),
    timeout = e.source === "TIMEOUT";
  if (
    e.expectedRevision !== s.revision ||
    (timeout
      ? e.timeoutPolicyVersion === null || e.timeoutPolicyVersion !== s.rules.timeoutPolicyVersion
      : e.timeoutPolicyVersion !== null)
  )
    fail("GAME_STATE_CONFLICT");
  validateAt(s, e.occurredAt, timeout);
  const next = resolveTurn(s, e.command, e.actorId, e.occurredAt, timeout);
  if (next.deadlineAt !== e.deadlineAt) fail("GAME_STATE_CONFLICT");
  return migrateKahrobaState(next, 1);
}
function events(
  s: KahrobaState,
  command: KahrobaCommand,
  actorId: string,
  at: number,
  timeout: boolean,
): readonly KahrobaEvent[] {
  validateAt(s, at, timeout);
  const next = migrateKahrobaState(resolveTurn(s, command, actorId, at, timeout), 1);
  return freeze([
    {
      type: "TURN_RESOLVED",
      schemaVersion: 1,
      expectedRevision: s.revision,
      actorId,
      command,
      occurredAt: at,
      source: timeout ? "TIMEOUT" : "PLAYER",
      timeoutPolicyVersion: timeout ? s.rules.timeoutPolicyVersion : null,
      deadlineAt: next.deadlineAt,
    },
  ]);
}
export const kahrobaEngine = Object.freeze({
  descriptor: kahrobaDescriptor,
  createInitialState: createKahrobaInitialState,
  validateCommand(input: KahrobaState, command: unknown, actorId: string) {
    const s = migrateKahrobaState(input, 1);
    migrateKahrobaState(
      resolveTurn(s, parseKahrobaCommand(command), actorId, s.lastCommandAt, false),
      1,
    );
  },
  execute(
    input: KahrobaState,
    command: unknown,
    actorId: string,
    deps: { clock: Clock; random: RandomSource; rules: KahrobaRules },
  ) {
    const s = migrateKahrobaState(input, 1),
      rules = kahrobaRulesSchema.safeParse(deps.rules);
    if (!rules.success || JSON.stringify(rules.data) !== JSON.stringify(s.rules))
      fail("INCOMPATIBLE_GAME_VERSION");
    return events(s, parseKahrobaCommand(command), actorId, time(deps.clock.now()), false);
  },
  applyEvent: applyKahrobaEvent,
  getPlayerView: getKahrobaPlayerView,
  getSpectatorView: getKahrobaSpectatorView,
  getResult: getKahrobaResult,
  migrateState: migrateKahrobaState,
} satisfies GameEngine<
  KahrobaState,
  InitialInput,
  KahrobaCommand,
  KahrobaEvent,
  KahrobaPlayerView,
  KahrobaRules,
  KahrobaSpectatorView
>);

export interface KahrobaTimeoutPolicy {
  readonly policyVersion: string;
  chooseCommand(view: KahrobaPlayerView): KahrobaCommand | null;
}
const timeoutGuardSchema = z.strictObject({
  expectedRevision: countSchema,
  deadlineAt: timeSchema,
});
/** Trusted caller must explicitly supply the matching policy; K1 registers no fallback. */
export function executeKahrobaTimeout(
  input: KahrobaState,
  guard: { expectedRevision: number; deadlineAt: number },
  deps: { clock: Clock; policy: KahrobaTimeoutPolicy },
): readonly KahrobaEvent[] {
  const s = migrateKahrobaState(input, 1),
    at = time(deps.clock.now());
  const parsed = timeoutGuardSchema.safeParse(guard);
  if (!parsed.success) fail("INVALID_INPUT");
  if (
    s.phase === "GAME_OVER" ||
    s.deadlineAt === null ||
    parsed.data.expectedRevision !== s.revision ||
    parsed.data.deadlineAt !== s.deadlineAt ||
    at < s.deadlineAt
  )
    return freeze([]);
  if (!deps.policy || typeof deps.policy.chooseCommand !== "function") fail("INVALID_INPUT");
  if (deps.policy.policyVersion !== s.rules.timeoutPolicyVersion) fail("INCOMPATIBLE_GAME_VERSION");
  const actorId = s.players[s.turnPlayerIndex]!.id;
  const command = deps.policy.chooseCommand(getKahrobaPlayerView(s, actorId));
  return command === null ? freeze([]) : events(s, parseKahrobaCommand(command), actorId, at, true);
}
