# ADR-034 — Security scan boundaries and compatible supply-chain remediation

- **Status:** Accepted for the reversible Phase 17A1 tooling and patch updates; no risk exception or launch approval.
- **Owner:** HamBazi technical owner.
- **Date:** 2026-10-02.
- **Supersedes:** None.

## Context

Architecture sections 16.4/24 and AGENTS section 9 require dependency, secret,
lockfile and image checks. Phase 17A explicitly authorizes security hardening.
The initial full pnpm audit found eight advisories: three High and five Moderate.
The project has no CI workflows or application Dockerfiles yet; those are owning
Phase 18 deliverables, not prerequisites to source/local-image scanning.

## Decision

Keep existing module authority and wire contracts unchanged. Upgrade the aligned
Nest 12.0.x packages to 12.0.3, Fastify to 5.12.5, and same-major transitive
brace-expansion/fast-uri to their patched versions. Preserve strict peer/release
policy and integrity-bearing lockfile resolutions. The middleware advisory gets
a raw-TCP regression because normalized HTTP injection cannot reproduce it.
Update the local Compose digests to official rebuilt images of the same service
versions/OS families (PostgreSQL 18.6/bookworm and Redis 8.10.1/trixie). Preserve
network, volume, bootstrap and role definitions; verify isolated compatibility.
This routine rebuild update reduces findings but does not accept the remaining
image vulnerabilities.

Use an uncached, standalone `infra/scripts/security-scan.mjs` CLI with modes
`dependencies`, `secrets`, and `images`. Do not invent a root package script or
install a Phase 18 CI workflow. Fail on scanner errors, missing/malformed evidence,
substituted binaries, stale databases, secret findings, known Critical/High
vulnerabilities and unknown image severity. Lower findings are reported for
review; their presence is not a risk acceptance. No advisory ignore/VEX or
ignore-unfixed policy is introduced.

Pin official Linux x64 Gitleaks 8.30.1 and Trivy 0.74.0 archive and extracted
binary hashes in `infra/security/policy.json`. Verify binary content before
execution. Tool provisioning is explicit outside the worktree and requires
reviewed official artifacts; no download-and-execute installer is added.

Gitleaks checks all locally reachable Git refs in a non-shallow checkout and a
private snapshot of tracked edits plus non-ignored untracked files. Inline
`gitleaks:allow` and repository `.gitleaksignore` bypasses are disabled. Reject
candidate symlinks rather than following them. Retain default detection rules.
The sole exception combines the exact implementation-plan path with the exact
normative timestamp label `issuance/expiry`; it is a reviewed prose false
positive, not an exemption for test files, secrets, commits or credentials.

Trivy scans the actual locally available Compose PostgreSQL/Redis digest references
through the local Docker daemon; remote/runtime fallback is disabled. It requires a
schema-2 vulnerability database updated and downloaded within 24 hours. The
24-hour rule is a local scan freshness gate, not a final SLO or retention policy.
The runner uses a private working directory and an allowlisted environment so
ambient scanner ignore/debug configuration cannot suppress checks. Reports and
raw tool diagnostics stay temporary and private; output contains only fixed
counts, validated advisory/package IDs, public image references and scan stage.
Cleanup failure also fails the check.

## Alternatives

- Broad dependency refresh would change unrelated behavior and enlarge review.
- Custom secret regexes alone would lose maintained detector coverage.
- Ignoring test/docs directories or all historical findings would conceal real leaks.
- Accepting stale/offline scan failures as green would misrepresent evidence.
- Adding deployment images/CI now would cross the authorized phase boundary.

## Consequences

These tools can be adopted by Phase 18 CI without changing product authority.
Checks require network access to the npm advisory service and official image/DB
registries, and explicit verified scanner provisioning. Hash verification trusts
the reviewed upstream release metadata; it is not a Sigstore provenance proof.
The scan is scoped to reachable local history/candidate files and the two existing
local-service images. Ignored runtime secret files, remote un-fetched refs,
unreachable objects, binary payloads unsupported by Gitleaks, production images,
external access controls and legal/retention policies remain separate evidence.
Phase 17A2/17A3 must still implement their admission/browser/admin work. No new
quota, hosting provider, identity provider, activation or security-risk acceptance
is authorized by this ADR.

The initial rebuilt Debian image selection blocked 17A1. The owner's subsequent
approval and [ADR-035](035-local-service-image-remediation.md) supersede only that
selection with a guarded local image remediation. The current
[image evidence](../security/local-image-findings.json) passes; its retained
historical report records the original blocker. No finding exception was accepted.
Application deployment images and CI remain Phase 18 deliverables.
