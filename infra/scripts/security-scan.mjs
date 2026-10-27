import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse } from "yaml";
import { validateStagingFreshnessContext } from "../release/staging-freshness.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const policy = JSON.parse(
  await readFile(new URL("../security/policy.json", import.meta.url), "utf8"),
);
const provenanceException = JSON.parse(
  await readFile(
    new URL("../security/gitleaks-provenance-exception.json", import.meta.url),
    "utf8",
  ),
);
const adminExceptions = JSON.parse(
  await readFile(
    new URL("../security/gitleaks-admin-phase2-exceptions.json", import.meta.url),
    "utf8",
  ),
);
const exec = promisify(execFile);
const severities = ["info", "low", "moderate", "high", "critical"];
const invalid = () => {
  throw new Error("SECURITY_SCAN_INVALID_EVIDENCE");
};
const count = (n) => Number.isSafeInteger(n) && n >= 0;
const blocked = (severity) => policy.blockingSeverities.includes(severity);
const pinnedImage = (image) =>
  /^((postgres|redis):[^@\s]+|hambazi-local\/postgres:[^@\s]+|hambazi-candidate\/(api|bot|worker|web|admin):[a-f0-9]{40}-[a-f0-9]{16}|hambazi-staging\/(ingress|acme):[a-f0-9]{40}-[a-f0-9]{16})@sha256:[a-f0-9]{64}$/.test(
    image,
  );

/** Only fixed counts and validated advisory identifiers leave scanner reports. */
export function assessAudit(report, exitCode) {
  if (![0, 1].includes(exitCode) || !report || report.error || !report.advisories) invalid();
  const counts = report.metadata?.vulnerabilities;
  if (!counts || !severities.every((s) => count(counts[s]))) invalid();
  const findings = Object.values(report.advisories).map((a) => {
    if (
      !severities.includes(a.severity) ||
      !/^GHSA-[a-z0-9-]+$/.test(a.github_advisory_id) ||
      !/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(a.module_name)
    )
      invalid();
    return { id: a.github_advisory_id, package: a.module_name, severity: a.severity };
  });
  for (const s of severities)
    if (findings.filter((f) => f.severity === s).length !== counts[s]) invalid();
  if ((exitCode === 0) !== (findings.length === 0)) invalid();
  return {
    ok: !findings.some((f) => blocked(f.severity)),
    counts: Object.fromEntries(severities.map((s) => [s, counts[s]])),
    findings,
  };
}

export function assessSecrets(report, exitCode) {
  if (
    ![0, 1].includes(exitCode) ||
    !Array.isArray(report) ||
    (exitCode === 0) !== (report.length === 0)
  )
    invalid();
  // All matches block, regardless of rule/severity. Never export match text, keys,
  // fingerprints, commits, author identity or raw paths from the report.
  return { ok: report.length === 0, findings: report.length };
}

async function approvedAdminFinding(finding, scope, sourceRoot) {
  if (adminExceptions.status !== "APPROVED" || adminExceptions.findings?.length !== 3) invalid();
  for (const reviewed of adminExceptions.findings) {
    if (
      finding.RuleID !== reviewed.rule ||
      finding.File !== (scope === "history" ? reviewed.path : join(sourceRoot, reviewed.path)) ||
      finding.StartLine !== reviewed.startLine ||
      finding.EndLine !== reviewed.endLine ||
      finding.StartColumn !== reviewed.startColumn ||
      finding.EndColumn !== reviewed.endColumn ||
      finding.Secret !== "REDACTED" ||
      finding.Match !== reviewed.redactedMatch ||
      finding.SymlinkFile ||
      (scope === "history"
        ? finding.Commit !== reviewed.commit
        : finding.Commit !== "" || !reviewed.currentSourceSha256)
    )
      continue;
    let source;
    if (scope === "history") {
      const blob = await run("git", ["show", `${reviewed.commit}:${reviewed.path}`], sourceRoot);
      if (blob.code !== 0) invalid();
      source = blob.stdout;
    } else {
      const path = join(sourceRoot, reviewed.path);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) invalid();
      source = await readFile(path, "utf8");
    }
    const line = source.split("\n")[reviewed.startLine - 1];
    if (
      createHash("sha256").update(source).digest("hex") !==
        (scope === "history" ? reviewed.sourceSha256 : reviewed.currentSourceSha256) ||
      !line ||
      createHash("sha256").update(line).digest("hex") !== reviewed.lineSha256
    )
      continue;
    if (reviewed.field) {
      const revision = reviewed.field
        .split(".")
        .reduce((value, key) => value?.[key], JSON.parse(source));
      if (!/^[a-f0-9]{40}$/.test(revision ?? "")) continue;
      const object = await run("git", ["cat-file", "-t", revision], root);
      if (object.code !== 0 || object.stdout.trim() !== "commit") invalid();
    }
    return true;
  }
  return false;
}

