import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { z } from "zod";
import { ownerStateSchema } from "./admin-owner-state.js";

const magic = Buffer.from("HBADMIN1");
const maxBytes = 64 * 1024 * 1024;
const capsule = z.strictObject({
  schemaVersion: z.literal(1),
  scope: z.literal("staging-admin-six-tables"),
  realm: z.literal("staging"),
  createdAtUTC: z.iso.datetime(),
  sourceRevision: z.string().regex(/^[0-9a-f]{64}$/),
  schemaTag: z.literal("admin-local-identity+password-rotation-v1"),
  runtimeEnvironment: z.string().max(65536),
  operatorEnvironment: z.string().max(65536),
  checkpoint: ownerStateSchema.nullable(),
  dumpBase64: z
    .string()
    .max(48 * 1024 * 1024)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export type OwnerBackupCapsule = z.infer<typeof capsule>;
function key(passphrase: string, salt: Buffer) {
  if (passphrase.length < 20 || passphrase.length > 256) throw new Error("ADMIN_BACKUP_DENIED");
  return scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
export function sealOwnerBackup(input: OwnerBackupCapsule, passphrase: string) {
  const parsed = capsule.parse(input);
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const header = Buffer.concat([magic, salt, iv]);
  const material = key(passphrase, salt);
  const plaintext = Buffer.from(JSON.stringify(parsed));
  try {
    if (plaintext.length > maxBytes) throw new Error("ADMIN_BACKUP_DENIED");
    const cipher = createCipheriv("aes-256-gcm", material, iv);
    cipher.setAAD(header);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([header, cipher.getAuthTag(), body]);
  } finally {
    material.fill(0);
    plaintext.fill(0);
  }
}
/** Authenticate the complete archive before handing any bytes to PostgreSQL. */
export function openOwnerBackup(value: Buffer, passphrase: string): OwnerBackupCapsule {
  let material: Buffer | undefined, plaintext: Buffer | undefined;
  try {
    if (value.length < 53 || value.length > maxBytes + 52 || !value.subarray(0, 8).equals(magic))
      throw new Error();
    material = key(passphrase, value.subarray(8, 24));
    const decipher = createDecipheriv("aes-256-gcm", material, value.subarray(24, 36));
    decipher.setAAD(value.subarray(0, 36));
    decipher.setAuthTag(value.subarray(36, 52));
    plaintext = Buffer.concat([decipher.update(value.subarray(52)), decipher.final()]);
    const result = capsule.parse(JSON.parse(plaintext.toString()));
    if (!Buffer.from(result.dumpBase64, "base64").subarray(0, 5).equals(Buffer.from("PGDMP")))
      throw new Error();
    return result;
  } catch {
    throw new Error("ADMIN_BACKUP_DENIED");
  } finally {
    material?.fill(0);
    plaintext?.fill(0);
  }
}

export const ownerDumpArguments = [
  "--format=custom",
  "--data-only",
  "--no-owner",
  "--no-acl",
  "--no-password",
  "--strict-names",
  "--lock-wait-timeout=5s",
  "--table=public.admin_realms",
  "--table=public.admin_operators",
  "--table=public.admin_sessions",
  "--table=public.admin_auth_receipts",
  "--table=public.admin_grants",
  "--table=public.admin_audit_events",
];
