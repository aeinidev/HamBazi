import { z } from "zod";

const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const version = z.string().min(1).max(64);

export const gameManifestSchema = z
  .strictObject({
    id: identifier,
    slug: identifier,
    title: z.string().min(1).max(100),
    minPlayers: z.number().int().min(2),
    maxPlayers: z.number().int().min(2).max(64),
    modes: z.array(identifier),
    matchmakingEnabled: z.boolean(),
    privateRoomsEnabled: z.boolean(),
    chatEnabled: z.boolean(),
    voiceEnabled: z.boolean(),
    status: z.enum(["ACTIVE", "MAINTENANCE", "DISABLED"]),
  })
  .refine(
    (value) =>
      value.minPlayers <= value.maxPlayers &&
      new Set(value.modes).size === value.modes.length &&
      (value.status !== "ACTIVE" || value.modes.length > 0),
  );

export const gameVersionDescriptorSchema = z.strictObject({
  engineVersion: version,
  stateSchemaVersion: z.number().int().min(1),
  rulesetVersion: version,
  commandSchemaVersion: z.number().int().min(1),
  eventSchemaVersion: z.number().int().min(1),
});

export type GameManifest = Readonly<Omit<z.infer<typeof gameManifestSchema>, "modes">> & {
  readonly modes: readonly string[];
};
export type GameVersionDescriptor = Readonly<z.infer<typeof gameVersionDescriptorSchema>>;

/** Epoch milliseconds supplied by the server; engines never read ambient time. */
export interface Clock {
  now(): number;
}

/** A server-provided unbiased integer source. Production adapters must use a CSPRNG. */
export interface RandomSource {
  nextInt(upperExclusive: number): number;
}

export interface RuleConfig {
  readonly rulesetVersion: string;
}

export interface StandardGameResult {
  readonly placements: readonly { readonly playerId: string; readonly place: number }[];
  readonly winnerId: string | null;
  readonly reason: string;
  readonly metrics: Readonly<Record<string, number>>;
}

export interface GameEngine<
  State,
  InitialInput,
  Command,
  Event,
  PlayerView,
  Rules extends RuleConfig,
  SpectatorView = never,
> {
  readonly descriptor: GameVersionDescriptor;
  createInitialState(
    input: InitialInput,
    deps: { clock: Clock; random: RandomSource; rules: Rules },
  ): State;
  validateCommand(state: State, command: Command, actorId: string): void;
  execute(
    state: State,
    command: Command,
    actorId: string,
    deps: { clock: Clock; random: RandomSource; rules: Rules },
  ): readonly Event[];
  applyEvent(state: State, event: Event): State;
  getPlayerView(state: State, playerId: string): PlayerView;
  getSpectatorView?(state: State): SpectatorView;
  getResult(state: State): StandardGameResult | null;
  migrateState?(state: unknown, fromVersion: number): State;
}
