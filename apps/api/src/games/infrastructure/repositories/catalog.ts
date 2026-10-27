import type { createDatabase } from "@hambazi/database";
import type { CatalogRepository } from "../../application/catalog.js";
export function createCatalogRepository(
  database: ReturnType<typeof createDatabase>,
  registeredId = "coup",
): CatalogRepository {
  const scoped = database.forModule("games");
  return {
    list: () =>
      scoped.execute((db) =>
        db.game.findMany({
          where: { id: registeredId },
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
            adminAvailability: true,
            configSchemaVersion: true,
            configJsonb: true,
          },
        }),
      ),
    find: (slug) =>
      scoped.execute((db) =>
        db.game.findUnique({
          where: { slug, id: registeredId },
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
            adminAvailability: true,
            configSchemaVersion: true,
            configJsonb: true,
          },
        }),
      ),
  };
}
