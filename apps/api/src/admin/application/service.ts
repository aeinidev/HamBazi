import { z } from "zod";
import {
  adminAccess,
  adminGameScope,
  adminCapabilities,
  type AdminPrincipal,
} from "../domain/access.js";
import {
  AdminFault,
  type AdminCrypto,
  type AdminPolicy,
  type AdminRepository,
  type AdminSessionRecord,
  type AdminTransaction,
  type AdminOperatorRecord,
} from "./ports.js";

export const adminUsername = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/)
  .transform((v) => v.toLowerCase());
export const adminPassword = z.string().min(12).max(256);
export const adminPin = z.string().regex(/^[0-9]{6}$/);
const uuid = z.uuid();
export const adminLoginSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: uuid,
  username: adminUsername,
  password: adminPassword,
});
export const adminPinSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: uuid,
  pin: adminPin,
});
export const adminPinChangeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: uuid,
  password: adminPassword,
  currentPin: adminPin,
  newPin: adminPin,
});
export const adminPasswordChangeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: uuid,
  password: adminPassword,
  currentPin: adminPin,
  newPassword: adminPassword,
});

export function createAdminService(deps: {
  repository: AdminRepository;
  crypto: AdminCrypto;
  policy: AdminPolicy;
  clock: { nowMs(): number };
  newId(): string;
  dummyPasswordVerifier: string;
}) {
  const { repository, crypto, policy, clock, newId } = deps;
  let hashing = 0;
  async function bounded<T>(work: () => Promise<T>) {
    if (hashing >= policy.maxCryptoInFlight) throw new AdminFault("RATE_LIMITED");
    hashing++;
    try {
      return await work();
    } finally {
      hashing--;
    }
  }
  function parse<T>(schema: z.ZodType<T>, value: unknown) {
    const p = schema.safeParse(value);
    if (!p.success) throw new AdminFault("INVALID_INPUT");
    return p.data;
  }
  const at = () => new Date(clock.nowMs());
  function audit(
    tx: AdminTransaction,
    event: string,
    commandId: string,
    operatorId: string | null,
  ) {
    return tx.audit({
      id: newId(),
      realmId: policy.realmId,
      operatorId,
      event,
      commandId,
      occurredAt: at(),
    });
  }
  function fresh(row: AdminOperatorRecord | null) {
    return !!row && row.status === "ACTIVE" && row.lockedAt === null;
  }
  function session(operator: AdminOperatorRecord, kind: "PENDING" | "FULL"): AdminSessionRecord {
    const time = at();
    return {
      id: newId(),
      realmId: policy.realmId,
      operatorId: operator.id,
      kind,
      credentialVersion: operator.credentialVersion,
      sessionEpoch: operator.sessionEpoch,
      issuedAt: time,
      expiresAt: new Date(
        time.getTime() +
          (kind === "PENDING" ? policy.pendingSeconds : policy.sessionSeconds) * 1000,
      ),
      lastSeenAt: time,
      revokedAt: null,
    };
  }
  function valid(
    s: AdminSessionRecord | null,
    o: AdminOperatorRecord | null,
    allowRevoked = false,
  ) {
    return (
      !!s &&
      fresh(o) &&
      s.realmId === policy.realmId &&
      (allowRevoked || s.revokedAt === null) &&
      s.expiresAt.getTime() > clock.nowMs() &&
      s.issuedAt.getTime() <= clock.nowMs() &&
      s.lastSeenAt.getTime() + policy.idleSeconds * 1000 > clock.nowMs() &&
      s.sessionEpoch === o!.sessionEpoch &&
      s.credentialVersion === o!.credentialVersion
    );
  }
  async function reply(s: AdminSessionRecord) {
    return {
      token: await crypto.sign(s),
      csrfToken: crypto.csrf(s.id),
      next: s.kind === "PENDING" ? ("PIN_REQUIRED" as const) : ("SIGNED_IN" as const),
    };
  }
  async function verify(value: string, secret: string, kind: "password" | "pin") {
    return bounded(() => crypto.verify(value, secret, kind));
  }
  async function authenticate(token: unknown, touch = true) {
    const claim = await crypto.verifyToken(token);
    if (!claim || claim.kind !== "FULL") throw new AdminFault("UNAUTHENTICATED");
    return repository.atomic(async (tx) => {
      const s = await tx.session(claim.id);
      const o = s ? await tx.operator(s.operatorId) : null;
      const realm = await tx.realm();
      if (!valid(s, o) || s!.kind !== "FULL" || !realm) throw new AdminFault("UNAUTHENTICATED");
      if (touch) await tx.updateSession(s!.id, { lastSeenAt: at() });
      const principal: AdminPrincipal = {
        operatorId: o!.id,
        isOwner: realm.ownerId === o!.id,
        environment: policy.environment,
        authorizationVersion: o!.authorizationVersion,
        policyRevision: realm.policyRevision,
        grants: realm.ownerId === o!.id ? [] : await tx.grants(o!.id),
      };
      return {
        sessionId: s!.id,
        expiresAt: s!.expiresAt.toISOString(),
        principal,
        csrfToken: crypto.csrf(s!.id),
      };
    });
  }
  async function changeCredential(token: unknown, input: unknown, kind: "password" | "pin") {
    const a = await authenticate(token);
    if (!a.principal.isOwner) throw new AdminFault("FORBIDDEN");
    const p =
      kind === "pin" ? parse(adminPinChangeSchema, input) : parse(adminPasswordChangeSchema, input);
    const next = "newPin" in p ? p.newPin : p.newPassword;
    if (kind === "password" && next === p.password) throw new AdminFault("INVALID_INPUT");
    const observed = await repository.atomic((tx) => tx.operator(a.principal.operatorId));
    if (!observed?.pinVerifier) throw new AdminFault("UNAUTHENTICATED");
    const passwordOk = await verify(observed.passwordVerifier, p.password, "password");
    const pinOk = passwordOk && (await verify(observed.pinVerifier, p.currentPin, "pin"));
    const verifier = pinOk ? await bounded(() => crypto.hash(next, kind)) : null;
    const ok = await repository.atomic(async (tx) => {
      const o = await tx.operator(observed.id);
      const s = await tx.session(a.sessionId);
      const realm = await tx.realm();
      if (
        !valid(s, o) ||
        o!.credentialVersion !== observed.credentialVersion ||
        realm?.ownerId !== observed.id
      )
        return false;
      // Preserve the existing PIN intent digest for retries across the additive release.
      const digest = crypto.digest(
        kind === "pin"
          ? `change-pin:${a.sessionId}:${p.password}:${p.currentPin}:${next}`
          : JSON.stringify(["change-password", a.sessionId, p.password, p.currentPin, next]),
      );
      const previous = await tx.receipt(o!.id, p.commandId);
      if (previous) {
        if (previous.digest !== digest) throw new AdminFault("ADMIN_CONFLICT");
        return false;
      }
      const denied = () =>
        tx.saveReceipt({
          operatorId: o!.id,
          commandId: p.commandId,
          digest,
          outcome: "DENIED",
          sessionId: null,
        });
      if (!passwordOk) {
        await audit(tx, "REAUTH_DENIED", p.commandId, o!.id);
        await denied();
        return false;
      }
      if (!pinOk) {
        const failures = o!.pinFailures + 1;
        await tx.updateOperator(o!.id, {
          pinFailures: failures,
          ...(failures >= 3 ? { lockedAt: at(), sessionEpoch: o!.sessionEpoch + 1 } : {}),
        });
        await audit(tx, failures >= 3 ? "OWNER_LOCKED" : "PIN_DENIED", p.commandId, o!.id);
        await denied();
        return false;
      }
      const event = kind === "pin" ? "PIN_CHANGED" : "PASSWORD_CHANGED";
      await audit(tx, event, p.commandId, o!.id);
      await tx.updateOperator(o!.id, {
        ...(kind === "pin" ? { pinVerifier: verifier! } : { passwordVerifier: verifier! }),
        pinFailures: 0,
        credentialVersion: o!.credentialVersion + 1,
        sessionEpoch: o!.sessionEpoch + 1,
      });
      await tx.saveReceipt({
        operatorId: o!.id,
        commandId: p.commandId,
        digest,
        outcome: event,
        sessionId: null,
      });
      return true;
    });
    if (!ok) throw new AdminFault("UNAUTHENTICATED");
  }
  return Object.freeze({
    authenticate,
    async pendingSessionId(token: unknown) {
      const claim = await crypto.verifyToken(token);
      if (!claim || claim.kind !== "PENDING") throw new AdminFault("UNAUTHENTICATED");
      return claim.id;
    },
    async login(input: unknown) {
      const p = parse(adminLoginSchema, input);
      const observed = await repository.findUsername(p.username);
      const correct = await verify(
        observed?.passwordVerifier ?? deps.dummyPasswordVerifier,
        p.password,
        "password",
      );
      const result = await repository.atomic(async (tx) => {
        const o = observed ? await tx.operator(observed.id) : null;
        if (!correct || !fresh(o) || o!.credentialVersion !== observed!.credentialVersion) {
          await audit(tx, "LOGIN_DENIED", p.commandId, o?.id ?? null);
          return null;
        }
        const digest = crypto.digest(`login:${p.username}:${p.password}`);
        const previous = await tx.receipt(o!.id, p.commandId);
        if (previous) {
          if (previous.digest !== digest) throw new AdminFault("ADMIN_CONFLICT");
          const s = previous.sessionId ? await tx.session(previous.sessionId) : null;
          return valid(s, o) ? s : null;
        }
        const realm = await tx.realm();
        if (!realm) return null;
        const s = session(o!, realm.ownerId === o!.id ? "PENDING" : "FULL");
        await audit(
          tx,
          s.kind === "PENDING" ? "PASSWORD_VERIFIED" : "LOGIN_SUCCEEDED",
          p.commandId,
          o!.id,
        );
        await tx.createSession(s);
        await tx.saveReceipt({
          operatorId: o!.id,
          commandId: p.commandId,
          digest,
          outcome: s.kind,
          sessionId: s.id,
        });
        return s;
      });
      if (!result) throw new AdminFault("UNAUTHENTICATED");
      return reply(result);
    },
    async pin(token: unknown, input: unknown) {
      const p = parse(adminPinSchema, input);
      const claim = await crypto.verifyToken(token);
      if (!claim || claim.kind !== "PENDING") throw new AdminFault("UNAUTHENTICATED");
      const pending = await repository.findSession(claim.id);
      if (!pending) throw new AdminFault("UNAUTHENTICATED");
      const observed = await repository.atomic((tx) => tx.operator(pending.operatorId));
      if (!observed?.pinVerifier) throw new AdminFault("UNAUTHENTICATED");
      const correct = await verify(observed.pinVerifier, p.pin, "pin");
      const result = await repository.atomic(async (tx) => {
        const s = await tx.session(claim.id);
        const o = await tx.operator(pending.operatorId);
        const realm = await tx.realm();
        if (
          !valid(s, o, true) ||
          s!.kind !== "PENDING" ||
          realm?.ownerId !== o!.id ||
          o!.credentialVersion !== observed.credentialVersion
        )
          return null;
        const digest = crypto.digest(`pin:${s!.id}:${p.pin}`);
        const previous = await tx.receipt(o!.id, p.commandId);
        if (previous) {
          if (previous.digest !== digest) throw new AdminFault("ADMIN_CONFLICT");
          const full = previous.sessionId ? await tx.session(previous.sessionId) : null;
          return valid(full, o) && full!.kind === "FULL" ? full : null;
        }
        if (s!.revokedAt !== null) return null;
        if (!correct) {
          const failures = o!.pinFailures + 1;
          await tx.updateOperator(o!.id, {
            pinFailures: failures,
            ...(failures >= 3 ? { lockedAt: at(), sessionEpoch: o!.sessionEpoch + 1 } : {}),
          });
          await audit(tx, failures >= 3 ? "OWNER_LOCKED" : "PIN_DENIED", p.commandId, o!.id);
          await tx.saveReceipt({
            operatorId: o!.id,
            commandId: p.commandId,
            digest,
            outcome: "DENIED",
            sessionId: null,
          });
          return null;
        }
        const full = session(o!, "FULL");
        await audit(tx, "LOGIN_SUCCEEDED", p.commandId, o!.id);
        await tx.updateOperator(o!.id, { pinFailures: 0 });
        await tx.updateSession(s!.id, { revokedAt: at() });
        await tx.createSession(full);
        await tx.saveReceipt({
          operatorId: o!.id,
          commandId: p.commandId,
          digest,
          outcome: "SIGNED_IN",
          sessionId: full.id,
        });
        return full;
      });
      if (!result) throw new AdminFault("UNAUTHENTICATED");
      return reply(result);
    },
    async logout(token: unknown, commandId: unknown) {
      const a = await authenticate(token);
      const command = parse(uuid, commandId);
      await repository.atomic(async (tx) => {
        await audit(tx, "LOGOUT", command, a.principal.operatorId);
        await tx.updateSession(a.sessionId, { revokedAt: at() });
      });
    },
    async changePin(token: unknown, input: unknown) {
      return changeCredential(token, input, "pin");
    },
    async changePassword(token: unknown, input: unknown) {
      return changeCredential(token, input, "password");
    },
    async access(token: unknown) {
      const a = await authenticate(token, false);
      return {
        schemaVersion: 1 as const,
        isOwner: a.principal.isOwner,
        authorizationVersion: a.principal.authorizationVersion,
        policyRevision: a.principal.policyRevision,
        permissions: adminCapabilities.filter(
          (p) => adminAccess(a.principal, p) || (adminGameScope(a.principal, p)?.length ?? 0) > 0,
        ),
        csrfToken: a.csrfToken,
      };
    },
  });
}
export type AdminService = ReturnType<typeof createAdminService>;
