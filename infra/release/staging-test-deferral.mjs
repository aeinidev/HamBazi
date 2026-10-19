import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { runGate } from "../ci/gates.mjs";

export const stagingTestDeferralProfile = "kahroba-two-account-staging-test-v1";
const address = "185.110.191.104";
const daemon = "342f251a-9e56-4353-af12-a32429b7a2e7";
const ownerHash = "382a3c3185f45bdf787503dfe2594f29e3245faa2e82c3ae0d01ee75b104d817";
const testerHash = "4ad78882f119873a90e2f87c0b8559ee4c20b546988cc4949e164b9dad8d91c6";
const serviceHash = "ef990122e8d007966cd3fcb24811098cb46e8aee4673ad25a96b1edab884cdc6";
const service = "/etc/systemd/system/hambazi-staging-advisory-expiry.service";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const invalid = () => {
  throw new Error("STAGING_TEST_SCAN_DEFERRAL_INVALID");
};
const sameKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join();
const digest = (value) => /^[a-f0-9]{64}$/.test(value ?? "");
const timestamp = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value));
const protectedNames = [
  "hambazi-preparation-bot-1",
  "hambazi-staging-platform-ingress-1",
  "hambazi-staging-platform-postgres-staging-1",
  "hambazi-staging-platform-redis-staging-1",
];

/** Explicit restricted-test status; never project it into a passing vulnerability scan. */
export function validateStagingTestDeferral(record, manifest, target, now = Date.now()) {
  const keys = [
    "schemaVersion",
    "profile",
    "authority",
    "issuedAt",
    "expiresAt",
    "targetAddress",
    "dockerDaemonId",
    "sourceCommit",
    "sourceSnapshotSha256",
    "buildInputSha256",
    "images",
    "ownerAdmissionSha256",
    "testerAdmissionSha256",
    "containmentServiceSha256",
    "containmentTimerSha256",
    "protectedContainers",
    "retainedEvidence",
    "imageScanStatus",
    "productionReleaseApproved",
    "publicReleaseApproved",
  ];
  if (
    !sameKeys(record, keys) ||
    record.schemaVersion !== 1 ||
    record.profile !== stagingTestDeferralProfile ||
    record.authority !== "explicit-owner-staging-test-only-trivy-deferral" ||
    record.productionReleaseApproved !== false ||
    record.publicReleaseApproved !== false ||
    record.imageScanStatus !== "deferred-not-passed" ||
    !timestamp(record.issuedAt) ||
    !timestamp(record.expiresAt) ||
    !Number.isFinite(now) ||
    Date.parse(record.issuedAt) > now ||
    Date.parse(record.expiresAt) <= now ||
    Date.parse(record.expiresAt) - Date.parse(record.issuedAt) > 86400000 ||
    record.targetAddress !== address ||
    record.dockerDaemonId !== daemon ||
    target?.address !== address ||
    target?.dockerDaemonId !== daemon ||
    target.ownerAdmissionSha256 !== ownerHash ||
    target.testerAdmissionSha256 !== testerHash ||
    record.ownerAdmissionSha256 !== ownerHash ||
    record.testerAdmissionSha256 !== testerHash ||
    target.exactlyTwoDistinctIdentities !== true ||
    target.containmentServiceSha256 !== serviceHash ||
    record.containmentServiceSha256 !== serviceHash ||
    !digest(record.containmentTimerSha256) ||
    record.containmentTimerSha256 !== target.containmentTimerSha256 ||
    !Number.isFinite(Date.parse(target.containmentExpiresAt)) ||
    Date.parse(record.expiresAt) > Date.parse(target.containmentExpiresAt) ||
    target.containmentEnabled !== true ||
    manifest?.sourceDirty !== false ||
    manifest.productionReleaseApproved !== false ||
    manifest.browserPolicy?.profile !== "production" ||
    manifest.browserPolicy.webOrigin !== "https://staging.hambazi.top" ||
    manifest.browserPolicy.apiOrigin !== "https://api-staging.hambazi.top" ||
    manifest.features?.kahrobaPrivateRuntime !== true ||
    !/^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? "") ||
    !digest(manifest.sourceSnapshotSha256) ||
    !digest(manifest.buildInputSha256) ||
    record.sourceCommit !== manifest.sourceCommit ||
    record.sourceSnapshotSha256 !== manifest.sourceSnapshotSha256 ||
    record.buildInputSha256 !== manifest.buildInputSha256 ||
    !isDeepStrictEqual(record.images, manifest.images) ||
    !Array.isArray(record.images) ||
    record.images.length !== 4 ||
    !Array.isArray(record.protectedContainers) ||
    record.protectedContainers.length !== 4 ||
    !isDeepStrictEqual(
      record.protectedContainers.map((c) => c.name).sort(),
      [...protectedNames].sort(),
    ) ||
    !isDeepStrictEqual(record.protectedContainers, target.protectedContainers) ||
    record.protectedContainers.some(
      (c) =>
        !sameKeys(c, ["name", "id", "image"]) ||
        !digest(c.id) ||
        !/^.+@sha256:[a-f0-9]{64}$/.test(c.image),
    ) ||
    !sameKeys(record.retainedEvidence, [
      "sourceSecurity",
      "sdkIntegrity",
      "packagedAcceptance",
      "rollbackCompatibility",
    ]) ||
    !Object.entries(record.retainedEvidence).every(
      ([kind, v]) =>
        sameKeys(v, ["file", "sha256"]) &&
        typeof v.file === "string" &&
        v.file.startsWith("/opt/hambazi-staging/private/") &&
        digest(v.sha256) &&
        target.retainedEvidence?.[kind]?.sha256 === v.sha256 &&
        target.retainedEvidence[kind].passed === true &&
        target.retainedEvidence[kind].sourceSnapshotSha256 === manifest.sourceSnapshotSha256,
    )
  )
    invalid();
  for (const [index, role] of ["api", "bot", "worker", "web"].entries()) {
    const image = record.images[index];
    if (
      !sameKeys(image, ["role", "image"]) ||
      image.role !== role ||
      !new RegExp(
        `^hambazi-candidate/${role}:${manifest.sourceCommit}-${manifest.buildInputSha256.slice(0, 16)}@sha256:[a-f0-9]{64}$`,
      ).test(image.image)
    )
      invalid();
  }
  return Object.freeze({
    profile: stagingTestDeferralProfile,
    imageScanStatus: "deferred-not-passed",
    productionReleaseApproved: false,
    publicReleaseApproved: false,
    expiresAt: record.expiresAt,
    approvalSha256: hash(JSON.stringify(record)),
    sourceCommit: record.sourceCommit,
  });
}

