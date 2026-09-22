import type { createDatabase } from "@hambazi/database";
import type { CatalogRepository } from "../../application/catalog.js";
export function createCatalogRepository(
  database: ReturnType<typeof createDatabase>,
): CatalogRepository {
  const scoped = database.forModule("games");
  return {
    list: () =>
      scoped.execute((db) =>
        db.game.findMany({
          where: { id: "coup" },
          orderBy: { slug: "asc" },
          select: {
            id: true,
            slug: true,
            title: true,
            minPlayers: true,
            maxPlayers: true,
            matchmakingEnabled: true,
            privateRoomsEnabled: true,
            chatEnabled: true,
            voiceEnabled: true,
            status: true,
            configSchemaVersion: true,
            configJsonb: true,
          },
        }),
      ),
    find: (slug) =>
      scoped.execute((db) =>
        db.game.findUnique({
          where: { slug, id: "coup" },
          select: {
            id: true,
            slug: true,
            title: true,
            minPlayers: true,
            maxPlayers: true,
            matchmakingEnabled: true,
            privateRoomsEnabled: true,
            chatEnabled: true,
            voiceEnabled: true,
            status: true,
            configSchemaVersion: true,
            configJsonb: true,
          },
        }),
      ),
  };
}
