import type { createDatabase } from "@hambazi/database";
import type { SessionRepository } from "../../application/session-ports.js";
import type { SessionRecord } from "../../domain/session.js";

type StoredSession = Omit<SessionRecord, "issuedAt" | "expiresAt" | "revokedAt"> & {
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};
function map(row: StoredSession): SessionRecord {
  return Object.freeze({
    id: row.id,
    userId: row.userId,
    commandId: row.commandId,
    schemaVersion: row.schemaVersion,
    keyId: row.keyId,
    issuer: row.issuer,
    audience: row.audience,
    issuedAt: row.issuedAt.getTime() / 1000,
    expiresAt: row.expiresAt.getTime() / 1000,
    revokedAt: row.revokedAt === null ? null : row.revokedAt.getTime() / 1000,
  });
}

export function createSessionRepository(
  database: ReturnType<typeof createDatabase>,
): SessionRepository {
  const scope = database.forModule("auth");
  return Object.freeze({
    async createOrGet(candidate: SessionRecord) {
      return scope.transaction(async (db) => {
        // PostgreSQL INSERT ON CONFLICT DO NOTHING waits for a concurrent winner.
        // The following READ COMMITTED statement then sees that committed row.
        await db.session.createMany({
          data: [
            {
              id: candidate.id,
              userId: candidate.userId,
              commandId: candidate.commandId,
              schemaVersion: candidate.schemaVersion,
              keyId: candidate.keyId,
              issuer: candidate.issuer,
              audience: candidate.audience,
              issuedAt: new Date(candidate.issuedAt * 1000),
              expiresAt: new Date(candidate.expiresAt * 1000),
              revokedAt: null,
            },
          ],
          skipDuplicates: true,
        });
        const row = await db.session.findUniqueOrThrow({
          where: {
            userId_commandId: { userId: candidate.userId, commandId: candidate.commandId },
          },
        });
        return map(row);
      });
    },
    async find(id: string) {
      const row = await scope.execute((db) => db.session.findUnique({ where: { id } }));
      return row ? map(row) : undefined;
    },
    async revoke(id: string, userId: string, now: number) {
      await scope.execute((db) =>
        db.session.updateMany({
          where: { id, userId, revokedAt: null },
          data: { revokedAt: new Date(now * 1000) },
        }),
      );
    },
  });
}
