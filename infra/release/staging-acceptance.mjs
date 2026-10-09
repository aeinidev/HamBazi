import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";
import { privateFile, validateInventory } from "./prepare.mjs";
import { inspectOperator } from "./operator.mjs";
import { runGate } from "../ci/gates.mjs";
import { projectScan } from "../ci/scan-evidence.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const requireProof = (ok) => {
  if (!ok) throw new Error("STAGING_ACCEPTANCE_INVALID");
};

export function validatePublicHeaders(headers, policy) {
  for (const [name, value] of Object.entries(policy)) requireProof(headers.get(name) === value);
}
// These are immutable, reviewed actual-target reports, not newly simulated tests.
export const requiredEvidence = Object.freeze({
  "native-release-pair-acceptance-02.json": [
    "rollback-original-command-receipt",
    "rollback-active-pins-retained",
    "single-original-command-storage",
    "rollback-event-sequence-contiguous",
    "fourteen-migrations-retained-no-new-sql",
  ],
  "native-data-fault-acceptance-03.json": [
    "postgres-loss-preserves-durable-counts",
    "existing-session-available-during-redis-loss",
    "fresh-auth-fails-closed-during-redis-loss",
    "denied-redis-loss-auth-zero-durable-effects",
    "logout-revocation-survives-redis-recovery",
  ],
  "native-owner-access-03.json": [
    "negative-admission-zero-durable-effects",
    "owner-session-authenticated",
    "invalid-policy-revokes-existing-session-authority",
    "public-webhook-withheld",
  ],
  "native-game-acceptance-03.json": [
    "opponent-public-fields-only",
    "independent-bot-no-fake-user",
    "game-command-idempotent-retry",
    "reconnect-fresh-snapshot",
    "actual-game-finished",
    "personal-result-excluded-from-competition",
  ],
  "native-final-public-03.json": [],
  "native-startup-live-evidence-04.json": [],
  "native-accepted-runtime-fingerprints-02.json": [],
  "native-owner-confirmation-20261009-01.json": [],
  "native-renewal-disposition-05.json": [],
  "phase18b3-header-fix-20261009-01.json": [],
});

/** Bind historical acceptance to this exact deployment; never advance a phase here. */
export function validateAcceptanceEvidence(binding, files, now = Date.now()) {
  requireProof(
    binding?.schemaVersion === 1 &&
      binding.application?.sourceDirty === false &&
      binding.ownerTrafficOpened === true &&
      binding.personalGameplayEnabled === true &&
      binding.nativeOwnerAcceptance?.passed === true &&
      binding.nativeOwnerAcceptance.directlyObservedByAgent === false &&
      binding.rollbackAcceptance?.passed === true &&
      binding.nativeOwnerAcceptance.sourceCommit ===
        binding.rollbackAcceptance.previousSourceCommit,
  );
  const reused = [];
  for (const [name, checks] of Object.entries(requiredEvidence)) {
    const bytes = files[name];
    requireProof(
      Buffer.isBuffer(bytes) && digest(bytes) === binding.currentEvidence?.[name]?.sha256,
    );
    const proof = JSON.parse(bytes);
    requireProof(proof.schemaVersion === 1);
    if (name === "native-renewal-disposition-05.json") {
      requireProof(proof.currentDryRunPassed === true && proof.normalNoDuePathPassed === true);
    } else requireProof(proof.passed === true);
    const time = Date.parse(proof.checkedAt ?? proof.recordedAtUTC);
    requireProof(Number.isFinite(time) && time <= now);
    if (name !== "native-renewal-disposition-05.json")
      requireProof(
        proof.sourceCommit ===
          (name === "native-owner-confirmation-20261009-01.json"
            ? binding.nativeOwnerAcceptance.sourceCommit
            : binding.application.sourceCommit),
      );
    if (name === "native-owner-confirmation-20261009-01.json")
      requireProof(
        proof.evidenceKind === "user-reported-real-native-acceptance" &&
          proof.directlyObservedByAgent === false &&
          proof.composeSha256 === binding.nativeOwnerAcceptance.composeSha256,
      );
    else if (proof.composeSha256)
      requireProof(proof.composeSha256 === binding.application.composeSha256);
    requireProof(checks.every((key) => proof.checks?.[key] === true));
    if (name === "native-release-pair-acceptance-02.json")
      requireProof(
        proof.versionRollbackAccepted === true &&
          proof.previousSourceCommit === binding.rollbackAcceptance.previousSourceCommit,
      );
    if (name === "native-startup-live-evidence-04.json") {
      requireProof(proof.records?.length === 6);
      for (const engine of ["chromium", "webkit"])
        for (const mode of ["fragment", "query", "non-owner"]) {
          const records = proof.records.filter((r) => r.engine === engine && r.mode === mode);
          requireProof(
            records.length === 1 &&
              [
                "passed",
                "authLaunchMatches",
                "launchUrlCleaned",
                "noCredentialStorage",
                "cspPassed",
              ].every((key) => records[0][key] === true) &&
              records[0].authStatus === (mode === "non-owner" ? 401 : 200),
          );
        }
    }
    if (name === "native-accepted-runtime-fingerprints-02.json")
      requireProof(
        proof.records?.length === 4 &&
          proof.records.every((r) => r.match === true && isDeepStrictEqual(r.local, r.target)) &&
          new Set(proof.records.map((r) => r.role)).size === 4,
      );
    if (name === "native-final-public-03.json")
      requireProof(
        proof.publicWebHeaderPolicyVerified === true &&
          proof.sdk?.trustedPublicTLS === true &&
          proof.checks?.length === 8 &&
          proof.checks.every((r) => r.passed === true) &&
          proof.publicDataPorts?.length === 2 &&
          proof.publicDataPorts.every((r) => r.publicConnectionDenied === true),
      );
    if (name === "phase18b3-header-fix-20261009-01.json")
      requireProof(
        proof.routeSha256 === binding.runtimeRoutesSha256 &&
          proof.actualNginxParserPassed === true &&
          proof.atomicReloadPassed === true &&
          proof.records?.length === 6 &&
          proof.records.every((r) => r.exactPolicyMatched === true && r.headerCount === 1),
      );
    reused.push({ name, sha256: digest(bytes) });
  }
  return reused;
}

