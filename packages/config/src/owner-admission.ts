import { z } from "zod";
import { SecretValue } from "./secret-value.js";

export const ownerAdmissionProfile = "telegram-owner-only-v1";
export const ownerAdmissionPath = "/run/hambazi/owner-admission.json";
export const stagingTestAdmissionPath = "/run/hambazi/staging-test-admission.json";
const decimalId = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/)
  .refine((v) => BigInt(v) <= 9007199254740991n);
const policy = z.strictObject({
  schemaVersion: z.literal(1),
  purpose: z.literal("temporary-owner-only"),
  telegramUserIds: z.tuple([decimalId]),
});
const testPolicy = z.strictObject({
  schemaVersion: z.literal(1),
  purpose: z.literal("temporary-staging-regular-test-user"),
  telegramUserIds: z.array(decimalId).max(1),
});

/** Optional portable profile; selecting either field requires the exact complete pair. */
export function parseOwnerAdmissionConfig(env: Readonly<Record<string, string | undefined>>) {
  const mode = env.AUTH_ADMISSION_POLICY,
    path = env.OWNER_ADMISSION_FILE,
    testFile = env.STAGING_TEST_ADMISSION_FILE;
  if (mode === undefined && path === undefined && testFile === undefined) return undefined;
  if (
    mode !== ownerAdmissionProfile ||
    path !== ownerAdmissionPath ||
    (testFile !== undefined &&
      (testFile !== stagingTestAdmissionPath ||
        !(
          env.ALLOWED_ORIGINS === "https://staging.hambazi.top" ||
          ["https://staging.hambazi.top", "https://staging.hambazi.top/"].includes(
            env.BOT_MINI_APP_URL ?? "",
          )
        )))
  )
    throw new Error("OWNER_ADMISSION_CONFIGURATION_INVALID");
  return Object.freeze({
    profile: ownerAdmissionProfile,
    file: ownerAdmissionPath,
    ...(testFile ? { testFile } : {}),
  });
}

/** A separate bounded ordinary-user exception never supplies the owner/admin identity. */
export function parseStagingTestAdmissionPolicy(raw: string): SecretValue {
  try {
    if (Buffer.byteLength(raw, "utf8") > 4096) throw new Error();
    const value = testPolicy.parse(JSON.parse(raw));
    return new SecretValue(value.telegramUserIds[0] ?? "");
  } catch {
    throw new Error("STAGING_TEST_ADMISSION_POLICY_INVALID");
  }
}

/** Operator-only observation is temporary; usernames never authorize product access. */
export function parseStagingTestResolutionConfig(
  env: Readonly<Record<string, string | undefined>>,
) {
  const username = env.STAGING_TEST_USER_RESOLUTION;
  if (username === undefined) return undefined;
  if (
    !/^[A-Za-z0-9_]{5,32}$/.test(username) ||
    !parseOwnerAdmissionConfig(env)?.testFile ||
    !["https://staging.hambazi.top", "https://staging.hambazi.top/"].includes(
      env.BOT_MINI_APP_URL ?? "",
    )
  )
    throw new Error("STAGING_TEST_RESOLUTION_CONFIGURATION_INVALID");
  return Object.freeze({ username: username.toLowerCase() });
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
