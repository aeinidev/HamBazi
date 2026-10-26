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
export async function adminFixture() {
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
    realmId: "synthetic",
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
  } = {
    realm: null,
    operators: new Map(),
    sessions: new Map(),
    receipts: new Map(),
    audit: [],
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
        async grants() {
          return [];
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
          state.realm = { id: "synthetic", ownerId: null, ownershipEpoch: 0, policyRevision: 1 };
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
      realmId: "synthetic",
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
    realmId: "synthetic",
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