/** Exact owner-reviewed non-credentials; detectors still report every match. */
export async function assessProvenanceSecrets(report, exitCode, scope, sourceRoot) {
  assessSecrets(report, exitCode); // Validate raw scanner exit/report consistency first.
  if (!["history", "current"].includes(scope) || !isAbsolute(sourceRoot)) invalid();
  const exception = provenanceException;
  let reviewedFalsePositives = 0;
  for (const finding of report) {
    if (await approvedAdminFinding(finding, scope, sourceRoot)) {
      reviewedFalsePositives++;
      continue;
    }
    const exactColumns =
      finding.StartColumn === exception.startColumn && finding.EndColumn === exception.endColumn;
    // Gitleaks 8.30.1 reports columns one lower on the first diff line.
    // Both forms still require the exact match, source line, field and full blob hash.
    const firstDiffLineColumns =
      scope === "history" &&
      finding.StartColumn === exception.startColumn - 1 &&
      finding.EndColumn === exception.endColumn - 1;
    if (
      finding.RuleID !== exception.rule ||
      finding.File !== (scope === "history" ? exception.path : join(sourceRoot, exception.path)) ||
      finding.StartLine !== exception.startLine ||
      finding.EndLine !== exception.endLine ||
      (!exactColumns && !firstDiffLineColumns) ||
      finding.Secret !== "REDACTED" ||
      finding.Match !== exception.redactedMatch ||
      finding.SymlinkFile ||
      (scope === "current" && finding.Commit !== "")
    )
      continue;
    let source;
    if (scope === "history") {
      if (!/^[a-f0-9]{40}$/.test(finding.Commit ?? "")) invalid();
      const blob = await run("git", ["show", `${finding.Commit}:${exception.path}`], sourceRoot);
      if (blob.code !== 0) invalid();
      source = blob.stdout;
    } else {
      const path = join(sourceRoot, exception.path);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) invalid();
      source = await readFile(path, "utf8");
    }
    if (
      !exception.reviewedSourceSha256.includes(createHash("sha256").update(source).digest("hex")) ||
      exception.field.split(".").reduce((value, key) => value?.[key], JSON.parse(source)) !==
        exception.revision ||
      source.split("\n")[exception.startLine - 1] !== `      "api": "${exception.revision}",`
    )
      continue;
    // The public revision must still be an available Git commit, never an arbitrary key.
    const object = await run("git", ["cat-file", "-t", exception.revision], root);
    if (object.code !== 0 || object.stdout.trim() !== "commit") invalid();
    reviewedFalsePositives++;
  }
  const findings = report.length - reviewedFalsePositives;
  return { ok: findings === 0, findings, detectedFindings: report.length, reviewedFalsePositives };
}

export function assessImage(report, image) {
  if (
    !pinnedImage(image) ||
    report?.SchemaVersion !== 2 ||
    report.ArtifactType !== "container_image" ||
    report.ArtifactName !== image ||
    !Array.isArray(report.Results) ||
    !report.Results.some((r) => r.Class === "os-pkgs")
  )
    invalid();
  const counts = Object.fromEntries(severities.map((s) => [s, 0]));
  counts.unknown = 0;
  const findings = [];
  for (const result of report.Results) {
    if (result.Vulnerabilities !== undefined && !Array.isArray(result.Vulnerabilities)) invalid();
    for (const v of result.Vulnerabilities ?? []) {
      const severity = v.Severity?.toLowerCase();
      const normalized = severity === "medium" ? "moderate" : severity;
      if (
        !Object.hasOwn(counts, normalized) ||
        !/^(CVE-\d{4}-\d+|GHSA-[a-z0-9-]+|TEMP-\d{7}-[A-F0-9]{6}|D[LS]A-\d+-\d+)$/.test(
          v.VulnerabilityID,
        ) ||
        typeof v.PkgName !== "string" ||
        !/^[a-zA-Z0-9@/_.+:~-]{1,200}$/.test(v.PkgName)
      )
        invalid();
      counts[normalized]++;
      findings.push({
        id: v.VulnerabilityID,
        package: v.PkgName,
        severity: normalized,
        fixAvailable: typeof v.FixedVersion === "string" && v.FixedVersion.length > 0,
      });
    }
  }
  return {
    ok: !findings.some((f) => blocked(f.severity) || f.severity === "unknown"),
    image,
    counts,
    findings,
  };
}

