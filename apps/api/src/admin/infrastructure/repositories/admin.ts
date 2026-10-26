import type { createDatabase } from "@hambazi/database";
import type {
  AdminRepository,
  AdminSessionRecord,
  AdminTransaction,
} from "../../application/ports.js";

export function createAdminRepository(
  database: ReturnType<typeof createDatabase>,
  realmId: string,
): AdminRepository & { auditPage(): Promise<unknown> } {
  const scope = database.forModule("admin");
  return Object.freeze({
    async auditPage() {
      const rows = await scope.execute((db) =>
        db.adminAuditEvent.findMany({
          where: { realmId },
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          take: 50,
          select: { id: true, event: true, occurredAt: true },
        }),
      );
      return {
        schemaVersion: 1,
        asOf: new Date().toISOString(),
        items: rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() })),
      };
    },
    findUsername: (username: string) =>
      scope.execute((db) =>
        db.adminOperator.findUnique({ where: { realmId_username: { realmId, username } } }),
      ),
    findSession: (id: string) =>
      scope.execute((db) =>
        db.adminSession.findFirst({ where: { id, realmId } }),
      ) as Promise<AdminSessionRecord | null>,
    atomic: <T>(operation: (tx: AdminTransaction) => Promise<T>) =>
      scope.transaction(async (db) => {
        await db.lockAdminRealm(realmId);
        const tx: AdminTransaction = {
          realm: () => db.adminRealm.findUnique({ where: { id: realmId } }),
          operator: (id) => db.adminOperator.findFirst({ where: { id, realmId } }),
          session: (id) =>
            db.adminSession.findFirst({
              where: { id, realmId },
            }) as Promise<AdminSessionRecord | null>,
          receipt: (operatorId, commandId) =>
            db.adminAuthReceipt.findUnique({
              where: { operatorId_commandId: { operatorId, commandId } },
            }),
          async grants(operatorId) {
            const rows = await db.adminGrant.findMany({
              where: { operatorId, realmId },
              take: 257,
            });
            if (rows.length > 256) throw new Error("ADMIN_GRANT_LIMIT_EXCEEDED");
            return rows.map((row) => ({
              permission: row.permission,
              environment: row.environment,
              gameIds: row.allGames ? null : row.gameIds,
              deny: row.deny,
            }));
          },
          async createSession(record) {
            await db.adminSession.create({
              data: {
                id: record.id,
                realmId: record.realmId,
                operatorId: record.operatorId,
                kind: record.kind,
                credentialVersion: record.credentialVersion,
                sessionEpoch: record.sessionEpoch,
                issuedAt: record.issuedAt,
                expiresAt: record.expiresAt,
                lastSeenAt: record.lastSeenAt,
                revokedAt: record.revokedAt,
              },
            });
          },
          async updateSession(id, patch) {
            const old = await db.adminSession.findUniqueOrThrow({ where: { id } });
            await db.adminSession.update({
              where: { id },
              data: {
                lastSeenAt: patch.lastSeenAt ?? old.lastSeenAt,
                revokedAt: patch.revokedAt === undefined ? old.revokedAt : patch.revokedAt,
              },
            });
          },
          async updateOperator(id, patch) {
            const old = await db.adminOperator.findUniqueOrThrow({ where: { id } });
            await db.adminOperator.update({
              where: { id },
              data: {
                pinFailures: patch.pinFailures ?? old.pinFailures,
                lockedAt: patch.lockedAt === undefined ? old.lockedAt : patch.lockedAt,
                sessionEpoch: patch.sessionEpoch ?? old.sessionEpoch,
                pinVerifier: patch.pinVerifier === undefined ? old.pinVerifier : patch.pinVerifier,
                credentialVersion: patch.credentialVersion ?? old.credentialVersion,
              },
            });
          },
          async createOperator(record) {
            await db.adminOperator.create({
              data: {
                id: record.id,
                realmId: record.realmId,
                username: record.username,
                passwordVerifier: record.passwordVerifier,
                pinVerifier: record.pinVerifier,
                credentialVersion: record.credentialVersion,
                sessionEpoch: record.sessionEpoch,
                authorizationVersion: record.authorizationVersion,
                status: record.status,
                pinFailures: record.pinFailures,
                lockedAt: record.lockedAt,
              },
            });
          },
          async bindOwner(id) {
            await db.adminRealm.update({
              where: { id: realmId },
              data: { ownerId: id, ownershipEpoch: { increment: 1 } },
            });
          },
          async advanceOwnership() {
            await db.adminRealm.update({
              where: { id: realmId },
              data: { ownershipEpoch: { increment: 1 } },
            });
          },
          async createRealm() {
            await db.adminRealm.create({ data: { id: realmId } });
          },
          async saveReceipt(record) {
            await db.adminAuthReceipt.create({
              data: {
                operatorId: record.operatorId,
                commandId: record.commandId,
                digest: record.digest,
                outcome: record.outcome,
                sessionId: record.sessionId,
              },
            });
          },
          async audit(record) {
            await db.adminAuditEvent.create({
              data: {
                id: record.id,
                realmId: record.realmId,
                operatorId: record.operatorId,
                event: record.event,
                commandId: record.commandId,
                occurredAt: record.occurredAt,
              },
            });
          },
        };
        return operation(tx);
      }),
  });
}
