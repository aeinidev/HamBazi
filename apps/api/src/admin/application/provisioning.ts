import { z } from "zod";
import { AdminFault, type AdminCrypto, type AdminRepository } from "./ports.js";
import { adminPassword, adminPin, adminUsername } from "./service.js";

const ceremonySchema = z.discriminatedUnion("reasonCode", [
  z.strictObject({
    schemaVersion: z.literal(1),
    commandId: z.uuid(),
    username: adminUsername,
    password: adminPassword,
    pin: adminPin,
    confirmed: z.literal(true),
    reasonCode: z.literal("INITIAL_OWNER_ENROLLMENT"),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    commandId: z.uuid(),
    username: adminUsername,
    pin: adminPin,
    confirmed: z.literal(true),
    reasonCode: z.literal("OWNER_PIN_RECOVERY"),
  }),
]);
/** Private application port. The composer must authenticate server-operator AND ownership evidence.
 * Never exposed through an HTTP route; DB credentials alone cannot construct its verified authority. */
export function createAdminProvisioning(deps: {
  repository: AdminRepository;
  crypto: AdminCrypto;
  realmId: string;
  clock: { nowMs(): number };
  newId(): string;
  verifyAuthority(
    input: unknown,
    binding: {
      commandId: string;
      realmId: string;
      username: string;
      reasonCode: string;
      digest: string;
    },
  ): Promise<boolean>;
}) {
  return Object.freeze({
    async run(input: unknown, authority: unknown) {
      const parsed = ceremonySchema.safeParse(input);
      if (!parsed.success) throw new AdminFault("INVALID_INPUT");
      const p = parsed.data;
      if (
        !(await deps.verifyAuthority(authority, {
          commandId: p.commandId,
          realmId: deps.realmId,
          username: p.username,
          reasonCode: p.reasonCode,
          digest: deps.crypto.digest(JSON.stringify(p)),
        }))
      )
        throw new AdminFault("FORBIDDEN");
      const passwordVerifier =
        p.reasonCode === "INITIAL_OWNER_ENROLLMENT"
          ? await deps.crypto.hash(p.password, "password")
          : null;
      const pinVerifier = await deps.crypto.hash(p.pin, "pin");
      return deps.repository.atomic(async (tx) => {
        const realm = await tx.realm();
        const now = new Date(deps.clock.nowMs());
        if (realm?.ownerId) {
          const old = await tx.receipt(realm.ownerId, p.commandId);
          if (old) {
            if (old.digest !== deps.crypto.digest(JSON.stringify(p)))
              throw new AdminFault("ADMIN_CONFLICT");
            return { operatorId: realm.ownerId };
          }
        }
        if (p.reasonCode === "INITIAL_OWNER_ENROLLMENT") {
          if (realm?.ownerId) throw new AdminFault("ADMIN_CONFLICT");
          if (!realm) await tx.createRealm();
          const id = deps.newId();
          await tx.audit({
            id: deps.newId(),
            realmId: deps.realmId,
            operatorId: null,
            commandId: p.commandId,
            event: "OWNER_BOOTSTRAPPED",
            occurredAt: now,
          });
          await tx.createOperator({
            id,
            realmId: deps.realmId,
            username: p.username,
            passwordVerifier: passwordVerifier!,
            pinVerifier,
            status: "ACTIVE",
            pinFailures: 0,
            lockedAt: null,
            credentialVersion: 1,
            sessionEpoch: 1,
            authorizationVersion: 1,
          });
          await tx.bindOwner(id);
          await tx.saveReceipt({
            operatorId: id,
            commandId: p.commandId,
            digest: deps.crypto.digest(JSON.stringify(p)),
            outcome: "BOOTSTRAPPED",
            sessionId: null,
          });
          return { operatorId: id };
        }
        if (!realm?.ownerId) throw new AdminFault("FORBIDDEN");
        const owner = await tx.operator(realm.ownerId);
        if (!owner || owner.username !== p.username) throw new AdminFault("FORBIDDEN");
        // Recovery authority is the two independently signed, action-bound private proofs; the password is not replaced.
        await tx.audit({
          id: deps.newId(),
          realmId: deps.realmId,
          operatorId: owner.id,
          commandId: p.commandId,
          event: "OWNER_RECOVERED",
          occurredAt: now,
        });
        await tx.updateOperator(owner.id, {
          pinVerifier,
          pinFailures: 0,
          lockedAt: null,
          credentialVersion: owner.credentialVersion + 1,
          sessionEpoch: owner.sessionEpoch + 1,
        });
        await tx.advanceOwnership();
        await tx.saveReceipt({
          operatorId: owner.id,
          commandId: p.commandId,
          digest: deps.crypto.digest(JSON.stringify(p)),
          outcome: "RECOVERED",
          sessionId: null,
        });
        return { operatorId: owner.id };
      });
    },
  });
}