export function assertFreshDatabase(metadata, now = Date.now(), stagingContext) {
  if (metadata?.Version !== 2 || !Number.isFinite(now)) invalid();
  const exception = stagingContext
    ? validateStagingFreshnessContext(stagingContext, now)
    : undefined;
  const maximumAgeHours = exception?.maximumAgeHours ?? policy.databaseMaxAgeHours;
  for (const field of ["UpdatedAt", "DownloadedAt"]) {
    const time = typeof metadata[field] === "string" ? Date.parse(metadata[field]) : NaN;
    if (!Number.isFinite(time) || time > now + 300000 || now - time > maximumAgeHours * 3600000)
      invalid();
  }
  return {
    updatedAt: metadata.UpdatedAt,
    downloadedAt: metadata.DownloadedAt,
    ...(exception
      ? {
          freshnessException: exception,
          standard24HourGatePassed: [metadata.UpdatedAt, metadata.DownloadedAt].every(
            (t) => now - Date.parse(t) <= policy.databaseMaxAgeHours * 3600000,
          ),
        }
      : {}),
  };
}

// Do not inherit scanner suppression, debug, credential or application variables.
function safeEnvironment() {
  return Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "NO_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy",
      "no_proxy",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "NODE_EXTRA_CA_CERTS",
    ]
      .filter((k) => process.env[k] !== undefined)
      .map((k) => [k, process.env[k]]),
  );
}
async function run(command, args, cwd, timeout = 180000) {
  try {
    const r = await exec(command, args, {
      cwd,
      env: safeEnvironment(),
      timeout,
      killSignal: "SIGKILL",
      maxBuffer: 8 * 1024 * 1024,
    });
    return { code: 0, stdout: r.stdout };
  } catch (e) {
    if (e.code === 1 && !e.killed) return { code: 1, stdout: e.stdout };
    // Raw errors/stdout/stderr can contain credentials or sensitive matches.
    return { code: -1, stdout: "" };
  }
}
async function json(path) {
  if ((await stat(path)).size > 64 * 1024 * 1024) invalid();
  return JSON.parse(await readFile(path, "utf8"));
}
export async function verifyTool(path, name) {
  const file = await lstat(path);
  if (!file.isFile() || file.isSymbolicLink() || file.size > 256 * 1024 * 1024) invalid();
  await access(path, constants.X_OK);
  if (
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex") !== policy.tools[name].binarySha256
  )
    invalid();
}
export async function snapshotCandidate(directory, repository = root) {
  repository = resolve(repository);
  const paths = await run(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    repository,
  );
  if (paths.code !== 0) invalid();
  let files = 0;
  for (const path of new Set(paths.stdout.split("\0").filter(Boolean))) {
    const source = resolve(repository, path);
    if (
      isAbsolute(path) ||
      relative(repository, source).startsWith("..") ||
      path.split(/[\\/]/).includes(".git")
    )
      invalid();
    let info;
    try {
      info = await lstat(source);
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    // Never follow an external symlink or silently skip an unscanned candidate.
    if (!info.isFile() || info.isSymbolicLink()) invalid();
    let parent = dirname(source);
    while (parent !== repository) {
      const directoryInfo = await lstat(parent);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) invalid();
      parent = dirname(parent);
    }
    const destination = join(directory, path);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(source, destination);
    files++;
  }
  return files;
}

