import { z } from "zod";
import { SecretValue } from "./secret-value.js";

export const ownerAdmissionProfile = "telegram-owner-only-v1";
export const ownerAdmissionPath = "/run/hambazi/owner-admission.json";
const decimalId = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/)
  .refine((v) => BigInt(v) <= 9007199254740991n);
const policy = z.strictObject({
  schemaVersion: z.literal(1),
  purpose: z.literal("temporary-owner-only"),
  telegramUserIds: z.tuple([decimalId]),
});

/** Optional portable profile; selecting either field requires the exact complete pair. */
export function parseOwnerAdmissionConfig(env: Readonly<Record<string, string | undefined>>) {
  const mode = env.AUTH_ADMISSION_POLICY,
    path = env.OWNER_ADMISSION_FILE;
  if (mode === undefined && path === undefined) return undefined;
  if (mode !== ownerAdmissionProfile || path !== ownerAdmissionPath)
    throw new Error("OWNER_ADMISSION_CONFIGURATION_INVALID");
  return Object.freeze({ profile: ownerAdmissionProfile, file: ownerAdmissionPath });
}

/** Errors and ordinary inspection never expose the private personal identity. */
export function parseOwnerAdmissionPolicy(raw: string): SecretValue {
  try {
    if (Buffer.byteLength(raw, "utf8") > 4096) throw new Error();
    const value = policy.parse(JSON.parse(raw));
    return new SecretValue(value.telegramUserIds[0]);
  } catch {
    throw new Error("OWNER_ADMISSION_POLICY_INVALID");
  }
}
