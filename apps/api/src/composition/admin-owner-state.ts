import { z } from "zod";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { stagingOwnerProfile } from "./admin-owner-private.js";

export const stagingOwnerPolicySchema = z.strictObject({
  schemaVersion: z.literal(1),
  profile: z.literal(stagingOwnerProfile),
  realm: z.literal("staging"),
  environment: z.literal("staging"),
  sourceRevision: z.string().regex(/^[0-9a-f]{64}$/),
  databaseHost: z
    .string()
    .refine(
      (v) => isIP(v) === 4 && /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(v),
    ),
  databasePort: z.number().int().min(1).max(65535),
  databaseCaFile: z
    .string()
    .startsWith("/")
    .refine((v) => resolve(v) === v),
});
export function operatorDatabaseUrl(
  value: string | undefined,
  policy: z.infer<typeof stagingOwnerPolicySchema>,
) {
  if (!value) throw new Error("ADMIN_OPERATOR_DATABASE_INVALID");
  const uri = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(uri.protocol) ||
    !uri.username ||
    !uri.password ||
    !["postgres-staging", policy.databaseHost].includes(uri.hostname) ||
    uri.searchParams.getAll("sslmode").length !== 1 ||
    uri.searchParams.get("sslmode") !== "verify-full"
  )
    throw new Error("ADMIN_OPERATOR_DATABASE_INVALID");
  // This is an explicit, reviewed host adapter, not a DNS or TLS fallback.
  // The current server certificate contains this private IP as a SAN.
  uri.hostname = policy.databaseHost;
  uri.port = String(policy.databasePort);
  uri.searchParams.set("sslrootcert", policy.databaseCaFile);
  return uri.toString();
}

export const ownerStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  profile: z.literal(stagingOwnerProfile),
  realm: z.literal("staging"),
  ownerId: z.uuid().nullable(),
  pending: z
    .strictObject({
      action: z.enum(["bootstrap", "recover"]),
      commandId: z.uuid(),
      digest: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .nullable(),
});
export type OwnerCeremonyState = z.infer<typeof ownerStateSchema>;
export function planOwnerCeremony(
  state: OwnerCeremonyState | null,
  ownerId: string | null,
  pending: NonNullable<OwnerCeremonyState["pending"]>,
): OwnerCeremonyState {
  if (
    (state?.ownerId && state.ownerId !== ownerId) ||
    (pending.action === "bootstrap" && (state?.ownerId || (ownerId && !state?.pending))) ||
    (pending.action === "recover" && (!state?.ownerId || state.ownerId !== ownerId)) ||
    (state?.pending && JSON.stringify(state.pending) !== JSON.stringify(pending))
  )
    throw new Error("ADMIN_OWNER_CHECKPOINT_CONFLICT");
  return {
    schemaVersion: 1,
    profile: stagingOwnerProfile,
    realm: "staging",
    ownerId: state?.ownerId ?? null,
    pending,
  };
}

export const backupReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  profile: z.literal(stagingOwnerProfile),
  realm: z.literal("staging"),
  snapshotSHA256: z.string().regex(/^[0-9a-f]{64}$/),
  sourceRevision: z.string().regex(/^[0-9a-f]{64}$/),
  restored: z.literal(true),
  offServerCopyVerified: z.literal(true),
  checkedAtUTC: z.iso.datetime(),
});
export function verifyBackupReceipt(input: unknown, sourceRevision: string, now = Date.now()) {
  const receipt = backupReceiptSchema.parse(input);
  const checked = Date.parse(receipt.checkedAtUTC);
  if (receipt.sourceRevision !== sourceRevision || checked > now || now - checked > 86400000)
    throw new Error("ADMIN_BACKUP_REHEARSAL_REQUIRED");
  return receipt;
}

/** In-process capability minted only after the private composer's OS/TTY gates. */
export function stagingAuthority(
  expected: { commandId: string; username: string; reasonCode: string; digest: string },
  now: () => number,
) {
  const binding = Object.freeze({ ...expected, realmId: "staging" });
  const issued = now(),
    expires = issued + 300000;
  const proof = Object.freeze({ commandId: expected.commandId });
  return {
    proof,
    async verify(input: unknown, actual: typeof expected & { realmId: string }) {
      return (
        input === proof &&
        now() >= issued &&
        now() < expires &&
        Object.entries(binding).every(
          ([key, value]) => actual[key as keyof typeof binding] === value,
        )
      );
    },
  };
}
