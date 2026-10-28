import { adminActionSchema, adminGrantsSchema } from "@hambazi/validation";
import type { ScopedClient } from "@hambazi/database";
import type {
  AdminManagementTransaction,
  AdminOperation,
  AdminRole,
} from "../../application/management-ports.js";
import type { AdminSessionRecord } from "../../application/ports.js";

type Client = ScopedClient<"admin">;

export function createAdminManagementTransaction(
  db: Pick<
    Client,
    | "adminOperator"
    | "adminRole"
    | "adminOperatorRole"
    | "adminGrant"
    | "adminSession"
    | "adminRealm"
    | "adminOperation"
    | "adminAuditEvent"
  >,
  realmId: string,
): AdminManagementTransaction {
  function role(row: {
    id: string;
    realmId: string;
    name: string;
    version: number;
    grantsJsonb: unknown;
  }): AdminRole {
    return {
      id: row.id,
      realmId: row.realmId,
      name: row.name,
      version: row.version,
      grants: adminGrantsSchema.parse(row.grantsJsonb),
    };
  }
  function operation(
    row: NonNullable<Awaited<ReturnType<typeof db.adminOperation.findFirst>>>,
  ): AdminOperation {
    if (
      !["PENDING", "APPROVED", "SUCCEEDED", "FAILED", "UNKNOWN"].includes(row.state) ||
      (row.mode !== null && row.mode !== "OWNER_FINAL" && row.mode !== "DUAL_CONTROL")
    )
      throw new Error("ADMIN_OPERATION_INVALID");
    return {
      ...row,
      action: adminActionSchema.parse(row.action),
      state: row.state as AdminOperation["state"],
      mode: row.mode as AdminOperation["mode"],
    };
  }
  return {
    operators: (cursor) =>
      db.adminOperator.findMany({
        where: { realmId, id: { gt: cursor ?? "00000000-0000-0000-0000-000000000000" } },
        orderBy: { id: "asc" },
        take: 51,
      }),
    usernameExists: async (username) =>
      !!(await db.adminOperator.findUnique({
        where: { realmId_username: { realmId, username } },
        select: { id: true },
      })),
    roles: async () =>
      (await db.adminRole.findMany({ where: { realmId }, orderBy: { id: "asc" }, take: 101 })).map(
        role,
      ),
    roleMemberCounts: async () =>
      Object.fromEntries(
        (
          await db.adminOperatorRole.groupBy({
            by: ["roleId"],
            where: { realmId },
            _count: { operatorId: true },
          })
        ).map((r) => [r.roleId, r._count.operatorId]),
      ),
    roleIds: async (operatorId) =>
      (
        await db.adminOperatorRole.findMany({
          where: { operatorId, realmId },
          take: 17,
          select: { roleId: true },
        })
      ).map((r) => r.roleId),
    directGrants: async (operatorId) =>
      (await db.adminGrant.findMany({ where: { operatorId, realmId }, take: 129 })).map((r) => ({
        permission: r.permission,
        environment: r.environment,
        gameIds: r.allGames ? null : r.gameIds,
        deny: r.deny,
      })),
    async setAccess(operatorId, roleIds, grants) {
      await db.adminOperatorRole.deleteMany({ where: { operatorId, realmId } });
      await db.adminGrant.deleteMany({ where: { operatorId, realmId } });
      for (const roleId of roleIds)
        await db.adminOperatorRole.create({ data: { operatorId, roleId, realmId } });
      for (const g of grants)
        await db.adminGrant.create({
          data: {
            id: crypto.randomUUID(),
            realmId,
            operatorId,
            permission: g.permission,
            environment: g.environment,
            allGames: g.gameIds === null,
            gameIds: g.gameIds === null ? [] : [...g.gameIds],
            deny: g.deny,
          },
        });
    },
    async saveRole(value) {
      const grantsJsonb = adminGrantsSchema.parse(value.grants);
      if (value.version === 1)
        await db.adminRole.create({
          data: { id: value.id, realmId, name: value.name, version: value.version, grantsJsonb },
        });
      else {
        const changed = await db.adminRole.updateMany({
          where: { id: value.id, realmId, version: value.version - 1 },
          data: { name: value.name, version: value.version, grantsJsonb },
        });
        if (changed.count !== 1) throw new Error("ADMIN_ROLE_CONFLICT");
      }
    },
    async deleteRole(id) {
      await db.adminOperatorRole.deleteMany({ where: { roleId: id, realmId } });
      await db.adminRole.deleteMany({ where: { id, realmId } });
    },
    async advancePolicy() {
      await db.adminRealm.update({
        where: { id: realmId },
        data: { policyRevision: { increment: 1 } },
      });
    },
    // shortcut: sessions, activity and operations show the latest 50; add cursors when historical review is required.
    sessions: (operatorId) =>
      db.adminSession.findMany({
        where: { operatorId, realmId },
        orderBy: { issuedAt: "desc" },
        take: 50,
      }) as Promise<AdminSessionRecord[]>,
    operation: async (id) => {
      const row = await db.adminOperation.findFirst({ where: { id, realmId } });
      return row ? operation(row) : null;
    },
    async saveOperation(value) {
      const data = { ...value, action: adminActionSchema.parse(value.action) };
      const exists = await db.adminOperation.findFirst({
        where: { id: value.id, realmId },
        select: { id: true },
      });
      // Never use ID-only ON CONFLICT updates: an ID may belong to another realm.
      if (!exists)
        await db.adminOperation.create({
          data: {
            id: data.id,
            realmId,
            actorId: data.actorId,
            sessionId: data.sessionId,
            authorizationVersion: data.authorizationVersion,
            credentialVersion: data.credentialVersion,
            sessionEpoch: data.sessionEpoch,
            policyRevision: data.policyRevision,
            ownershipEpoch: data.ownershipEpoch,
            environment: data.environment,
            digest: data.digest,
            action: data.action,
            gameId: data.gameId,
            privateNoteCiphertext: data.privateNoteCiphertext ?? null,
            reasonCode: data.reasonCode,
            state: data.state,
            mode: data.mode,
            approverId: data.approverId,
            approverSessionId: data.approverSessionId,
            approverAuthorizationVersion: data.approverAuthorizationVersion,
            approverSessionEpoch: data.approverSessionEpoch,
            approverCredentialVersion: data.approverCredentialVersion,
            createdAt: data.createdAt,
            expiresAt: data.expiresAt,
            approvedUntil: data.approvedUntil,
            resultCode: data.resultCode,
          },
        });
      else {
        const changed = await db.adminOperation.updateMany({
          where: { id: value.id, realmId },
          data: {
            id: data.id,
            realmId,
            actorId: data.actorId,
            sessionId: data.sessionId,
            authorizationVersion: data.authorizationVersion,
            credentialVersion: data.credentialVersion,
            sessionEpoch: data.sessionEpoch,
            policyRevision: data.policyRevision,
            ownershipEpoch: data.ownershipEpoch,
            environment: data.environment,
            digest: data.digest,
            action: data.action,
            gameId: data.gameId,
            privateNoteCiphertext: data.privateNoteCiphertext ?? null,
            reasonCode: data.reasonCode,
            state: data.state,
            mode: data.mode,
            approverId: data.approverId,
            approverSessionId: data.approverSessionId,
            approverAuthorizationVersion: data.approverAuthorizationVersion,
            approverSessionEpoch: data.approverSessionEpoch,
            approverCredentialVersion: data.approverCredentialVersion,
            createdAt: data.createdAt,
            expiresAt: data.expiresAt,
            approvedUntil: data.approvedUntil,
            resultCode: data.resultCode,
          },
        });
        if (changed.count !== 1) throw new Error("ADMIN_OPERATION_CONFLICT");
      }
    },
    operations: async (actorId) =>
      (
        await db.adminOperation.findMany({
          where: { realmId, actorId: actorId ?? { not: "00000000-0000-0000-0000-000000000000" } },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      ).map(operation),
    unknownOperations: async (cursor) =>
      (
        await db.adminOperation.findMany({
          where: {
            realmId,
            state: "UNKNOWN",
            id: { gt: cursor ?? "00000000-0000-0000-0000-000000000000" },
          },
          orderBy: { id: "asc" },
          take: 25,
        })
      ).map(operation),
    async activity(operatorId) {
      const rows = await db.adminAuditEvent.findMany({
        where: { realmId, OR: [{ operatorId }, { targetId: operatorId }] },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 50,
        select: {
          id: true,
          operatorId: true,
          commandId: true,
          event: true,
          operation: true,
          targetId: true,
          reasonCode: true,
          mode: true,
          occurredAt: true,
        },
      });
      return {
        schemaVersion: 1,
        items: rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() })),
      };
    },
  };
}
