import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  requiredEvidence,
  validateAcceptanceEvidence,
  validatePublicHeaders,
} from "../release/staging-acceptance.mjs";

const now = Date.parse("2026-10-09T08:00:00Z");
const fixture = () => {
  const binding = {
    schemaVersion: 1,
    application: {
      sourceDirty: false,
      sourceCommit: "a".repeat(40),
      composeSha256: "b".repeat(64),
    },
    ownerTrafficOpened: true,
    personalGameplayEnabled: true,
    nativeOwnerAcceptance: {
      passed: true,
      directlyObservedByAgent: false,
      sourceCommit: "c".repeat(40),
      composeSha256: "d".repeat(64),
    },
    rollbackAcceptance: { passed: true, previousSourceCommit: "c".repeat(40) },
    runtimeRoutesSha256: "f".repeat(64),
    currentEvidence: {},
  };
  const files = {};
  for (const [name, checks] of Object.entries(requiredEvidence)) {
    const proof = {
      schemaVersion: 1,
      checkedAt: "2026-10-08T23:00:00Z",
      passed: true,
      sourceCommit: binding.application.sourceCommit,
      checks: Object.fromEntries(checks.map((key) => [key, true])),
    };
    if (name === "native-release-pair-acceptance-02.json") {
      proof.versionRollbackAccepted = true;
      proof.previousSourceCommit = binding.rollbackAcceptance.previousSourceCommit;
      proof.composeSha256 = binding.application.composeSha256;
    }
    if (name === "native-owner-confirmation-20261009-01.json") {
      proof.sourceCommit = binding.nativeOwnerAcceptance.sourceCommit;
      proof.composeSha256 = binding.nativeOwnerAcceptance.composeSha256;
      proof.evidenceKind = "user-reported-real-native-acceptance";
      proof.directlyObservedByAgent = false;
    }
    if (name === "native-renewal-disposition-05.json") {
      proof.currentDryRunPassed = true;
      proof.normalNoDuePathPassed = true;
    }
    if (name === "native-startup-live-evidence-04.json")
      proof.records = ["chromium", "webkit"].flatMap((engine) =>
        ["fragment", "query", "non-owner"].map((mode) => ({
          engine,
          mode,
          passed: true,
          authLaunchMatches: true,
          launchUrlCleaned: true,
          noCredentialStorage: true,
          cspPassed: true,
          authStatus: mode === "non-owner" ? 401 : 200,
        })),
      );
    if (name === "native-accepted-runtime-fingerprints-02.json")
      proof.records = ["api", "bot", "worker", "web"].map((role) => ({
        role,
        match: true,
        local: { sha256: "e".repeat(64) },
        target: { sha256: "e".repeat(64) },
      }));
    if (name === "native-final-public-03.json") {
      proof.publicWebHeaderPolicyVerified = true;
      proof.sdk = { trustedPublicTLS: true };
      proof.checks = Array.from({ length: 8 }, () => ({ passed: true }));
      proof.publicDataPorts = [5432, 6379].map((port) => ({ port, publicConnectionDenied: true }));
    }
    if (name === "phase18b3-header-fix-20261009-01.json") {
      proof.routeSha256 = binding.runtimeRoutesSha256;
      proof.actualNginxParserPassed = true;
      proof.atomicReloadPassed = true;
      proof.records = Array.from({ length: 6 }, () => ({
        exactPolicyMatched: true,
        headerCount: 1,
      }));
    }
    replace(binding, files, name, proof);
  }
  return { binding, files };
};
function replace(binding, files, name, proof) {
  files[name] = Buffer.from(JSON.stringify(proof));
  binding.currentEvidence[name] = {
    sha256: createHash("sha256").update(files[name]).digest("hex"),
  };
}

it("reuses exact native lineage and actual acceptance without claiming new tests or release authority", () => {
  const { binding, files } = fixture();
  const result = validateAcceptanceEvidence(binding, files, now);
  expect(result).toHaveLength(10);
  expect(result.every((r) => Object.keys(r).join() === "name,sha256")).toBe(true);
});

it("denies missing or tampered evidence even if a passed flag survives", () => {
  for (const mutate of [
    (f) => delete f[Object.keys(requiredEvidence)[0]],
    (f) => {
      f[Object.keys(requiredEvidence)[0]] = Buffer.from('{"passed":true}');
    },
  ]) {
    const { binding, files } = fixture();
    mutate(files);
    expect(() => validateAcceptanceEvidence(binding, files, now)).toThrow();
  }
});

for (const [name, mutate] of [
  [
    "foreign-source",
    (p) => {
      p.sourceCommit = "f".repeat(40);
    },
  ],
  [
    "missing-source",
    (p) => {
      delete p.sourceCommit;
    },
  ],
  [
    "wrong-compose",
    (p) => {
      p.composeSha256 = "f".repeat(64);
    },
  ],
  [
    "future-report",
    (p) => {
      p.checkedAt = "2026-10-10T00:00:00Z";
    },
  ],
  [
    "lost-receipt-proof",
    (p) => {
      p.checks["single-original-command-storage"] = false;
    },
  ],
  [
    "unsupported-rollback",
    (p) => {
      p.previousSourceCommit = "f".repeat(40);
    },
  ],
])
  it(`denies ${name} with a correctly hashed report`, () => {
    const { binding, files } = fixture();
    const key = "native-release-pair-acceptance-02.json";
    const proof = JSON.parse(files[key]);
    mutate(proof);
    replace(binding, files, key, proof);
    expect(() => validateAcceptanceEvidence(binding, files, now)).toThrow();
  });

it("denies duplicated browser scenarios and fabricated native observation", () => {
  for (const key of [
    "native-startup-live-evidence-04.json",
    "native-owner-confirmation-20261009-01.json",
  ]) {
    const { binding, files } = fixture();
    const proof = JSON.parse(files[key]);
    if (proof.records) proof.records[1] = proof.records[0];
    else proof.directlyObservedByAgent = true;
    replace(binding, files, key, proof);
    expect(() => validateAcceptanceEvidence(binding, files, now)).toThrow();
  }
});

it("denies app-content mismatch and a reopened data port", () => {
  for (const key of [
    "native-accepted-runtime-fingerprints-02.json",
    "native-final-public-03.json",
  ]) {
    const { binding, files } = fixture();
    const proof = JSON.parse(files[key]);
    if (proof.records) proof.records[0].target.sha256 = "f".repeat(64);
    else proof.publicDataPorts[0].publicConnectionDenied = false;
    replace(binding, files, key, proof);
    expect(() => validateAcceptanceEvidence(binding, files, now)).toThrow();
  }
});

it("denies duplicated or weakened public headers instead of accepting only the first value", () => {
  const policy = { "X-Content-Type-Options": "nosniff", "Permissions-Policy": "camera=(), usb=()" };
  expect(() => validatePublicHeaders(new Headers(policy), policy)).not.toThrow();
  for (const patch of [
    { "X-Content-Type-Options": "nosniff, nosniff" },
    { "Permissions-Policy": "camera=()" },
    { "Permissions-Policy": "camera=(), usb=(), camera=()" },
  ])
    expect(() => validatePublicHeaders(new Headers({ ...policy, ...patch }), policy)).toThrow();
});
