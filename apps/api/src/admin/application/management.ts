import { randomInt } from "node:crypto";
import { z } from "zod";
import {
  adminApprovalSchema,
  adminCommandRequestSchema,
  adminDirectorySchema,
  adminCommandResultSchema,
  type AdminAction,
} from "@hambazi/validation";
import {
  adminAccess,
  adminGameScope,
  type AdminPrincipal,
  type AdminGrant,
} from "../domain/access.js";
import {
  AdminFault,
  type AdminRepository,
  type AdminCrypto,
  type AdminPolicy,
  type AdminTransaction,
} from "./ports.js";
import type { AdminOperation, AdminProductPort } from "./management-ports.js";
import type { AdminService } from "./service.js";

export const adminOperationPermissions: Record<
  AdminAction["operation"],
  { write: string; approve: string; view: string }
> = {
  ADMIN_CREATE: { write: "admins.create", approve: "admins.manage", view: "admins.view" },
  ADMIN_STATUS: { write: "admins.manage", approve: "admins.manage", view: "admins.view" },
  ADMIN_RESET_PASSWORD: { write: "admins.manage", approve: "admins.manage", view: "admins.view" },
  ADMIN_ACCESS: { write: "admins.edit", approve: "admins.manage", view: "admins.view" },
  ADMIN_REVOKE_SESSIONS: { write: "admins.manage", approve: "admins.manage", view: "admins.view" },
  ROLE_SAVE: { write: "roles.edit", approve: "roles.manage", view: "roles.view" },
  ROLE_DELETE: { write: "roles.manage", approve: "roles.manage", view: "roles.view" },
  USER_DISPLAY_NAME: { write: "users.edit", approve: "users.approve", view: "users.view" },
  USER_STATUS: { write: "users.manage", approve: "users.approve", view: "users.view" },
  GAME_AVAILABILITY: { write: "games.manage", approve: "games.approve", view: "games.view" },
  ROOM_CLOSE: { write: "rooms.manage", approve: "rooms.approve", view: "rooms.view" },
  MATCH_TERMINATE: { write: "matches.manage", approve: "matches.approve", view: "matches.view" },
};
export const adminRoleTemplates = {
  "Super Admin": [
    "overview.view",
    "users.view",
    "users.edit",
    "users.approve",
    "games.view",
    "games.manage",
    "games.approve",
    "rooms.view",
    "rooms.manage",
    "rooms.approve",
    "matches.view",
    "matches.manage",
    "matches.approve",
    "monitoring.view",
    "audit.view",
  ],
  Moderator: ["users.view", "rooms.view", "rooms.manage", "matches.view"],
  Support: ["users.view", "users.edit", "rooms.view", "matches.view"],
  Operator: [
    "games.view",
    "games.manage",
    "rooms.view",
    "rooms.manage",
    "matches.view",
    "monitoring.view",
  ],
} as const;
export function generateAdminPassword() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (;;) {
    const value = Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join("");
    if (/[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value)) return value;
  }
}
export function createAdminManagement(deps: {
  repository: AdminRepository;
  service: AdminService;
  crypto: AdminCrypto;
  policy: AdminPolicy;
  clock: { nowMs(): number };
  newId(): string;
  products: Partial<Record<AdminAction["operation"], AdminProductPort>>;
}) {
  const { repository, service, crypto, policy, clock, products } = deps;
  const at = () => new Date(clock.nowMs());
  let reconciliationCursor: string | undefined;
  function management(tx: AdminTransaction) {
    if (!tx.management) throw new AdminFault("ADMIN_UNAVAILABLE");
    return tx.management;
  }
  function parse<T>(schema: z.ZodType<T>, value: unknown) {
    const p = schema.safeParse(value);
    if (!p.success) throw new AdminFault("INVALID_INPUT");
    return p.data;
  }
  function permit(p: AdminPrincipal, op: AdminOperation, kind: "write" | "approve" | "view") {
    // Phase-three moderation is unavailable even to OWNER; legacy grants cannot enable it.
    if (kind !== "view" && op.action.operation === "USER_STATUS") throw new AdminFault("FORBIDDEN");
    if (
      !adminAccess(p, adminOperationPermissions[op.action.operation][kind], op.gameId ?? undefined)
    )
      throw new AdminFault("FORBIDDEN");
  }
  async function principal(tx: AdminTransaction, operatorId: string) {
    const o = await tx.operator(operatorId),
      r = await tx.realm();
    if (!o || !r || o.status !== "ACTIVE" || o.lockedAt) throw new AdminFault("UNAUTHENTICATED");
    return {
      operatorId,
      isOwner: r.ownerId === operatorId,
      environment: policy.environment,
      authorizationVersion: o.authorizationVersion,
      policyRevision: r.policyRevision,
      grants: r.ownerId === operatorId ? [] : await tx.grants(operatorId),
    };
  }
  async function audit(
    tx: AdminTransaction,
    op: AdminOperation,
    event: string,
    actorId = op.actorId,
  ) {
    await tx.audit({
      id: deps.newId(),
      realmId: policy.realmId,
      operatorId: actorId,
      event,
      commandId: op.id,
      occurredAt: at(),
      operation: op.action.operation,
      targetId: op.action.targetId,
      reasonCode: op.reasonCode,
      ...(op.mode ? { mode: op.mode } : {}),
    });
  }
  function result(op: AdminOperation, generatedPassword?: string) {
    return adminCommandResultSchema.parse({
      schemaVersion: 1,
      commandId: op.id,
      actorId: op.actorId,
      action: op.action,
      reasonCode: op.reasonCode,
      digest: op.digest,
      operation: op.action.operation,
      targetId: op.action.targetId,
      state: op.state,
      mode: op.mode,
      expiresAt: (op.approvedUntil ?? op.expiresAt).toISOString(),
      resultCode: op.resultCode,
      ...(generatedPassword ? { generatedPassword } : {}),
    });
  }
  async function owner(tx: AdminTransaction, operatorId: string) {
    if (!(await principal(tx, operatorId)).isOwner) throw new AdminFault("FORBIDDEN");
  }
  function validateGrants(grants: AdminGrant[]) {
    if (
      grants.some(
        (g) =>
          g.environment !== policy.environment ||
          /^(admins|roles)\./.test(g.permission) ||
          (!/^(games|rooms|matches)\./.test(g.permission) && g.gameIds !== null),
      )
    )
      throw new AdminFault("INVALID_INPUT");
  }
  async function target(tx: AdminTransaction, action: AdminAction) {
    const m = management(tx),
      r = await tx.realm();
    if (action.operation.startsWith("ADMIN_")) {
      const o = await tx.operator(action.targetId);
      if (r?.ownerId === action.targetId || (o && o.pinVerifier !== null))
        throw new AdminFault("FORBIDDEN");
      if (action.operation === "ADMIN_CREATE") {
        if (o || action.expectedVersion !== 0 || (await m.usernameExists(action.username)))
          throw new AdminFault("ADMIN_CONFLICT");
      } else if (!o || o.status === "DELETED" || o.authorizationVersion !== action.expectedVersion)
        throw new AdminFault("ADMIN_CONFLICT");
    } else if (action.operation === "ROLE_SAVE" || action.operation === "ROLE_DELETE") {
      const roles = await m.roles(),
        role = roles.find((v) => v.id === action.targetId);
      if (
        ((await m.roleMemberCounts())[action.targetId] ?? 0) !== action.expectedMemberCount ||
        (role?.version ?? 0) !== action.expectedVersion ||
        (!role && action.operation === "ROLE_DELETE") ||
        roles.length > 100 ||
        (!role && roles.length >= 100)
      )
        throw new AdminFault("ADMIN_CONFLICT");
      if (
        action.operation === "ROLE_SAVE" &&
        roles.some((r) => r.id !== action.targetId && r.name === action.name)
      )
        throw new AdminFault("ADMIN_CONFLICT");
    }
    if ("grants" in action) validateGrants(action.grants);
    if (action.operation === "ADMIN_ACCESS") {
      const roles = await m.roles();
      if (
        action.roleIds.some((id) => !roles.some((r) => r.id === id)) ||
        action.grants.length +
          roles.filter((r) => action.roleIds.includes(r.id)).flatMap((r) => r.grants).length >
          256
      )
        throw new AdminFault("INVALID_INPUT");
    }
  }
  async function usable(tx: AdminTransaction, op: AdminOperation) {
    const r = await tx.realm(),
      o = await tx.operator(op.actorId),
      s = await tx.session(op.sessionId);
    if (
      !r ||
      !o ||
      !s ||
      s.kind !== "FULL" ||
      s.revokedAt ||
      s.expiresAt <= at() ||
      s.lastSeenAt.getTime() + policy.idleSeconds * 1000 <= clock.nowMs() ||
      o.status !== "ACTIVE" ||
      o.lockedAt ||
      op.environment !== policy.environment ||
      r.ownershipEpoch !== op.ownershipEpoch ||
      r.policyRevision !== op.policyRevision ||
      o.authorizationVersion !== op.authorizationVersion ||
      o.credentialVersion !== op.credentialVersion ||
      o.sessionEpoch !== op.sessionEpoch ||
      s.sessionEpoch !== o.sessionEpoch ||
      s.credentialVersion !== o.credentialVersion
    )
      throw new AdminFault("ADMIN_CONFLICT");
    permit(await principal(tx, op.actorId), op, "write");
  }
  async function fetch(tx: AdminTransaction, id: string) {
    const op = await management(tx).operation(id);
    if (!op) throw new AdminFault("FORBIDDEN");
    return op;
  }
  async function internalEffect(tx: AdminTransaction, op: AdminOperation, verifier: string | null) {
    const m = management(tx),
      a = op.action;
    await owner(tx, op.actorId);
    await target(tx, a);
    if (a.operation === "ADMIN_CREATE") {
      await tx.createOperator({
        id: a.targetId,
        realmId: policy.realmId,
        username: a.username,
        passwordVerifier: verifier!,
        pinVerifier: null,
        credentialVersion: 1,
        sessionEpoch: 1,
        authorizationVersion: 1,
        status: "ACTIVE",
        pinFailures: 0,
        lockedAt: null,
      });
    } else if (a.operation.startsWith("ADMIN_")) {
      const o = (await tx.operator(a.targetId))!;
      if (a.operation === "ADMIN_ACCESS") {
        await m.setAccess(o.id, a.roleIds, a.grants);
        await m.advancePolicy();
      }
      await tx.updateOperator(o.id, {
        authorizationVersion: o.authorizationVersion + 1,
        ...(a.operation === "ADMIN_STATUS"
          ? { status: a.status, sessionEpoch: o.sessionEpoch + 1 }
          : {}),
        ...(a.operation === "ADMIN_RESET_PASSWORD"
          ? {
              passwordVerifier: verifier!,
              credentialVersion: o.credentialVersion + 1,
              sessionEpoch: o.sessionEpoch + 1,
            }
          : {}),
        ...(a.operation === "ADMIN_REVOKE_SESSIONS" ? { sessionEpoch: o.sessionEpoch + 1 } : {}),
      });
    } else if (a.operation === "ROLE_SAVE") {
      await m.saveRole({
        id: a.targetId,
        realmId: policy.realmId,
        name: a.name,
        version: a.expectedVersion + 1,
        grants: a.grants,
      });
      await m.advancePolicy();
    } else if (a.operation === "ROLE_DELETE") {
      await m.deleteRole(a.targetId);
      await m.advancePolicy();
    } else throw new AdminFault("INVALID_INPUT");
  }
  async function reconcile(tx: AdminTransaction, op: AdminOperation, outcome: { code: string }) {
    if (op.state !== "UNKNOWN") return op;
    op.state = outcome.code === "APPLIED" ? "SUCCEEDED" : "FAILED";
    op.resultCode = outcome.code;
    await audit(tx, op, op.state === "SUCCEEDED" ? "OPERATION_SUCCEEDED" : "OPERATION_FAILED");
    await management(tx).saveOperation(op);
    return op;
  }
  return Object.freeze({
    async activity(token: unknown, operatorId: string) {
      parse(z.uuid(), operatorId);
      const a = await service.authenticate(token);
      return repository.atomic(async (tx) => {
        await owner(tx, a.principal.operatorId);
        return management(tx).activity(operatorId);
      });
    },
    async reconcilePending() {
      const pending = await repository.atomic((tx) =>
        management(tx).unknownOperations(reconciliationCursor),
      );
      reconciliationCursor = pending.at(-1)?.id;
      for (const op of pending) {
        const outcome = await products[op.action.operation]?.outcome(op);
        if (outcome)
          await repository.atomic(async (tx) => reconcile(tx, await fetch(tx, op.id), outcome));
      }
    },
    async directory(token: unknown, cursor?: string) {
      const a = await service.authenticate(token);
      return repository.atomic(async (tx) => {
        await owner(tx, a.principal.operatorId);
        const m = management(tx),
          r = (await tx.realm())!,
          rows = await m.operators(cursor),
          roles = await m.roles(),
          memberCounts = await m.roleMemberCounts();
        const operators = [];
        for (const o of rows.slice(0, 50))
          operators.push({
            id: o.id,
            username: o.username,
            status: o.status,
            isOwner: r.ownerId === o.id,
            version: o.authorizationVersion,
            roleIds: await m.roleIds(o.id),
            grants: await m.directGrants(o.id),
          });
        return adminDirectorySchema.parse({
          schemaVersion: 1,
          environment: policy.environment,
          policyRevision: r.policyRevision,
          operators,
          roles: roles.map(({ realmId: _realmId, ...r }) => ({
            ...r,
            memberCount: memberCounts[r.id] ?? 0,
          })),
          nextCursor: rows.length > 50 ? rows[49]!.id : null,
        });
      });
    },
    async sessions(token: unknown, operatorId: string) {
      parse(z.uuid(), operatorId);
      const a = await service.authenticate(token);
      return repository.atomic(async (tx) => {
        await owner(tx, a.principal.operatorId);
        const o = await tx.operator(operatorId);
        if (!o) throw new AdminFault("FORBIDDEN");
        return {
          schemaVersion: 1,
          items: (await management(tx).sessions(operatorId)).map((s) => ({
            id: s.id,
            kind: s.kind,
            issuedAt: s.issuedAt.toISOString(),
            expiresAt: s.expiresAt.toISOString(),
            lastSeenAt: s.lastSeenAt.toISOString(),
            valid:
              !s.revokedAt &&
              s.expiresAt > at() &&
              s.lastSeenAt.getTime() + policy.idleSeconds * 1000 > clock.nowMs() &&
              s.sessionEpoch === o.sessionEpoch &&
              s.credentialVersion === o.credentialVersion &&
              o.status === "ACTIVE" &&
              !o.lockedAt,
          })),
        };
      });
    },
    async request(token: unknown, input: unknown) {
      const p = parse(adminCommandRequestSchema, input),
        a = await service.authenticate(token);
      if (p.action.operation === "USER_STATUS") throw new AdminFault("FORBIDDEN");
      const permission = adminOperationPermissions[p.action.operation].write;
      if (!adminAccess(a.principal, permission) && !adminGameScope(a.principal, permission)?.length)
        throw new AdminFault("FORBIDDEN");
      const digest = crypto.digest(JSON.stringify([policy.environment, p.action, p.reasonCode]));
      const previous = await repository.atomic(async (tx) => {
        const op = await management(tx).operation(p.commandId);
        if (!op) return null;
        if (op.actorId !== a.principal.operatorId || op.digest !== digest)
          throw new AdminFault("ADMIN_CONFLICT");
        permit(await principal(tx, op.actorId), op, "write");
        return result(op);
      });
      if (previous) return previous;
      const product = products[p.action.operation];
      const info = product ? await product.target(p.action) : null;
      if (!product && !/^(ADMIN|ROLE)_/.test(p.action.operation))
        throw new AdminFault("ADMIN_UNAVAILABLE");
      if (product && (!info || !adminAccess(a.principal, permission, info.gameId ?? undefined)))
        throw new AdminFault("FORBIDDEN");
      if (product && info!.version !== p.action.expectedVersion)
        throw new AdminFault("ADMIN_CONFLICT");
      return repository.atomic(async (tx) => {
        const m = management(tx),
          r = await tx.realm(),
          o = await tx.operator(a.principal.operatorId),
          s = await tx.session(a.sessionId);
        if (
          !r ||
          !o ||
          !s ||
          s.revokedAt ||
          o.sessionEpoch !== s.sessionEpoch ||
          o.credentialVersion !== s.credentialVersion ||
          o.status !== "ACTIVE" ||
          o.lockedAt
        )
          throw new AdminFault("UNAUTHENTICATED");
        const existing = await m.operation(p.commandId);
        if (existing) {
          if (existing.actorId !== o.id || existing.digest !== digest)
            throw new AdminFault("ADMIN_CONFLICT");
          permit(await principal(tx, o.id), existing, "write");
          return result(existing);
        }
        const op: AdminOperation = {
          id: p.commandId,
          realmId: policy.realmId,
          actorId: o.id,
          sessionId: a.sessionId,
          authorizationVersion: o.authorizationVersion,
          credentialVersion: o.credentialVersion,
          sessionEpoch: o.sessionEpoch,
          policyRevision: r.policyRevision,
          ownershipEpoch: r.ownershipEpoch,
          environment: policy.environment,
          digest,
          action: p.action,
          gameId: info?.gameId ?? null,
          reasonCode: p.reasonCode,
          state: "PENDING",
          mode: null,
          approverId: null,
          approverSessionId: null,
          approverAuthorizationVersion: null,
          approverSessionEpoch: null,
          approverCredentialVersion: null,
          createdAt: at(),
          expiresAt: new Date(clock.nowMs() + 120000),
          approvedUntil: null,
          resultCode: null,
        };
        permit(await principal(tx, o.id), op, "write");
        await target(tx, p.action);
        await audit(tx, op, "OPERATION_REQUESTED");
        await m.saveOperation(op);
        return result(op);
      });
    },
    async renew(token: unknown, operationId: string) {
      parse(z.uuid(), operationId);
      const a = await service.authenticate(token);
      const observed = await repository.atomic(async (tx) => {
        const op = await fetch(tx, operationId);
        if (op.actorId !== a.principal.operatorId) throw new AdminFault("FORBIDDEN");
        permit(await principal(tx, op.actorId), op, "write");
        return op;
      });
      if (observed.state === "UNKNOWN") {
        const outcome = await products[observed.action.operation]?.outcome(observed);
        if (outcome)
          return result(
            await repository.atomic(async (tx) =>
              reconcile(tx, await fetch(tx, operationId), outcome),
            ),
          );
      }
      return repository.atomic(async (tx) => {
        const op = await fetch(tx, operationId),
          r = (await tx.realm())!,
          o = (await tx.operator(a.principal.operatorId))!,
          s = await tx.session(a.sessionId);
        permit(await principal(tx, o.id), op, "write");
        if (
          op.actorId !== o.id ||
          !s ||
          s.revokedAt ||
          s.sessionEpoch !== o.sessionEpoch ||
          s.credentialVersion !== o.credentialVersion
        )
          throw new AdminFault("FORBIDDEN");
        if (op.state === "SUCCEEDED" || op.state === "FAILED") return result(op);
        await target(tx, op.action);
        op.state = op.state === "UNKNOWN" ? "UNKNOWN" : "PENDING";
        op.sessionId = s.id;
        op.authorizationVersion = o.authorizationVersion;
        op.credentialVersion = o.credentialVersion;
        op.sessionEpoch = o.sessionEpoch;
        op.policyRevision = r.policyRevision;
        op.ownershipEpoch = r.ownershipEpoch;
        op.expiresAt = new Date(clock.nowMs() + 120000);
        op.approvedUntil = null;
        op.mode = null;
        op.approverId = null;
        op.approverSessionId = null;
        op.approverAuthorizationVersion = null;
        op.approverSessionEpoch = null;
        op.approverCredentialVersion = null;
        await audit(tx, op, "OPERATION_RENEWED");
        await management(tx).saveOperation(op);
        return result(op);
      });
    },
    async approve(token: unknown, operationId: string, input: unknown) {
      parse(z.uuid(), operationId);
      const p = parse(adminApprovalSchema, input),
        a = await service.authenticate(token);
      const validate = async (tx: AdminTransaction, sessionId: string) => {
        const op = await fetch(tx, operationId),
          actor = await principal(tx, a.principal.operatorId);
        await usable(tx, op);
        if (
          (op.state !== "PENDING" && !(op.state === "UNKNOWN" && op.mode === null)) ||
          op.expiresAt <= at()
        )
          throw new AdminFault("ADMIN_CONFLICT");
        permit(actor, op, "approve");
        if (!actor.isOwner && op.actorId === actor.operatorId) throw new AdminFault("FORBIDDEN");
        if (op.actorId === actor.operatorId && op.sessionId !== sessionId)
          throw new AdminFault("ADMIN_CONFLICT");
        await target(tx, op.action);
      };
      return service.reauthenticateOperation(
        token,
        {
          commandId: p.commandId,
          password: p.password,
          ...(p.pin === undefined ? {} : { pin: p.pin }),
          operationId,
        },
        validate,
        async (tx, sessionId) => {
          const op = await fetch(tx, operationId),
            actor = await principal(tx, a.principal.operatorId),
            o = (await tx.operator(actor.operatorId))!;
          op.state = op.state === "UNKNOWN" ? "UNKNOWN" : "APPROVED";
          op.mode = actor.isOwner ? "OWNER_FINAL" : "DUAL_CONTROL";
          op.approverId = actor.operatorId;
          op.approverSessionId = sessionId;
          op.approverAuthorizationVersion = o.authorizationVersion;
          op.approverCredentialVersion = o.credentialVersion;
          op.approverSessionEpoch = o.sessionEpoch;
          if (op.actorId === actor.operatorId) op.sessionId = sessionId;
          op.approvedUntil = new Date(Math.min(op.expiresAt.getTime(), clock.nowMs() + 60000));
          await audit(tx, op, "OPERATION_APPROVED", actor.operatorId);
          await management(tx).saveOperation(op);
        },
      );
    },
    async execute(token: unknown, operationId: string) {
      parse(z.uuid(), operationId);
      const a = await service.authenticate(token);
      let generatedPassword: string | undefined;
      const observed = await repository.atomic(async (tx) => {
        const op = await fetch(tx, operationId);
        if (op.actorId !== a.principal.operatorId) throw new AdminFault("FORBIDDEN");
        permit(await principal(tx, op.actorId), op, "write");
        return op;
      });
      if (observed.state === "UNKNOWN") {
        const outcome = await products[observed.action.operation]?.outcome(observed);
        if (outcome)
          return result(
            await repository.atomic(async (tx) =>
              reconcile(tx, await fetch(tx, operationId), outcome),
            ),
          );
      }
      if (
        observed.state === "APPROVED" &&
        (observed.action.operation === "ADMIN_CREATE" ||
          observed.action.operation === "ADMIN_RESET_PASSWORD")
      )
        generatedPassword = generateAdminPassword();
      const verifier = generatedPassword
        ? await service.hashAdminPassword(generatedPassword)
        : null;
      const admitted = await repository.atomic(async (tx) => {
        const op = await fetch(tx, operationId);
        permit(await principal(tx, a.principal.operatorId), op, "write");
        if (op.actorId !== a.principal.operatorId) throw new AdminFault("FORBIDDEN");
        if (op.state === "SUCCEEDED" || op.state === "FAILED")
          return { op, effect: false, secret: false };
        await usable(tx, op);
        const approver = op.approverId ? await tx.operator(op.approverId) : null,
          approvedSession = op.approverSessionId ? await tx.session(op.approverSessionId) : null;
        if (
          a.sessionId !== op.sessionId ||
          (op.state !== "APPROVED" && op.state !== "UNKNOWN") ||
          !op.approvedUntil ||
          op.approvedUntil <= at() ||
          !approver ||
          !approvedSession ||
          approvedSession.revokedAt ||
          approvedSession.expiresAt <= at() ||
          approver.status !== "ACTIVE" ||
          approver.lockedAt ||
          approver.authorizationVersion !== op.approverAuthorizationVersion ||
          approver.sessionEpoch !== op.approverSessionEpoch ||
          approver.credentialVersion !== op.approverCredentialVersion
        )
          throw new AdminFault("ADMIN_CONFLICT");
        permit(await principal(tx, approver.id), op, "approve");
        await target(tx, op.action);
        if (op.state !== "UNKNOWN") await audit(tx, op, "OPERATION_ADMITTED");
        if (/^(ADMIN|ROLE)_/.test(op.action.operation)) {
          await internalEffect(tx, op, verifier);
          op.state = "SUCCEEDED";
          op.resultCode = "APPLIED";
          await audit(tx, op, "OPERATION_SUCCEEDED");
          await management(tx).saveOperation(op);
          return { op, effect: false, secret: true };
        }
        op.state = "UNKNOWN";
        await management(tx).saveOperation(op);
        return { op, effect: true, secret: false };
      });
      if (!admitted.effect)
        return result(admitted.op, admitted.secret ? generatedPassword : undefined);
      const product = products[admitted.op.action.operation];
      if (!product) throw new AdminFault("ADMIN_UNAVAILABLE");
      // A durable admission can be retried after a crash; the owning module deduplicates the effect.
      let outcome: { code: string } | null = await product.outcome(admitted.op);
      if (!outcome) {
        try {
          outcome = await product.execute(admitted.op);
        } catch {
          return result(admitted.op);
        }
      }
      try {
        return result(
          await repository.atomic(async (tx) =>
            reconcile(tx, await fetch(tx, operationId), outcome!),
          ),
        );
      } catch {
        return result(admitted.op);
      }
    },
    async list(token: unknown) {
      const a = await service.authenticate(token);
      return repository.atomic(async (tx) => {
        const p = await principal(tx, a.principal.operatorId),
          ops = await management(tx).operations();
        return {
          schemaVersion: 1,
          items: ops
            .filter(
              (op) =>
                adminAccess(
                  p,
                  adminOperationPermissions[op.action.operation].view,
                  op.gameId ?? undefined,
                ) &&
                (p.isOwner ||
                  op.actorId === p.operatorId ||
                  adminAccess(
                    p,
                    adminOperationPermissions[op.action.operation].approve,
                    op.gameId ?? undefined,
                  )),
            )
            .map((op) => result(op)),
        };
      });
    },
    async status(token: unknown, operationId: string) {
      parse(z.uuid(), operationId);
      const a = await service.authenticate(token);
      const op = await repository.atomic(async (tx) => {
        const op = await fetch(tx, operationId),
          p = await principal(tx, a.principal.operatorId);
        permit(p, op, "view");
        if (
          op.actorId !== a.principal.operatorId &&
          !p.isOwner &&
          !adminAccess(
            p,
            adminOperationPermissions[op.action.operation].approve,
            op.gameId ?? undefined,
          )
        )
          throw new AdminFault("FORBIDDEN");
        return op;
      });
      if (op.state === "UNKNOWN") {
        const outcome = await products[op.action.operation]?.outcome(op);
        if (outcome)
          return result(
            await repository.atomic(async (tx) =>
              reconcile(tx, await fetch(tx, operationId), outcome),
            ),
          );
      }
      return result(op);
    },
  });
}
export type AdminManagement = ReturnType<typeof createAdminManagement>;
