import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import {
  assessAudit,
  assessSecrets,
  assessProvenanceSecrets,
  assessImage,
  assertFreshDatabase,
  verifyTool,
  snapshotCandidate,
  scan,
} from "../scripts/security-scan.mjs";
const run = promisify(execFile);
const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
const cleanAudit = { metadata: { vulnerabilities: counts }, advisories: {} };
const image = "redis:8.10.1-trixie@sha256:" + "a".repeat(64);
const cleanImage = {
  SchemaVersion: 2,
  ArtifactType: "container_image",
  ArtifactName: image,
  Results: [{ Class: "os-pkgs" }],
};

it("admits only pinned clean-source staging artifact names and preserves Unknown/High blocks", () => {
  const ref =
    "hambazi-staging/ingress:" +
    "a".repeat(40) +
    "-" +
    "b".repeat(16) +
    "@sha256:" +
    "c".repeat(64);
  const report = { ...cleanImage, ArtifactName: ref };
  expect(assessImage(report, ref).ok).toBe(true);
  for (const severity of ["HIGH", "CRITICAL", "UNKNOWN"])
    expect(
      assessImage(
        {
          ...report,
          Results: [
            {
              Class: "os-pkgs",
              Vulnerabilities: [
                { VulnerabilityID: "CVE-2026-12345", PkgName: "synthetic", Severity: severity },
              ],
            },
          ],
        },
        ref,
      ).ok,
    ).toBe(false);
  for (const bad of ["nginx:latest", "hambazi-staging/ingress:latest@sha256:" + "c".repeat(64)])
    expect(() => assessImage({ ...report, ArtifactName: bad }, bad)).toThrow();
});

