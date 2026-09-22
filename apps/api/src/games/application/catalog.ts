import { z } from "zod";

export const slugSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const storedSchema = z.strictObject({
  id: z.literal("coup"),
  slug: z.literal("coup"),
  title: z.literal("Coup"),
  minPlayers: z.literal(2),
  maxPlayers: z.literal(6),
  matchmakingEnabled: z.boolean(),
  privateRoomsEnabled: z.boolean(),
  chatEnabled: z.boolean(),
  voiceEnabled: z.literal(false),
  status: z.enum(["ACTIVE", "MAINTENANCE", "DISABLED"]),
  configSchemaVersion: z.literal(1),
  configJsonb: z.strictObject({}),
});
export const gameSchema = z.strictObject({
  id: z.string().min(1),
  slug: slugSchema,
  title: z.string().min(1),
  minPlayers: z.number().int().min(2),
  maxPlayers: z.number().int().min(2),
  status: z.enum(["ACTIVE", "MAINTENANCE", "DISABLED"]),
  playable: z.boolean(),
  readiness: z.enum(["NOT_IMPLEMENTED"]),
  descriptor: z.null(),
  matchmakingEnabled: z.boolean(),
  privateRoomsEnabled: z.boolean(),
  chatEnabled: z.boolean(),
  voiceEnabled: z.boolean(),
});
export type CatalogGame = z.infer<typeof gameSchema>;
export interface CatalogRepository {
  list(): Promise<unknown[]>;
  find(slug: string): Promise<unknown | null>;
}
type Failure = { ok: false; error: { code: "INVALID_INPUT" | "NOT_FOUND" | "INTERNAL_ERROR" } };
function project(raw: unknown): CatalogGame {
  const game = storedSchema.parse(raw);
  return {
    id: game.id,
    slug: game.slug,
    title: game.title,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    status: game.status,
    playable: false,
    readiness: "NOT_IMPLEMENTED",
    descriptor: null,
    matchmakingEnabled: false,
    privateRoomsEnabled: false,
    chatEnabled: false,
    voiceEnabled: false,
  };
}
const failure = (code: Failure["error"]["code"]): Failure => ({ ok: false, error: { code } });
export function catalogService(repository: CatalogRepository) {
  return {
    async list(): Promise<{ ok: true; games: CatalogGame[] } | Failure> {
      try {
        const rows = await repository.list();
        // Missing baseline is an unavailable registry, not a successful empty catalog.
        if (rows.length !== 1) return failure("INTERNAL_ERROR");
        return { ok: true, games: rows.map(project) };
      } catch {
        return failure("INTERNAL_ERROR");
      }
    },
    async find(input: unknown): Promise<{ ok: true; game: CatalogGame } | Failure> {
      const slug = slugSchema.safeParse(input);
      if (!slug.success) return failure("INVALID_INPUT");
      try {
        const row = await repository.find(slug.data);
        if (row === null) return failure(slug.data === "coup" ? "INTERNAL_ERROR" : "NOT_FOUND");
        const game = project(row);
        if (game.slug !== slug.data) return failure("INTERNAL_ERROR");
        return { ok: true, game };
      } catch {
        return failure("INTERNAL_ERROR");
      }
    },
  };
}
export type CatalogPort = ReturnType<typeof catalogService>;