/** Actual host readback, no caller-supplied target override and no live mutations. */
export async function readStagingTestDeferralTarget(inputs, privateFile, record) {
  if (
    !Object.values(networkInterfaces())
      .flat()
      .some((n) => n?.address === address)
  )
    invalid();
  const id = (
    await runGate("staging-test-deferral-daemon", "docker", ["info", "--format", "{{.ID}}"])
  ).trim();
  if (id !== daemon || !inputs.ownerAdmissionFile || !inputs.stagingTestAdmissionFile) invalid();
  const owner = await privateFile(inputs.ownerAdmissionFile),
    tester = await privateFile(inputs.stagingTestAdmissionFile);
  const a = JSON.parse(owner),
    b = JSON.parse(tester);
  const timer = await runGate("staging-test-deferral-expiry", "systemctl", [
    "cat",
    "hambazi-staging-advisory-expiry.timer",
  ]);
  const props = await runGate("staging-test-deferral-expiry-state", "systemctl", [
    "show",
    "hambazi-staging-advisory-expiry.timer",
    "--property=NextElapseUSecRealtime",
    "--property=ActiveState",
    "--property=UnitFileState",
  ]);
  const fields = Object.fromEntries(
    props
      .trim()
      .split("\n")
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
  const containers = [];
  for (const name of protectedNames) {
    const [c] = JSON.parse(
      await runGate("staging-test-deferral-protected-container", "docker", ["inspect", name]),
    );
    if (!c.State.Running) invalid();
    containers.push({ name, id: c.Id, image: c.Config.Image });
  }
  if (
    !sameKeys(record?.retainedEvidence, [
      "sourceSecurity",
      "sdkIntegrity",
      "packagedAcceptance",
      "rollbackCompatibility",
    ])
  )
    invalid();
  const evidence = {};
  for (const [kind, entry] of Object.entries(record.retainedEvidence)) {
    if (
      !sameKeys(entry, ["file", "sha256"]) ||
      typeof entry.file !== "string" ||
      !entry.file.startsWith("/opt/hambazi-staging/private/") ||
      !digest(entry.sha256)
    )
      invalid();
    const raw = await privateFile(entry.file);
    if (hash(raw) !== entry.sha256) invalid();
    const report = JSON.parse(raw);
    if (
      report.schemaVersion !== 1 ||
      report.kind !== kind ||
      report.passed !== true ||
      report.sourceSnapshotSha256 !== record.sourceSnapshotSha256
    )
      invalid();
    evidence[kind] = {
      sha256: entry.sha256,
      passed: true,
      sourceSnapshotSha256: report.sourceSnapshotSha256,
    };
  }
  return {
    address,
    dockerDaemonId: id,
    retainedEvidence: evidence,
    ownerAdmissionSha256: hash(owner),
    testerAdmissionSha256: hash(tester),
    exactlyTwoDistinctIdentities:
      a.telegramUserIds?.length === 1 &&
      b.telegramUserIds?.length === 1 &&
      a.telegramUserIds[0] !== b.telegramUserIds[0],
    containmentServiceSha256: hash(await readFile(service)),
    containmentTimerSha256: hash(timer),
    containmentExpiresAt: new Date(Date.parse(fields.NextElapseUSecRealtime)).toISOString(),
    containmentEnabled: fields.ActiveState === "active" && fields.UnitFileState === "enabled",
    protectedContainers: containers,
  };
}
