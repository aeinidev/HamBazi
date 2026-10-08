import { assessAudit, assessImage, assertFreshDatabase } from "../scripts/security-scan.mjs";
import { isDeepStrictEqual } from "node:util";

export const scannerStages = new Set(["secrets", "dependencies", "images", "application-images"]);
const invalid = () => {
  throw new Error("CI_SCAN_EVIDENCE_INVALID");
};
const count = (value) => Number.isSafeInteger(value) && value >= 0;

/** Reuse scanner validators; project only public finding identities and numeric evidence. */
export function projectScan(report, kind, stagingContext) {
  if (
    !scannerStages.has(kind) ||
    report?.schemaVersion !== 1 ||
    report.kind !== kind ||
    report.status !== "passed" ||
    report.ok !== true
  )
    invalid();
  const header = { schemaVersion: 1, kind, status: "passed", ok: true };
  if (kind === "secrets") {
    if (
      !count(report.files) ||
      report.history?.ok !== true ||
      report.current?.ok !== true ||
      report.history.findings !== 0 ||
      report.current.findings !== 0
    )
      invalid();
    return {
      ...header,
      files: report.files,
      history: { ok: true, findings: 0 },
      current: { ok: true, findings: 0 },
    };
  }
  if (kind === "dependencies") {
    if (!Array.isArray(report.findings) || report.findings.length > 10000) invalid();
    const result = assessAudit(
      {
        metadata: { vulnerabilities: report.counts },
        advisories: Object.fromEntries(
          report.findings.map((f, i) => [
            i,
            { severity: f.severity, github_advisory_id: f.id, module_name: f.package },
          ]),
        ),
      },
      report.findings.length ? 1 : 0,
    );
    if (!result.ok) invalid();
    return { ...header, counts: result.counts, findings: result.findings };
  }
  const applications = kind === "application-images";
  if (!Array.isArray(report.images) || report.images.length !== (applications ? 4 : 2)) invalid();
  if (
    applications &&
    (!/^[a-f0-9]{40}$/.test(report.sourceCommit ?? "") ||
      !/^[a-f0-9]{64}$/.test(report.sourceSnapshotSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(report.buildInputSha256 ?? "") ||
      typeof report.sourceDirty !== "boolean")
  )
    invalid();
  const database = assertFreshDatabase(
    {
      Version: 2,
      UpdatedAt: report.database?.updatedAt,
      DownloadedAt: report.database?.downloadedAt,
    },
    Date.now(),
    stagingContext,
  );
  const images = report.images.map((image, index) => {
    const role = applications ? ["api", "bot", "worker", "web"][index] : undefined;
    if (
      applications &&
      (image.role !== role || !image.image?.startsWith(`hambazi-candidate/${role}:`))
    )
      invalid();
    if (
      !Array.isArray(image.findings) ||
      image.findings.length > 10000 ||
      image.findings.some((f) => typeof f.fixAvailable !== "boolean")
    )
      invalid();
    const result = assessImage(
      {
        SchemaVersion: 2,
        ArtifactType: "container_image",
        ArtifactName: image.image,
        Results: [
          {
            Class: "os-pkgs",
            Vulnerabilities: image.findings.map((f) => ({
              VulnerabilityID: f.id,
              PkgName: f.package,
              Severity: f.severity,
              FixedVersion: f.fixAvailable ? "available" : undefined,
            })),
          },
        ],
      },
      image.image,
    );
    if (!result.ok || !isDeepStrictEqual(result.counts, image.counts)) invalid();
    return { ...(applications ? { role } : {}), ...result };
  });
  return {
    ...header,
    ...(applications
      ? {
          sourceCommit: report.sourceCommit,
          sourceDirty: report.sourceDirty,
          sourceSnapshotSha256: report.sourceSnapshotSha256,
          buildInputSha256: report.buildInputSha256,
        }
      : {}),
    database,
    images,
  };
}
