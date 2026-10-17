import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { privateFile, validateInventory } from "./prepare.mjs";
import { readStagingTestDeferralTarget } from "./staging-test-deferral.mjs";
import { inspectOperator } from "./operator.mjs";
import { runGate } from "../ci/gates.mjs";
import { validatePublicHeaders } from "./staging-acceptance.mjs";
const hash = (v) => createHash("sha256").update(v).digest("hex");
const requireProof = (ok) => {
  if (!ok) throw new Error("KAHROBA_STAGING_TEST_ACCEPTANCE_INVALID");
};
/** Read-only post-deployment check. Does not deploy, renew, create sessions or claim native acceptance. */
export async function inspectKahrobaStagingTest(bindingPath) {
  const binding = JSON.parse(await privateFile(bindingPath));
  requireProof(
    binding.schemaVersion === 1 &&
      binding.profile === "kahroba-two-account-staging-test-v1" &&
      binding.productionReleaseApproved === false &&
      binding.publicReleaseApproved === false,
  );
  const load = async (entry) => {
    requireProof(isAbsolute(entry?.file ?? "") && /^[a-f0-9]{64}$/.test(entry.sha256 ?? ""));
    const bytes = await privateFile(entry.file);
    requireProof(hash(bytes) === entry.sha256);
    return JSON.parse(bytes);
  };
  const manifest = await load(binding.manifest),
    exception = await load(binding.scanDeferral);
  const prepared = await load(binding.preparation);
  requireProof(
    isAbsolute(binding.preparedDirectory ?? "") &&
      isAbsolute(binding.retainedBotPreparedDirectory ?? ""),
  );
  const inputs = await load(binding.inputs);
  const target = await readStagingTestDeferralTarget(inputs, privateFile, exception);
  validateInventory(manifest, exception, undefined, target);
  requireProof(
    prepared.scanStatus === "deferred-not-passed" &&
      prepared.scanDeferralSha256 === binding.scanDeferral.sha256 &&
      prepared.sourceDirty === false &&
      prepared.sourceCommit === manifest.sourceCommit &&
      prepared.ownerAdmission?.memberCount === 1 &&
      prepared.stagingTestAdmission?.memberCount === 1 &&
      prepared.stagingTestAdmission?.grantsAdministrator === false,
  );
  requireProof(
    hash(await privateFile(join(binding.preparedDirectory, "compose.yaml"))) ===
      prepared.composeSha256,
  );
  const roles = [];
  for (const role of ["worker", "api", "web"]) {
    const image = manifest.images.find((x) => x.role === role).image;
    const [container] = JSON.parse(
      await runGate("kahroba-staging-application-pin", "docker", [
        "inspect",
        `hambazi-preparation-${role}-1`,
      ]),
    );
    requireProof(
      container.Config.Image === image &&
        container.State.Running &&
        container.State.Health?.Status === "healthy",
    );
    const ready = await inspectOperator(binding.preparedDirectory, role, "ready");
    requireProof(ready.status === "READY");
    roles.push({ role, ready: true, image });
  }
  const botReady = await inspectOperator(binding.retainedBotPreparedDirectory, "bot", "ready");
  requireProof(botReady.status === "READY");
  const checks = [];
  for (const [origin, path, status] of [
    ["https://staging.hambazi.top", "/", 200],
    ["https://api-staging.hambazi.top", "/v1/kahroba/capabilities", 401],
    ...["/v1/games", "/v1/rooms", "/v1/admin/games", "/v1/health/ready", "/metrics"].map((p) => [
      "https://api-staging.hambazi.top",
      p,
      404,
    ]),
  ]) {
    const response = await fetch(origin + path, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    await response.body?.cancel();
    requireProof(response.status === status);
    if (path === "/") validatePublicHeaders(response.headers, manifest.browserPolicy.headers);
    checks.push({ path, expectedStatus: status, passed: true });
  }
  const finalTarget = await readStagingTestDeferralTarget(inputs, privateFile, exception);
  requireProof(isDeepStrictEqual(target, finalTarget));
  validateInventory(manifest, exception, undefined, finalTarget);
  return {
    schemaVersion: 1,
    purpose: "restricted-kahroba-staging-test-acceptance",
    checkedAt: new Date().toISOString(),
    stagingOperationalChecksPassed: true,
    sourceCommit: manifest.sourceCommit,
    roles,
    retainedBotReady: true,
    publicChecks: checks,
    imageScanStatus: "deferred-not-passed",
    scanDeferralSha256: binding.scanDeferral.sha256,
    expiresAt: exception.expiresAt,
    nativeAcceptance: "pending-real-two-player-Telegram",
    productionReleaseApproved: false,
    publicReleaseApproved: false,
    changedLiveResources: false,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireProof(process.argv.length === 3);
    console.info(JSON.stringify(await inspectKahrobaStagingTest(resolve(process.argv[2]))));
  } catch {
    console.error("KAHROBA_STAGING_TEST_ACCEPTANCE_FAILED");
    process.exitCode = 1;
  }
}