it("blocks known High dependencies and rejects unavailable/inconsistent audit evidence", () => {
  expect(assessAudit(cleanAudit, 0)).toMatchObject({ ok: true, findings: [] });
  const advisory = {
    severity: "high",
    github_advisory_id: "GHSA-abcd-efgh-ijkl",
    module_name: "example",
    title: "private-payload",
  };
  const found = {
    metadata: { vulnerabilities: { ...counts, high: 1 } },
    advisories: { one: advisory },
  };
  const result = assessAudit(found, 1);
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain("private-payload");
  for (const [data, code] of [
    [cleanAudit, 1],
    [found, 0],
    [found, 2],
    [{}, 0],
    [{ ...found, error: {} }, 1],
    [{ ...found, metadata: cleanAudit.metadata }, 1],
  ])
    expect(() => assessAudit(data, code)).toThrow("SECURITY_SCAN_INVALID_EVIDENCE");
});
it("every secret blocks without exporting matched content, author, path or fingerprints", () => {
  expect(assessSecrets([], 0)).toEqual({ ok: true, findings: 0 });
  const result = assessSecrets(
    [
      {
        Secret: "private",
        Match: "private",
        File: "private",
        Author: "private",
        Fingerprint: "private",
      },
    ],
    1,
  );
  expect(result).toEqual({ ok: false, findings: 1 });
  expect(JSON.stringify(result)).not.toContain("private");
  for (const [report, code] of [
    [[], 1],
    [null, 0],
    [[], 2],
    [[{}], 0],
  ])
    expect(() => assessSecrets(report, code)).toThrow();
});
it("blocks fixed and unfixed High/Critical/unknown image findings without discarding their severity", () => {
  expect(assessImage(cleanImage, image).ok).toBe(true);
  for (const severity of ["HIGH", "CRITICAL", "UNKNOWN"]) {
    const result = assessImage(
      {
        ...cleanImage,
        Results: [
          {
            Class: "os-pkgs",
            Vulnerabilities: [
              {
                VulnerabilityID: "CVE-2026-12345",
                PkgName: "example",
                Severity: severity,
                Description: "private-payload",
              },
            ],
          },
        ],
      },
      image,
    );
    expect(result.ok).toBe(false);
    expect(result.findings[0].fixAvailable).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-payload");
  }
  const vendor = assessImage(
    {
      ...cleanImage,
      Results: [
        {
          Class: "os-pkgs",
          Vulnerabilities: [
            {
              VulnerabilityID: "DLA-4783-1",
              PkgName: "example",
              Severity: "HIGH",
              FixedVersion: "1.2.3",
            },
          ],
        },
      ],
    },
    image,
  );
  expect(vendor).toMatchObject({ ok: false, findings: [{ id: "DLA-4783-1", fixAvailable: true }] });
  expect(() =>
    assessImage(
      {
        ...cleanImage,
        Results: [
          {
            Class: "os-pkgs",
            Vulnerabilities: [
              { VulnerabilityID: "CVE-2026-12345", PkgName: "example", Severity: "constructor" },
            ],
          },
        ],
      },
      image,
    ),
  ).toThrow();
  for (const report of [
    {},
    { ...cleanImage, Results: [] },
    { ...cleanImage, ArtifactName: "other" },
    { ...cleanImage, Results: [{ Class: "os-pkgs", Vulnerabilities: "ignored" }] },
  ])
    expect(() => assessImage(report, image)).toThrow();
  expect(() => assessImage(cleanImage, "redis:latest")).toThrow();
  const derived = "hambazi-local/postgres:18.6-alpine3.24-v1@sha256:" + "b".repeat(64);
  expect(assessImage({ ...cleanImage, ArtifactName: derived }, derived).ok).toBe(true);
  expect(() => assessImage(cleanImage, "hambazi-local/postgres:latest")).toThrow();
  const lower = assessImage(
    {
      ...cleanImage,
      Results: [
        {
          Class: "os-pkgs",
          Vulnerabilities: [
            {
              VulnerabilityID: "CVE-2026-12345",
              PkgName: "example",
              Severity: "MEDIUM",
              Description: "private-payload",
            },
          ],
        },
      ],
    },
    image,
  );
  expect(lower).toMatchObject({
    ok: true,
    counts: { moderate: 1 },
    findings: [{ id: "CVE-2026-12345", severity: "moderate" }],
  });
  expect(JSON.stringify(lower)).not.toContain("private-payload");
});
it("refuses stale/future/malformed vulnerability databases even after a recent download", () => {
  const now = Date.parse("2026-10-02T10:00:00Z");
  const valid = {
    Version: 2,
    UpdatedAt: new Date(now - 3600000).toISOString(),
    DownloadedAt: new Date(now).toISOString(),
  };
  expect(assertFreshDatabase(valid, now)).toHaveProperty("updatedAt", valid.UpdatedAt);
  for (const bad of [
    { ...valid, Version: 1 },
    { ...valid, UpdatedAt: "bad" },
    { ...valid, UpdatedAt: new Date(now - 86400001).toISOString() },
    { ...valid, DownloadedAt: new Date(now + 300001).toISOString() },
  ])
    expect(() => assertFreshDatabase(bad, now)).toThrow();
});
it("rejects substituted executables and symlinks before starting a scanner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hambazi-scan-test-"));
  try {
    const fake = join(directory, "fake");
    await writeFile(fake, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await expect(verifyTool(fake, "gitleaks")).rejects.toThrow();
    await writeFile(join(directory, "trivy"), "fake", { mode: 0o700 });
    expect(await scan("images", directory)).toMatchObject({
      ok: false,
      status: "failed",
      stage: "tool-integrity",
    });
    const link = join(directory, "link");
    await symlink(fake, link);
    await expect(verifyTool(link, "gitleaks")).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("candidate capture includes tracked edits and new nonignored files, excludes ignored secrets and refuses symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hambazi-scan-test-"));
  const repository = join(directory, "repo"),
    candidate = join(directory, "candidate");
  try {
    await mkdir(repository);
    await mkdir(candidate);
    await run("git", ["init", "--quiet"], { cwd: repository });
    await writeFile(join(repository, ".gitignore"), ".env\n");
    await writeFile(join(repository, "tracked.txt"), "old");
    await run("git", ["add", "."], { cwd: repository });
    await writeFile(join(repository, "tracked.txt"), "modified");
    await writeFile(join(repository, "new.txt"), "new");
    await writeFile(join(repository, ".env"), "private");
    expect(await snapshotCandidate(candidate, repository + "/")).toBe(3);
    expect(await readFile(join(candidate, "tracked.txt"), "utf8")).toBe("modified");
    await expect(readFile(join(candidate, ".env"))).rejects.toThrow();
    await symlink(join(repository, ".env"), join(repository, "external"));
    await expect(snapshotCandidate(candidate, repository)).rejects.toThrow();
    await rm(join(repository, "external"));
    await mkdir(join(repository, "nested"));
    await writeFile(join(repository, "nested/file.txt"), "tracked");
    await run("git", ["add", "nested"], { cwd: repository });
    await rm(join(repository, "nested"), { recursive: true });
    expect(await snapshotCandidate(candidate, repository)).toBe(3);
    const outside = join(directory, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "file.txt"), "external-private");
    await symlink(outside, join(repository, "nested"));
    await expect(snapshotCandidate(candidate, repository)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it.skipIf(!process.env.SECURITY_SCANNER_DIR)(
  "real pinned scanner catches a generated canary in history and directory, and ignores only the exact normative prose",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "hambazi-scan-canary-"));
    try {
      const executable = resolve(process.env.SECURITY_SCANNER_DIR, "gitleaks");
      await verifyTool(executable, "gitleaks");
      await run("git", ["init", "--quiet"], { cwd: directory });
      await mkdir(join(directory, "docs"));
      await writeFile(
        join(directory, "docs/implementation-plan.md"),
        ["secret", "key ID,", "issuance/expiry", "timestamps\n"].join(" "),
      );
      const report = join(directory, "report.json"),
        config = resolve("infra/security/gitleaks.toml");
      const args = [
        "--config",
        config,
        "--no-banner",
        "--redact=100",
        "--ignore-gitleaks-allow",
        "--report-format=json",
        "--report-path",
        report,
      ];
      await run(executable, ["dir", ...args, directory]);
      expect(assessSecrets(JSON.parse(await readFile(report, "utf8")), 0).ok).toBe(true);
      const generated = ["ghp", "_", randomBytes(18).toString("hex")].join("");
      await writeFile(join(directory, "canary.txt"), generated);
      await run("git", ["add", "docs", "canary.txt"], { cwd: directory });
      await run(
        "git",
        [
          "-c",
          "user.name=HamBazi scan test",
          "-c",
          "user.email=scan-test@example.invalid",
          "commit",
          "--quiet",
          "-m",
          "Disposable scanner fixture",
        ],
        { cwd: directory },
      );
      for (const mode of ["dir", "git"]) {
        let code = 0;
        try {
          await run(executable, [mode, ...args, directory]);
        } catch (e) {
          code = e.code;
        }
        const result = assessSecrets(JSON.parse(await readFile(report, "utf8")), code);
        expect(result.ok).toBe(false);
        expect(result.findings).toBeGreaterThan(0);
        expect(await readFile(report, "utf8")).not.toContain(generated);
      }
      await writeFile(join(directory, "canary.txt"), "removed");
      let code = 0;
      try {
        await run(executable, ["git", ...args, directory]);
      } catch (e) {
        code = e.code;
      }
      expect(assessSecrets(JSON.parse(await readFile(report, "utf8")), code).ok).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  15000,
);

it.skipIf(!process.env.SECURITY_SCANNER_DIR)(
  "the approved provenance exception preserves detection outside its exact reviewed field, value, path, rule and bytes",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "hambazi-provenance-canary-"));
    try {
      const executable = resolve(process.env.SECURITY_SCANNER_DIR, "gitleaks");
      await verifyTool(executable, "gitleaks");
      const exception = JSON.parse(
        await readFile(resolve("infra/security/gitleaks-provenance-exception.json"), "utf8"),
      );
      const original = await readFile(resolve(exception.path), "utf8");
      const fixture = join(directory, "repo");
      const path = join(fixture, exception.path);
      await mkdir(join(fixture, "infra/docker/staging"), { recursive: true });
      await run("git", ["init", "--quiet"], { cwd: fixture });
      const report = join(directory, "report.json");
      const ignore = join(directory, "empty-ignore");
      await writeFile(ignore, "", { mode: 0o600 });
      const args = [
        "--config",
        resolve("infra/security/gitleaks.toml"),
        "--gitleaks-ignore-path",
        ignore,
        "--ignore-gitleaks-allow",
        "--redact=100",
        "--no-banner",
        "--no-color",
        "--timeout=120",
        "--max-archive-depth=2",
        "--report-format=json",
        "--report-path",
        report,
      ];
      const generated = ["ghp", "_", randomBytes(18).toString("hex")].join("");
      // Fixed symbol counts ensure detector entropy; randomness only permutes them.
      const symbols = [...("0123456789abcdef".repeat(2) + "01234567")];
      const changedRevision = [...randomBytes(symbols.length)]
        .map((byte) => symbols.splice(byte % symbols.length, 1)[0])
        .join("");
      const inspect = async (scope) => {
        let code = 0;
        try {
          await run(executable, [scope === "history" ? "git" : "dir", ...args, fixture]);
        } catch (error) {
          // Never let execFile's raw diagnostics escape through a rejected test.
          code = error.code === 1 ? 1 : -1;
        }
        if (code === -1) throw new Error("CANARY_SCANNER_FAILED");
        const raw = await readFile(report, "utf8");
        expect(raw.includes(generated) || raw.includes(changedRevision)).toBe(false);
        const rows = JSON.parse(raw);
        const result = await assessProvenanceSecrets(rows, code, scope, fixture);
        return { rows, code, result };
      };

      await writeFile(path, original);
      const allowed = await inspect("current");
      expect(allowed.code).toBe(1); // The native detector is still enabled.
      expect(allowed.result).toEqual({
        ok: true,
        findings: 0,
        detectedFindings: 1,
        reviewedFalsePositives: 1,
      });
      for (const change of [
        { RuleID: "github-pat" },
        { StartLine: exception.startLine + 1 },
        { StartColumn: exception.startColumn + 1 },
        { Secret: "unexpected" },
        { Commit: "a".repeat(40) },
      ]) {
        const altered = allowed.rows.map((row) => ({ ...row, ...change }));
        expect(await assessProvenanceSecrets(altered, 1, "current", fixture)).toMatchObject({
          ok: false,
          findings: 1,
          reviewedFalsePositives: 0,
        });
      }
      await expect(assessProvenanceSecrets(allowed.rows, 0, "current", fixture)).rejects.toThrow();
      await expect(assessProvenanceSecrets([], 0, "other", fixture)).rejects.toThrow();

      // Same field and path, different revision; no arbitrary hexadecimal allowance.
      await writeFile(
        path,
        original.replace(`"api": "${exception.revision}"`, `"api": "${changedRevision}"`),
      );
      expect((await inspect("current")).result).toMatchObject({
        ok: false,
        reviewedFalsePositives: 0,
      });
      // Same line, column, revision and path, but a different JSON ancestor.
      await writeFile(path, original.replace('"roleSourceCommits"', '"credentials"'));
      expect((await inspect("current")).result).toMatchObject({
        ok: false,
        reviewedFalsePositives: 0,
      });
      // Even unrelated source edits reopen review rather than widen the allowance.
      await writeFile(path, original + "\n");
      expect((await inspect("current")).result).toMatchObject({
        ok: false,
        reviewedFalsePositives: 0,
      });
      await writeFile(path, original);
      const otherPath = join(fixture, "infra/docker/staging/other.json");
      await writeFile(otherPath, original);
      expect((await inspect("current")).result).toMatchObject({
        ok: false,
        findings: 1,
        detectedFindings: 2,
        reviewedFalsePositives: 1,
      });
      await rm(otherPath);

      // Genuine detector-shaped synthetic credential in the approved file/field.
      await writeFile(
        path,
        original.replace(`"api": "${exception.revision}"`, `"api": "${generated}"`),
      );
      const positive = await inspect("current");
      expect(positive.result.ok).toBe(false);
      expect(positive.result.reviewedFalsePositives).toBe(0);
      expect(positive.rows.some((row) => row.RuleID === "github-pat")).toBe(true);
      await run("git", ["add", "."], { cwd: fixture });
      const commit = async () =>
        run(
          "git",
          [
            "-c",
            "user.name=HamBazi scan test",
            "-c",
            "user.email=scan-test@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "Disposable provenance canary",
          ],
          { cwd: fixture },
        );
      await commit();
      expect((await inspect("history")).result).toMatchObject({
        ok: false,
        reviewedFalsePositives: 0,
      });
      // A credential in another field of the same file also stays blocking.
      const withSecret = JSON.parse(original);
      withSecret.authentication = { api: generated };
      await writeFile(path, JSON.stringify(withSecret, null, 2) + "\n");
      expect((await inspect("current")).result).toMatchObject({
        ok: false,
        reviewedFalsePositives: 0,
      });
      await writeFile(path, original);
      await run("git", ["add", "."], { cwd: fixture });
      await commit();
      expect((await inspect("current")).result.ok).toBe(true);
      const historicalOnly = await inspect("history");
      expect(historicalOnly.result).toMatchObject({
        ok: false,
        detectedFindings: 2,
        findings: 1,
        reviewedFalsePositives: 1,
      });
      expect(historicalOnly.rows.some((row) => row.RuleID === "github-pat")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);
