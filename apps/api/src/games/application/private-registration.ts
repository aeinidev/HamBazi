import { z } from "zod";
import { createErrorEnvelope } from "@hambazi/contracts";
import {
  gameSchema,
  type CatalogGame,
  type CatalogPort,
  type CatalogRepository,
} from "./catalog.js";
const stored = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  minPlayers: z.number().int(),
  maxPlayers: z.number().int(),
  status: z.literal("DISABLED"),
  adminAvailability: z.enum(["ACTIVE", "MAINTENANCE", "DISABLED"]).optional(),
  configSchemaVersion: z.literal(1),
  configJsonb: z.strictObject({}),
});
/** An explicit private capability never changes durable/public Game status. */
export function privateRegistrationService(
  repository: CatalogRepository,
  registration: CatalogGame,
): CatalogPort {
  const game = gameSchema.parse(registration);
  async function find(input: unknown) {
    if (input !== game.slug) return createErrorEnvelope("NOT_FOUND");
    try {
      const row = stored.parse(await repository.find(game.slug));
      if (
        row.id !== game.id ||
        row.slug !== game.slug ||
        row.title !== game.title ||
        row.minPlayers !== game.minPlayers ||
        row.maxPlayers < game.maxPlayers
      )
        return createErrorEnvelope("INTERNAL_ERROR");
      return {
        ok: true as const,
        game:
          row.adminAvailability && row.adminAvailability !== "ACTIVE"
            ? { ...game, playable: false, status: row.adminAvailability }
            : game,
      };
    } catch {
      return createErrorEnvelope("INTERNAL_ERROR");
    }
  }
  return Object.freeze({
    find,
    async list() {
      const r = await find(game.slug);
      return r.ok ? { ok: true as const, games: [r.game] } : createErrorEnvelope("INTERNAL_ERROR");
    },
  });
}
