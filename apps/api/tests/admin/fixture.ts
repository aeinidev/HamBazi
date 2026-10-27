import { createAdminManagement } from "../../src/admin/application/management.js";
import type {
  AdminRole,
  AdminOperation,
  AdminProductPort,
} from "../../src/admin/application/management-ports.js";
import type { AdminGrant } from "../../src/admin/domain/access.js";
import type { AdminAction } from "@hambazi/validation";
import { randomUUID } from "node:crypto";
import { createAdminCrypto } from "../../src/admin/infrastructure/crypto.js";
import { createAdminService } from "../../src/admin/application/service.js";
import { createAdminProvisioning } from "../../src/admin/application/provisioning.js";
import type {
  AdminAudit,
  AdminOperatorRecord,
  AdminRepository,
  AdminSessionRecord,
  AdminReceipt,
  AdminRealmRecord,
  AdminTransaction,
} from "../../src/admin/application/ports.js";

export const password = "SyntheticPassword123";
export const ownerPin = "012345";
export async function adminFixture(
  options: { realmId?: string; recoveryPasswordRequired?: boolean } = {},
) {
  const realmId = options.realmId ?? "synthetic";
  const clock = {
    value: Date.UTC(2026, 9, 25),
    nowMs() {
      return this.value;
    },
  };
  const crypto = createAdminCrypto({
    signingKey: { reveal: () => Buffer.alloc(32, 11).toString("base64url") },
    pinPepper: { reveal: () => Buffer.alloc(32, 22).toString("base64url") },
    commandKey: { reveal: () => Buffer.alloc(32, 33).toString("base64url") },
    issuer: "urn:hambazi:synthetic:admin",
    audience: "urn:hambazi:synthetic:console",
    realmId,
    clock,
    memoryCost: 19456,
    timeCost: 2,
  });
  let state: {
    realm: AdminRealmRecord | null;
    operators: Map<string, AdminOperatorRecord>;
    sessions: Map<string, AdminSessionRecord>;
    receipts: Map<string, AdminReceipt>;
    audit: AdminAudit[];
    roles: Map<string, AdminRole>;
    roleIds: Map<string, string[]>;
    grants: Map<string, AdminGrant[]>;
    operations: Map<string, AdminOperation>;
  } = {
    realm: null,
    operators: new Map(),
    sessions: new Map(),
    receipts: new Map(),
    audit: [],
    roles: new Map(),
    roleIds: new Map(),
    grants: new Map(),
    operations: new Map(),
  };
  let tail = Promise.resolve();
  let failAudit = false;
  const repository: AdminRepository = {
    async findUsername(username) {
      return structuredClone(
        [...state.operators.values()].find((v) => v.username === username) ?? null,
      );
    },
    async findSession(id) {
      return structuredClone(state.sessions.get(id) ?? null);
    },
    async atomic(operation) {
      const previous = tail;
      let unlock!: () => void;
      tail = new Promise((resolve) => {
        unlock = resolve;
      });
      await previous;
      const before = structuredClone(state);
      const tx: AdminTransaction = {
        async realm() {
          return structuredClone(state.realm);
        },
        async operator(id) {
          return structuredClone(state.operators.get(id) ?? null);
        },
        async session(id) {
          return structuredClone(state.sessions.get(id) ?? null);
        },
        async receipt(operatorId, commandId) {
          return structuredClone(state.receipts.get(operatorId + commandId) ?? null);
        },
        async grants(id) {
          return structuredClone([
            ...(state.grants.get(id) ?? []),
            ...[...state.roles.values()]
              .filter((r) => state.roleIds.get(id)?.includes(r.id))
              .flatMap((r) => r.grants),
          ]);
        },
        management: {
          async operators(cursor) {
            return structuredClone(
              [...state.operators.values()]
                .filter((o) => !cursor || o.id > cursor)
                .sort((a, b) => a.id.localeCompare(b.id))
                .slice(0, 51),
            );
          },
          async roles() {
            return structuredClone([...state.roles.values()]);
          },
          async roleMemberCounts() {
            const counts: Record<string, number> = {};
            for (const ids of state.roleIds.values())
              for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
            return counts;
          },
          async usernameExists(username) {
            return [...state.operators.values()].some((o) => o.username === username);
          },
          async roleIds(id) {
            return structuredClone(state.roleIds.get(id) ?? []);
          },
          async directGrants(id) {
            return structuredClone(state.grants.get(id) ?? []);
          },
          async setAccess(id, roles, grants) {
            state.roleIds.set(id, structuredClone(roles));
            state.grants.set(id, structuredClone(grants));
          },
          async saveRole(role) {
            state.roles.set(role.id, structuredClone(role));
          },
          async deleteRole(id) {
            state.roles.delete(id);
            for (const [operator, roles] of state.roleIds)
              state.roleIds.set(
                operator,
                roles.filter((r) => r !== id),
              );
          },
          async advancePolicy() {
            state.realm!.policyRevision++;
          },
          async sessions(id) {
            return structuredClone([...state.sessions.values()].filter((s) => s.operatorId === id));
          },
          async operation(id) {
            return structuredClone(state.operations.get(id) ?? null);
          },
          async saveOperation(op) {
            state.operations.set(op.id, structuredClone(op));
          },
          async operations(id) {
            return structuredClone(
              [...state.operations.values()]
                .filter((o) => !id || o.actorId === id)
                .slice(-50)
                .reverse(),
            );
          },
          async unknownOperations() {
            return structuredClone(
              [...state.operations.values()].filter((o) => o.state === "UNKNOWN").slice(0, 25),
            );
          },
          async activity(id) {
            return {
              schemaVersion: 1,
              items: state.audit
                .filter((a) => a.operatorId === id || a.targetId === id)
                .slice(-50)
                .reverse()
                .map((a) => ({
                  ...a,
                  operation: a.operation ?? null,
                  targetId: a.targetId ?? null,
                  reasonCode: a.reasonCode ?? null,
                  mode: a.mode ?? null,
                  occurredAt: a.occurredAt.toISOString(),
                })),
            };
          },
        },
        async createSession(row) {
          state.sessions.set(row.id, structuredClone(row));
        },
        async updateSession(id, patch) {
          state.sessions.set(id, { ...state.sessions.get(id)!, ...structuredClone(patch) });
        },
        async updateOperator(id, patch) {
          state.operators.set(id, { ...state.operators.get(id)!, ...structuredClone(patch) });
        },
        async createOperator(row) {
          state.operators.set(row.id, structuredClone(row));
        },
        async bindOwner(id) {
          state.realm = {
            ...state.realm!,
            ownerId: id,
            ownershipEpoch: state.realm!.ownershipEpoch + 1,
          };
        },
        async advanceOwnership() {
          state.realm!.ownershipEpoch++;
        },
        async createRealm() {
          state.realm = { id: realmId, ownerId: null, ownershipEpoch: 0, policyRevision: 1 };
        },
        async saveReceipt(row) {
          state.receipts.set(row.operatorId + row.commandId, structuredClone(row));
        },
        async audit(row) {
          if (failAudit) throw new Error("SYNTHETIC_AUDIT_OUTAGE");
          state.audit.push(structuredClone(row));
        },
      };
      try {
        return await operation(tx);
      } catch (e) {
        state = before;
        throw e;
      } finally {
        unlock();
      }
    },
  };
  const service = createAdminService({
    repository,
    crypto,
    clock,
    newId: randomUUID,
    policy: {
      realmId,
      environment: "test",
      sessionSeconds: 900,
      idleSeconds: 300,
      pendingSeconds: 120,
      maxCryptoInFlight: 2,
    },
    dummyPasswordVerifier: await crypto.hash("SyntheticUnknownPassword", "password"),
  });
  const provisioning = createAdminProvisioning({
    repository,
    crypto,
    clock,
    newId: randomUUID,
    realmId,
    ...(options.recoveryPasswordRequired === undefined
      ? {}
      : { recoveryPasswordRequired: options.recoveryPasswordRequired }),
    verifyAuthority: async (input) => input === "synthetic-verified-authority",
  });
  const enroll = () =>
    provisioning.run(
      {
        schemaVersion: 1,
        commandId: randomUUID(),
        username: "owner_fixture",
        password,
        pin: ownerPin,
        reasonCode: "INITIAL_OWNER_ENROLLMENT",
        confirmed: true,
      },
      "synthetic-verified-authority",
    );
  return {
    crypto,
    clock,
    repository,
    service,
    management(products: Partial<Record<AdminAction["operation"], AdminProductPort>> = {}) {
      return createAdminManagement({
        repository,
        service,
        crypto,
        clock,
        newId: randomUUID,
        products,
        policy: {
          realmId,
          environment: "test",
          sessionSeconds: 900,
          idleSeconds: 300,
          pendingSeconds: 120,
          maxCryptoInFlight: 2,
        },
      });
    },
    provisioning,
    enroll,
    get state() {
      return state;
    },
    failAudit() {
      failAudit = true;
    },
    restoreAudit() {
      failAudit = false;
    },
  };
}
