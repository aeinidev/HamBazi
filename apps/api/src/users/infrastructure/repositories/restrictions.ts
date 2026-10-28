import type { createDatabase } from "@hambazi/database";

/** Expiry uses the same user lock as moderation; a stale job cannot lift a newer restriction. */
export function createRestrictionExpiry(
  database: ReturnType<typeof createDatabase>,
  clock: { nowMs(): number },
) {
  const scope = database.forModule("users");
  async function expire(userId: string) {
    return scope.transaction(async (db) => {
      await db.lockAdminEffect(userId);
      const now = new Date(clock.nowMs());
      const active = await db.userRestriction.findFirst({
        where: { userId, endedAt: null, expiresAt: { lte: now } },
      });
      if (!active) return 0;
      const changed = await db.user.updateMany({
        where: { id: userId, status: "BANNED" },
        data: { status: "ACTIVE", authVersion: { increment: 1 }, profileVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw new Error("USER_RESTRICTION_CONFLICT");
      await db.userRestriction.update({
        where: { id: active.id },
        data: { endedAt: now, endKind: "EXPIRED" },
      });
      return 1;
    });
  }
  return {
    expire,
    async batch(limit: number) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("INVALID_INPUT");
      const due = await scope.execute((db) =>
        db.userRestriction.findMany({
          where: { endedAt: null, expiresAt: { lte: new Date(clock.nowMs()) } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          take: limit,
          select: { userId: true },
        }),
      );
      let count = 0;
      for (const row of due) count += await expire(row.userId);
      return count;
    },
  };
}
