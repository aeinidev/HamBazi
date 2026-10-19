import { expect, it } from "vitest";
import { deploymentFixture } from "./fixtures/deployment.mjs";
import { buildIdentity } from "../release/build.mjs";
import { validateInventory } from "../release/prepare.mjs";
import { validateStagingTestDeferral } from "../release/staging-test-deferral.mjs";
import { createBrowserPolicy } from "../../apps/web/security/browser-policy.ts";
import { telegramSdkIntegrity } from "../../apps/web/src/platform/telegram-sdk.ts";
const now = Date.parse("2026-10-17T13:00:00Z");
function fixture() {
  const { manifest } = deploymentFixture();
  manifest.browserPolicy = createBrowserPolicy(
    {
      profile: "production",
      webOrigin: "https://staging.hambazi.top",
      apiOrigin: "https://api-staging.hambazi.top",
      frameAncestors: ["https://web.telegram.org"],
    },
    telegramSdkIntegrity,
  );
  manifest.features = { kahrobaPrivateRuntime: true };
  manifest.buildInputSha256 = buildIdentity(
    manifest.sourceSnapshotSha256,
    manifest.browserPolicy,
    manifest.features,
  );
  manifest.images = ["api", "bot", "worker", "web"].map((role, i) => ({
    role,
    image: `hambazi-candidate/${role}:${manifest.sourceCommit}-${manifest.buildInputSha256.slice(0, 16)}@sha256:${String(i + 1).repeat(64)}`,
  }));
  const protectedContainers = [
    "hambazi-preparation-bot-1",
    "hambazi-staging-platform-ingress-1",
    "hambazi-staging-platform-postgres-staging-1",
    "hambazi-staging-platform-redis-staging-1",
  ].map((name, i) => ({
    name,
    id: String(i + 1).repeat(64),
    image: `synthetic/${i}:pinned@sha256:${String(i + 1).repeat(64)}`,
  }));
  const target = {
    address: "185.110.191.104",
    dockerDaemonId: "342f251a-9e56-4353-af12-a32429b7a2e7",
    ownerAdmissionSha256: "382a3c3185f45bdf787503dfe2594f29e3245faa2e82c3ae0d01ee75b104d817",
    testerAdmissionSha256: "4ad78882f119873a90e2f87c0b8559ee4c20b546988cc4949e164b9dad8d91c6",
    containmentServiceSha256: "ef990122e8d007966cd3fcb24811098cb46e8aee4673ad25a96b1edab884cdc6",
    containmentTimerSha256: "5".repeat(64),
    exactlyTwoDistinctIdentities: true,
    containmentEnabled: true,
    containmentExpiresAt: "2026-10-18T01:13:54Z",
    protectedContainers,
  };
  const record = {
    schemaVersion: 1,
    profile: "kahroba-two-account-staging-test-v1",
    authority: "explicit-owner-staging-test-only-trivy-deferral",
    issuedAt: "2026-10-17T12:59:00Z",
    expiresAt: target.containmentExpiresAt,
    targetAddress: target.address,
    dockerDaemonId: target.dockerDaemonId,
    sourceCommit: manifest.sourceCommit,
    sourceSnapshotSha256: manifest.sourceSnapshotSha256,
    buildInputSha256: manifest.buildInputSha256,
    images: manifest.images,
    ownerAdmissionSha256: target.ownerAdmissionSha256,
    testerAdmissionSha256: target.testerAdmissionSha256,
    containmentServiceSha256: target.containmentServiceSha256,
    containmentTimerSha256: target.containmentTimerSha256,
    protectedContainers,
    retainedEvidence: Object.fromEntries(
      ["sourceSecurity", "sdkIntegrity", "packagedAcceptance", "rollbackCompatibility"].map((k) => [
        k,
        { file: `/opt/hambazi-staging/private/fixture/${k}.json`, sha256: "6".repeat(64) },
      ]),
    ),
    imageScanStatus: "deferred-not-passed",
    productionReleaseApproved: false,
    publicReleaseApproved: false,
  };
  target.retainedEvidence = Object.fromEntries(
    Object.keys(record.retainedEvidence).map((k) => [
      k,
      { sha256: "6".repeat(64), passed: true, sourceSnapshotSha256: manifest.sourceSnapshotSha256 },
    ]),
  );
  return { manifest, record, target };
}
it("records only restricted-test deferral and never passes it as a normal vulnerability scan", () => {
  const f = fixture();
  expect(validateStagingTestDeferral(f.record, f.manifest, f.target, now)).toMatchObject({
    imageScanStatus: "deferred-not-passed",
    productionReleaseApproved: false,
    publicReleaseApproved: false,
  });
  expect(() => validateInventory(f.manifest, f.record)).toThrow();
  expect(() =>
    validateStagingTestDeferral(f.record, f.manifest, f.target, Date.parse(f.record.expiresAt)),
  ).toThrow();
  const normal = deploymentFixture();
  expect(() => validateInventory(normal.manifest, normal.report)).not.toThrow();
});
it.each([
  ["productionReleaseApproved", true],
  ["publicReleaseApproved", true],
  ["imageScanStatus", "passed"],
  ["targetAddress", "127.0.0.1"],
  ["dockerDaemonId", "different"],
  ["ownerAdmissionSha256", "1".repeat(64)],
  ["testerAdmissionSha256", "2".repeat(64)],
  ["containmentTimerSha256", "7".repeat(64)],
  ["expiresAt", "2026-10-18T01:13:55Z"],
  ["expiresAt", "2026-10-17T12:00:00Z"],
  ["issuedAt", "2026-10-17T14:00:00Z"],
  ["sourceCommit", "f".repeat(40)],
  ["unexpected", true],
])("fails closed for changed approval field %s", (key, value) => {
  const f = fixture();
  expect(() =>
    validateStagingTestDeferral({ ...f.record, [key]: value }, f.manifest, f.target, now),
  ).toThrow();
});
it("rejects changed images, dirty/public artifacts, missing evidence and admission/containment drift", () => {
  for (const mutate of [
    (f) => {
      f.manifest.sourceDirty = true;
    },
    (f) => {
      f.manifest.browserPolicy = {
        ...f.manifest.browserPolicy,
        apiOrigin: "https://api.hambazi.top",
      };
    },
    (f) => {
      f.record.images = f.record.images.slice(0, 3);
    },
    (f) => {
      f.target.retainedEvidence.sourceSecurity.passed = false;
    },
    (f) => {
      f.record.protectedContainers = [];
    },
    (f) => {
      f.target.exactlyTwoDistinctIdentities = false;
    },
    (f) => {
      f.target.containmentEnabled = false;
    },
    (f) => {
      f.target.containmentExpiresAt = "2026-10-17T13:00:01Z";
    },
    (f) => {
      f.target.protectedContainers = structuredClone(f.target.protectedContainers);
      f.target.protectedContainers[0].id = "f".repeat(64);
    },
  ]) {
    const f = fixture();
    mutate(f);
    expect(() => validateStagingTestDeferral(f.record, f.manifest, f.target, now)).toThrow();
  }
});
