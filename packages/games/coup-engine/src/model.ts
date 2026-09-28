import type {
  Clock,
  GameManifest,
  GameVersionDescriptor,
  RandomSource,
  RuleConfig,
} from "@hambazi/game-core";
import { gameManifestSchema, gameVersionDescriptorSchema } from "@hambazi/game-core";
import { z } from "zod";

const playerId = z.uuid().transform((value) => value.toLowerCase());
const roleSchema = z.enum(["DUKE", "ASSASSIN", "CAPTAIN", "AMBASSADOR", "CONTESSA"]);
export type CoupRole = z.infer<typeof roleSchema>;
const roles = roleSchema.options;

// This descriptor describes an offline foundation, not an executable registry entry.
export const coupFoundationDescriptor: GameVersionDescriptor = Object.freeze(
  gameVersionDescriptorSchema.parse({
    engineVersion: "coup-foundation-v1",
    stateSchemaVersion: 1,
    rulesetVersion: "coup-provisional-v1",
    commandSchemaVersion: 1,
    eventSchemaVersion: 1,
  }),
);

const parsedManifest = gameManifestSchema.parse({
  id: "coup",
  slug: "coup",
  title: "Coup",
  minPlayers: 2,
  maxPlayers: 6,
  modes: [],
  matchmakingEnabled: false,
  privateRoomsEnabled: false,
  chatEnabled: false,
  voiceEnabled: false,
  status: "DISABLED",
});
export const coupManifest: GameManifest = Object.freeze({
  ...parsedManifest,
  modes: Object.freeze(parsedManifest.modes),
});

export const coupInitialInputSchema = z
  .strictObject({
    playerIds: z.array(playerId).min(coupManifest.minPlayers).max(coupManifest.maxPlayers),
  })
  .refine((value) => new Set(value.playerIds).size === value.playerIds.length);

export const coupRuleConfigSchema = z.strictObject({
  rulesetVersion: z.literal(coupFoundationDescriptor.rulesetVersion),
  copiesPerRole: z.number().int().min(1).max(10),
  cardsPerPlayer: z.number().int().min(1).max(3),
  startingCoins: z.number().int().min(0).max(20),
});
export type CoupRuleConfig = Readonly<z.infer<typeof coupRuleConfigSchema>> & RuleConfig;

// Intents are defined here; rule validation and event production start in 10B/10C.
const bare = <T extends string>(type: T) => z.strictObject({ type: z.literal(type) });
const targeted = <T extends string>(type: T) =>
  z.strictObject({ type: z.literal(type), targetId: playerId });
export const coupCommandSchema = z.discriminatedUnion("type", [
  bare("DECLARE_INCOME"),
  bare("DECLARE_FOREIGN_AID"),
  targeted("DECLARE_COUP"),
  bare("DECLARE_TAX"),
  targeted("DECLARE_STEAL"),
  targeted("DECLARE_ASSASSINATION"),
  bare("DECLARE_EXCHANGE"),
  bare("CHALLENGE"),
  z.strictObject({ type: z.literal("BLOCK"), role: roleSchema }),
  bare("PASS_CHALLENGE"),
  bare("PASS_BLOCK"),
  z.strictObject({ type: z.literal("SELECT_CARD_TO_LOSE"), cardIndex: z.number().int().min(0) }),
  z.strictObject({
    type: z.literal("SELECT_EXCHANGE"),
    cardIndices: z.array(z.number().int().min(0)).min(1).max(3),
  }),
]);
export type CoupCommand = z.infer<typeof coupCommandSchema>;

// Internal event payloads may contain private data and are never client projections.
export const coupEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("TURN_STARTED"),
    playerId,
    turnNumber: z.number().int().min(1),
  }),
  z.strictObject({
    type: z.literal("ACTION_DECLARED"),
    playerId,
    action: z.enum(["INCOME", "FOREIGN_AID", "COUP", "TAX", "STEAL", "ASSASSINATION", "EXCHANGE"]),
    targetId: playerId.optional(),
  }),
  z.strictObject({ type: z.literal("COINS_CHANGED"), playerId, delta: z.number().int() }),
  z.strictObject({
    type: z.literal("INFLUENCE_LOST"),
    playerId,
    cardIndex: z.number().int().min(0),
    role: roleSchema,
  }),
  z.strictObject({
    type: z.literal("GAME_ENDED"),
    winnerId: playerId,
    reason: z.string().min(1).max(64),
  }),
]);
export type CoupEvent = z.infer<typeof coupEventSchema>;

export interface CoupState {
  readonly engineVersion: string;
  readonly stateSchemaVersion: 1;
  readonly rulesetVersion: string;
  readonly phase: "WAITING_FOR_ACTION";
  readonly createdAt: number;
  readonly turnNumber: 1;
  readonly turnPlayerId: string;
  readonly rules: CoupRuleConfig;
  readonly players: readonly {
    readonly id: string;
    readonly seat: number;
    readonly coins: number;
    readonly influence: readonly CoupRole[];
  }[];
  readonly deck: readonly CoupRole[];
}

export function createCoupInitialState(
  input: unknown,
  deps: { clock: Clock; random: RandomSource; rules: CoupRuleConfig },
): CoupState {
  const { playerIds } = coupInitialInputSchema.parse(input);
  const rules = coupRuleConfigSchema.parse(deps.rules);
  const createdAt = deps.clock.now();
  if (!Number.isSafeInteger(createdAt) || createdAt < 0)
    throw new RangeError("Invalid clock value");
  if (roles.length * rules.copiesPerRole < playerIds.length * rules.cardsPerPlayer)
    throw new RangeError("Insufficient cards for players");

  const cards: CoupRole[] = roles.flatMap((role) =>
    Array.from({ length: rules.copiesPerRole }, () => role),
  );
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const choice = deps.random.nextInt(index + 1);
    if (!Number.isSafeInteger(choice) || choice < 0 || choice > index)
      throw new RangeError("Invalid random value");
    [cards[index], cards[choice]] = [cards[choice]!, cards[index]!];
  }

  const players = playerIds.map((id, seat) =>
    Object.freeze({
      id,
      seat,
      coins: rules.startingCoins,
      influence: Object.freeze(cards.splice(0, rules.cardsPerPlayer)),
    }),
  );
  return Object.freeze({
    engineVersion: coupFoundationDescriptor.engineVersion,
    stateSchemaVersion: 1,
    rulesetVersion: rules.rulesetVersion,
    phase: "WAITING_FOR_ACTION",
    createdAt,
    turnNumber: 1,
    turnPlayerId: players[0]!.id,
    rules: Object.freeze(rules),
    players: Object.freeze(players),
    deck: Object.freeze(cards),
  });
}
