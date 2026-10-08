import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { networkInterfaces } from "node:os";
import { execFile } from "node:child_process";
import { promisify, isDeepStrictEqual } from "node:util";

const bytes = await readFile(
  new URL("../security/temporary-staging-freshness.json", import.meta.url),
);
const policy = Object.freeze(JSON.parse(bytes));
export const temporaryStagingFreshnessProfile = policy.profile;
const invalid = () => {
  throw new Error("TEMPORARY_STAGING_FRESHNESS_INVALID");
};

/** Pure proof validation; actual callers obtain target identity from the host below. */
export function validateStagingFreshnessTarget(target, now = Date.now()) {
  if (
    !Number.isFinite(now) ||
    now >= Date.parse(policy.expiresAt) ||
    target?.address !== policy.targetAddress ||
    target?.dockerDaemonId !== policy.dockerDaemonId ||
    target?.ownerAdmissionProfile !== policy.ownerAdmissionProfile
  )
    invalid();
  return Object.freeze({
    profile: policy.profile,
    maximumAgeHours: policy.maximumAgeHours,
    expiresAt: policy.expiresAt,
    targetAddress: policy.targetAddress,
    dockerDaemonId: policy.dockerDaemonId,
    ownerAdmissionProfile: policy.ownerAdmissionProfile,
    approvalSha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

export function validateStagingFreshnessContext(context, now = Date.now()) {
  const expected = validateStagingFreshnessTarget(
    {
      address: context?.targetAddress,
      dockerDaemonId: context?.dockerDaemonId,
      ownerAdmissionProfile: context?.ownerAdmissionProfile,
    },
    now,
  );
  if (!isDeepStrictEqual(context, expected)) invalid();
  return expected;
}

/** No environment override: explicit profile, actual NIC and actual Docker daemon. */
export async function stagingFreshnessContext(profile) {
  if (profile !== policy.profile) invalid();
  if (
    !Object.values(networkInterfaces())
      .flat()
      .some((n) => n?.address === policy.targetAddress)
  )
    invalid();
  let id;
  try {
    id = (
      await promisify(execFile)("docker", ["info", "--format", "{{.ID}}"], {
        timeout: 10000,
        maxBuffer: 4096,
        env: { PATH: process.env.PATH, HOME: "/root" },
      })
    ).stdout.trim();
  } catch {
    invalid();
  }
  return validateStagingFreshnessTarget({
    address: policy.targetAddress,
    dockerDaemonId: id,
    ownerAdmissionProfile: policy.ownerAdmissionProfile,
  });
}