/** Read-only owner-SSH gate. No credentials, initData, game state or raw diagnostics leave it. */
export async function inspectStagingAcceptance(bindingPath) {
  const binding = JSON.parse(await readFile(bindingPath, "utf8"));
  const base = "/opt/hambazi-staging/private";
  requireProof(
    binding.privateExecutionDirectory === join(base, "execution-20261008") &&
      binding.preparedDirectory === join(base, "prepared-20261009-native-accepted-02") &&
      Object.values(networkInterfaces())
        .flat()
        .some((n) => n?.address === binding.target.ipv4),
  );
  requireProof(
    (await runGate("staging-daemon", "docker", ["info", "--format", "{{.ID}}"])).trim() ===
      binding.target.dockerDaemonId,
  );
  const files = {};
  for (const name of Object.keys(requiredEvidence))
    files[name] = await privateFile(join(binding.privateExecutionDirectory, "evidence", name));
  const reused = validateAcceptanceEvidence(binding, files);
  requireProof(
    digest(await privateFile(join(binding.privateExecutionDirectory, "nginx/routes.conf"))) ===
      binding.runtimeRoutesSha256,
  );
  const release = join(binding.privateExecutionDirectory, "release-native-accepted-02");
  const readBound = async (path, expectedHash) => {
    const bytes = await privateFile(path);
    requireProof(digest(bytes) === expectedHash);
    return JSON.parse(bytes);
  };
  const manifest = await readBound(
    join(release, "images.json"),
    binding.application.inventorySha256,
  );
  const app = await readBound(
    join(release, "images.json.scan.json"),
    binding.application.scanSha256,
  );
  validateInventory(manifest, app); // Existing normal 24-hour policy; no exception context.
  requireProof(isDeepStrictEqual(manifest.images, binding.application.images));
  const component = await readBound(
    join(release, "components.scan.json"),
    binding.components.scanSha256,
  );
  const data = await readBound(join(release, "data.scan.json"), binding.dataScanSha256);
  for (const report of [component, data])
    projectScan({ ...report, kind: "images", status: "passed" }, "images");
  requireProof(
    isDeepStrictEqual(
      component.images.map((i) => i.image),
      binding.components.images.map((i) => i.image),
    ),
  );
  const prepared = await readBound(
    join(binding.preparedDirectory, "preparation.json"),
    binding.application.preparationSha256,
  );
  requireProof(
    prepared.sourceCommit === manifest.sourceCommit &&
      prepared.ownerAdmission?.profile === "telegram-owner-only-v1" &&
      prepared.ownerAdmission.memberCount === 1,
  );
  const definitionBytes = await privateFile(join(binding.preparedDirectory, "compose.yaml"));
  requireProof(digest(definitionBytes) === binding.application.composeSha256);
  const definition = parse(definitionBytes.toString(), { merge: true });
  const roles = [];
  for (const item of binding.application.images) {
    requireProof(definition.services?.[item.role]?.image === item.image);
    const ready = await inspectOperator(binding.preparedDirectory, item.role, "ready");
    const logs = await inspectOperator(binding.preparedDirectory, item.role, "logs");
    requireProof(ready.status === "READY" && logs.omitted === 0);
    if (item.role !== "web") await inspectOperator(binding.preparedDirectory, item.role, "metrics");
    roles.push({ role: item.role, ready: true, safeLogs: true });
  }
  // Check stored scan pins against the actual data and ingress containers, not tags alone.
  for (const [role, image] of [
    ["postgres-staging", data.images[0].image],
    ["redis-staging", data.images[1].image],
    ["ingress", component.images[0].image],
  ]) {
    const actual = (
      await runGate("staging-platform-image", "docker", [
        "inspect",
        "--format",
        "{{.Image}}",
        `hambazi-staging-platform-${role}-1`,
      ])
    ).trim();
    requireProof(actual === image.split("@")[1]);
  }
  const acme = JSON.parse(
    await runGate("staging-acme-image", "docker", [
      "image",
      "inspect",
      "--format",
      "{{json .Id}}",
      component.images[1].image,
    ]),
  );
  requireProof(acme === component.images[1].image.split("@")[1]);
  const publicChecks = [];
  for (const [origin, path, expectedStatus] of [
    [manifest.browserPolicy.webOrigin, "/", 200],
    ["https://bot-staging.hambazi.top", "/v1/telegram/webhook", 404],
    ...[
      "/v1/health/ready",
      "/v1/metrics",
      "/v1/internal/bot",
      "/v1/admin/games",
      "/v1/rooms",
      "/v1/games",
    ].map((path) => [manifest.browserPolicy.apiOrigin, path, 404]),
  ]) {
    const response = await fetch(origin + path, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    await response.body?.cancel();
    requireProof(response.status === expectedStatus);
    if (path === "/") validatePublicHeaders(response.headers, manifest.browserPolicy.headers);
    publicChecks.push({ path, expectedStatus, passed: true });
  }
  const timer = (
    await runGate("staging-expiry-timer", "systemctl", [
      "show",
      "--property=NextElapseUSecRealtime",
      "--value",
      "hambazi-staging-advisory-expiry.timer",
    ])
  ).trim();
  const expiresAt = Math.min(
    ...[app, component, data].map((r) => Date.parse(r.database.updatedAt) + 86400000),
  );
  requireProof(Date.parse(timer) === Math.floor(expiresAt / 1000) * 1000);
  return {
    schemaVersion: 1,
    purpose: "owner-only-staging-acceptance",
    checkedAt: new Date().toISOString(),
    passed: true,
    sourceCommit: manifest.sourceCommit,
    composeSha256: binding.application.composeSha256,
    evidenceReused: reused,
    normalFreshImageGates: 8,
    roles,
    publicChecks,
    expiryTimerInstalled: true,
    futureExpiryExecutionTested: false,
    scanEvidenceExpiresAt: new Date(expiresAt).toISOString(),
    nativeAcceptance: "user-reported; previous accepted native lineage",
    backupRestore: "excluded-unperformed-ADR-050",
    productionReleaseApproved: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireProof(process.argv.length === 3);
    console.info(JSON.stringify(await inspectStagingAcceptance(resolve(process.argv[2]))));
  } catch {
    console.error("OWNER_ONLY_STAGING_ACCEPTANCE_FAILED");
    process.exitCode = 1;
  }
}
