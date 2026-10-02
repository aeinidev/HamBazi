import type { createDatabase } from "@hambazi/database";
import type { PublicNamesRepository } from "../../application/public-names.js";
export function createPublicNamesRepository(
  database: ReturnType<typeof createDatabase>,
): PublicNamesRepository {
  const scope = database.forModule("users");
  return {
    find: (ids) =>
      scope.execute(async (db) => {
        const rows = await db.user.findMany({
          where: { id: { in: [...ids] }, status: "ACTIVE" },
          select: { id: true, displayName: true },
        });
        return rows.map((row) => ({ userId: row.id, displayName: row.displayName }));
      }),
  };
}