export async function scan(kind, scannerDirectory = process.env.SECURITY_SCANNER_DIR) {
  if (!["dependencies", "secrets", "images"].includes(kind)) invalid();
  const directory = await mkdtemp(join(tmpdir(), "hambazi-security-"));
  let stage = "setup";
  const summary = { schemaVersion: 1, kind, status: "failed" };
  try {
    if (kind === "dependencies") {
      stage = "pnpm-version";
      if ((await run("pnpm", ["--version"], root)).stdout.trim() !== policy.pnpmVersion) invalid();
      stage = "dependency-audit";
      const result = await run("pnpm", ["audit", "--json"], root);
      Object.assign(summary, assessAudit(JSON.parse(result.stdout), result.code));
    } else {
      if (process.platform !== "linux" || process.arch !== "x64" || !scannerDirectory) invalid();
      const name = kind === "secrets" ? "gitleaks" : "trivy";
      const executable = resolve(scannerDirectory, name);
      stage = "tool-integrity";
      await verifyTool(executable, name);
      summary.tool = {
        name,
        version: policy.tools[name].version,
        sha256: policy.tools[name].binarySha256,
      };
      if (kind === "secrets") {
        const ignore = join(directory, "empty-ignore");
        await writeFile(ignore, "", { mode: 0o600 });
        const args = [
          "--config",
          join(root, "infra/security/gitleaks.toml"),
          "--gitleaks-ignore-path",
          ignore,
          "--ignore-gitleaks-allow",
          "--redact=100",
          "--no-banner",
          "--no-color",
          "--timeout=120",
          "--max-archive-depth=2",
          "--report-format=json",
        ];
        stage = "git-history";
        if (
          (await run("git", ["rev-parse", "--is-shallow-repository"], root)).stdout.trim() !==
          "false"
        )
          invalid();
        const history = join(directory, "history.json");
        const h = await run(
          executable,
          ["git", "--log-opts=--all", "--report-path", history, ...args, root],
          directory,
        );
        summary.history = await assessProvenanceSecrets(
          await json(history),
          h.code,
          "history",
          root,
        );
        stage = "candidate-tree";
        const candidate = join(directory, "candidate");
        await mkdir(candidate, { mode: 0o700 });
        summary.files = await snapshotCandidate(candidate);
        const current = join(directory, "current.json");
        const c = await run(
          executable,
          ["dir", "--report-path", current, ...args, candidate],
          directory,
        );
        summary.current = await assessProvenanceSecrets(
          await json(current),
          c.code,
          "current",
          candidate,
        );
        summary.ok = summary.history.ok && summary.current.ok;
      } else {
        const cache = resolve(scannerDirectory, "cache");
        await mkdir(cache, { recursive: true, mode: 0o700 });
        const info = await lstat(cache);
        if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) invalid();
        stage = "database-update";
        if (
          (
            await run(
              executable,
              ["image", "--download-db-only", "--cache-dir", cache, "--quiet"],
              directory,
            )
          ).code !== 0
        )
          invalid();
        summary.database = assertFreshDatabase(await json(join(cache, "db/metadata.json")));
        const compose = parse(await readFile(join(root, "infra/docker/compose.yaml"), "utf8"));
        const images = [compose.services.postgres.image, compose.services.redis.image];
        summary.images = [];
        const localLock = await json(join(root, "infra/docker/postgres/image-lock.json"));
        if (
          images[0] !== localLock.image ||
          createHash("sha256")
            .update(await readFile(join(root, "infra/docker/postgres/Dockerfile")))
            .digest("hex") !== localLock.dockerfileSha256
        )
          invalid();
        for (const [index, image] of images.entries()) {
          if (!pinnedImage(image)) invalid();
          stage = index === 0 ? "postgres-image" : "redis-image";
          const output = join(directory, "image.json");
          const r = await run(
            executable,
            [
              "image",
              "--scanners=vuln",
              "--image-src=docker",
              "--format=json",
              "--output",
              output,
              "--exit-code=0",
              "--cache-dir",
              cache,
              "--quiet",
              image,
            ],
            directory,
          );
          if (r.code !== 0) invalid();
          summary.images.push(assessImage(await json(output), image));
        }
        summary.ok = summary.images.every((r) => r.ok);
      }
    }
    summary.status = summary.ok ? "passed" : "blocked";
  } catch {
    summary.status = "failed";
    summary.stage = stage;
    summary.ok = false;
  } finally {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch {
      summary.status = "failed";
      summary.stage = "cleanup";
      summary.ok = false;
    }
  }
  return summary;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await scan(process.argv[2]);
  console.info(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
