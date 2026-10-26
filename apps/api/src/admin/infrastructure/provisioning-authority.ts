import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";

const proofSchema = z.strictObject({
  commandId: z.uuid(),
  realmId: z.string().max(64),
  username: z.string().max(64),
  reasonCode: z.string().max(64),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  operatorSignature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  ownershipSignature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export function adminProvisioningStatement(p: {
  commandId: string;
  realmId: string;
  username: string;
  reasonCode: string;
  digest: string;
  issuedAt: number;
  expiresAt: number;
}) {
  return JSON.stringify([
    "hambazi-admin-ceremony-v1",
    p.commandId,
    p.realmId,
    p.username,
    p.reasonCode,
    p.digest,
    p.issuedAt,
    p.expiresAt,
  ]);
}
/** Independent Ed25519 signatures prove server-operator and project-ownership authority outside the DB. */
export function createAdminProvisioningAuthority(options: {
  operatorPublicKey: string;
  ownershipPublicKey: string;
  clock: { nowMs(): number };
}) {
  const operator = createPublicKey(options.operatorPublicKey),
    ownership = createPublicKey(options.ownershipPublicKey);
  if (
    operator.asymmetricKeyType !== "ed25519" ||
    ownership.asymmetricKeyType !== "ed25519" ||
    operator
      .export({ type: "spki", format: "der" })
      .equals(ownership.export({ type: "spki", format: "der" }))
  )
    throw new Error("ADMIN_PROVISIONING_KEYS_INVALID");
  return async (
    input: unknown,
    binding: {
      commandId: string;
      realmId: string;
      username: string;
      reasonCode: string;
      digest: string;
    },
  ) => {
    const result = proofSchema.safeParse(input);
    if (!result.success) return false;
    const p = result.data,
      now = options.clock.nowMs();
    if (
      p.issuedAt > now ||
      p.expiresAt <= now ||
      p.expiresAt - p.issuedAt > 300000 ||
      p.expiresAt <= p.issuedAt ||
      Object.entries(binding).some(([key, value]) => p[key as keyof typeof binding] !== value)
    )
      return false;
    const bytes = Buffer.from(adminProvisioningStatement(p));
    return (
      verify(null, bytes, operator, Buffer.from(p.operatorSignature, "base64url")) &&
      verify(null, bytes, ownership, Buffer.from(p.ownershipSignature, "base64url"))
    );
  };
}
