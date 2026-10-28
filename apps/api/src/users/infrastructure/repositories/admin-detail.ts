import type { createDatabase } from "@hambazi/database";
export function createUsersAdminDetailRepository(database: ReturnType<typeof createDatabase>) {
  const scope = database.forModule("users");
  return {
    async profile(id: string) {
      const row = await scope.execute((db) =>
        db.user.findUnique({
          where: { id },
          select: {
            id: true,
            displayName: true,
            publicHandle: true,
            status: true,
            profileVersion: true,
            createdAt: true,
            registrationCompletedAt: true,
          },
        }),
      );
      return row
        ? {
            schemaVersion: 1 as const,
            ...row,
            createdAt: row.createdAt.toISOString(),
            registrationCompletedAt: row.registrationCompletedAt?.toISOString() ?? null,
          }
        : null;
    },
    async restrictions(userId: string, cursor?: string, limit = 25) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50)
        throw new Error("ADMIN_READ_INVALID");
      const rows = await scope.execute((db) =>
        db.userRestriction.findMany({
          where: { userId, id: { gt: cursor ?? "00000000-0000-0000-0000-000000000000" } },
          orderBy: { id: "asc" },
          take: limit + 1,
        }),
      );
      const active = await scope.execute((db) =>
        db.userRestriction.findFirst({
          where: { userId, endedAt: null },
          select: { id: true, expiresAt: true },
        }),
      );
      return {
        schemaVersion: 1 as const,
        active: active
          ? { id: active.id, expiresAt: active.expiresAt?.toISOString() ?? null }
          : null,
        items: rows.slice(0, limit).map((r) => ({
          id: r.id,
          reasonCode: r.reasonCode,
          duration: r.duration,
          createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt?.toISOString() ?? null,
          endedAt: r.endedAt?.toISOString() ?? null,
          endKind: r.endKind,
          endedByOperationId: r.endedByOperationId,
        })),
        nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
      };
    },
  };
}
