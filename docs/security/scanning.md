# Security scanning

[ADR-034](../adr/034-security-scan-boundaries.md) defines scope and failure policy.
`infra/security/policy.json` records reviewed tool versions, official archive
URLs/SHA-256 and extracted Linux x64 binary SHA-256. Provision the two executables
outside the repository from those artifacts, verify archive hashes before
extracting only the named executable, and keep the scanner directory/cache private
(mode 0700). The runner independently checks each binary hash and executable bit.
It does not auto-install tools, relax package policy or select a deployment image.

## Commands

These are real standalone CLI entry points, not guessed package scripts. No new
root script or CI workflow is added in 17A1. Run from the repository root:

```sh
pnpm install --frozen-lockfile
node infra/scripts/security-scan.mjs dependencies
SECURITY_SCANNER_DIR=/absolute/private/scanner-directory node infra/scripts/security-scan.mjs secrets
SECURITY_SCANNER_DIR=/absolute/private/scanner-directory node infra/scripts/security-scan.mjs images
SECURITY_SCANNER_DIR=/absolute/private/scanner-directory pnpm test:infra
```

Dependency audit covers the complete lockfile, including development/tooling
packages, through the pinned pnpm version. Empty/malformed/error/contradictory
advisory evidence fails. High/Critical blocks; all lower findings remain visible
for risk review. Frozen installation is a separate mandatory integrity and
supply-chain gate and must precede the scan.

Secrets cover all reachable local Git refs (`--all`) and the current tracked plus
non-ignored untracked candidate files, including new files before a commit.
Shallow history or candidate symlinks fail. Deleted tracked files are absent from
the candidate but remain covered by history. No blanket test/docs exceptions,
inline allows or `.gitleaksignore` fingerprints apply. The sole exact normative
prose exception is documented and tested; every actual finding blocks. Raw match
content, author metadata, paths, fingerprints and error diagnostics are never
printed. Reports exist only in a private task-owned temporary directory and are
removed on success or failure; cleanup failure blocks too.

Build the locked local PostgreSQL derivative and pre-pull the exact Redis
reference through [the image setup runbook](local-image-transition.md), without
starting services. Do not pull the local PostgreSQL alias. Image mode requires
the local Docker daemon and both exact Compose digests. It also verifies that
the PostgreSQL lock agrees with Compose and hashes the Dockerfile. It does not
scan a mutable tag or silently fall back to another runtime/registry.

Images use both exact current Compose digest references, and run vulnerability
scanning without `ignore-unfixed`, VEX or vulnerability exceptions. DB schema 2
and both UpdatedAt/DownloadedAt age must be within 24 hours (five-minute future
clock tolerance). The scanner working directory is private/empty, and scanner
ignore/debug environment variables are not inherited. A missing tool, database,
registry response, supported OS package report or malformed/unknown severity
fails; a download or scan failure is never evidence of zero vulnerabilities.
Known High/Critical, including unfixed findings, blocks. Unknown severity blocks
pending review. Safe output includes only count/severity, validated public
advisory/package identifiers for every severity and reviewed image pins.

Exit 0 means the selected check passed; exit 1 means a finding or unavailable/
invalid evidence. JSON `status` distinguishes `passed`, `blocked` and `failed`;
`stage` identifies infrastructure failure without raw diagnostics. Dependency
and image output lists findings for review. Secret output deliberately reports
only counts. Handle a real secret finding in a separately authorized secure
incident workflow; never paste reports/credentials into chat or tracked files.

## Validation and release adoption

`pnpm test:infra` verifies malformed/inconsistent evidence, blocking fixed/unfixed
advisories, output redaction, database freshness, executable substitution/symlinks
and candidate capture. Supplying the verified scanner directory also executes
real generated credential canaries in disposable Git/history and directory
fixtures, including detection after the candidate credential is removed. This
uses fixture commits only; it never commits the project worktree.

Phase 18A's [CI workflow](../../.github/workflows/ci.yml) provisions the pinned
tools and runs frozen install and all three uncached checks on a full checkout,
without production credentials. [ADR-041](../adr/041-ci-trust-and-evidence.md)
and the [CI guide](../operations/ci.md) define provisioning, trust, privacy and
protected-release requirements. A fresh scan is required after candidate
dependency/image changes and before release. Phase
18B must extend the reviewed image target inventory to actual application images;
no application Dockerfiles exist yet. The local service derivative is not an
application deployment image. Record any exception with owner, exact
advisory/image, evidence, expiry and remediation before accepting a known
Critical/High vulnerability. No such exception exists in this phase. After
owner-approved remediation under [ADR-035](../adr/035-local-service-image-remediation.md),
both current local image pins report zero findings in every severity. The
[risk register](risk-register.md) and [sanitized evidence](local-image-findings.json)
retain the historical blocker and current result. Stored reports are dated review
artifacts; rerun the uncached check for current evidence. Adoption also requires
provisioning the locked local build inputs and reproducing its digest; do not
substitute an unreviewed image if the build or scanner fails.

The checks do not scan ignored runtime `.env` files, remote un-fetched Git history,
unreachable objects, every encoded/binary payload, deployed infrastructure, or
production application images. The root `pnpm check` does not run these
external scanners; 18A CI invokes them separately without caching. Secret scanning
does not prove that credentials have never leaked outside Git. Tool hash verification does not prove
upstream provenance; verified TLS/release metadata remains its trust boundary.

Official references: [Gitleaks](https://github.com/gitleaks/gitleaks),
[Trivy installation](https://trivy.dev/docs/latest/getting-started/installation/),
[Trivy databases](https://trivy.dev/docs/latest/configuration/db/), and
[container scanning](https://trivy.dev/docs/latest/target/container_image/).
