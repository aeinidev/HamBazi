# ADR-068 — Exact public build revision false-positive exception

- **Status:** Accepted by the owner's explicit narrowly scoped remediation approval; no deployment approval.
- **Owner:** HamBazi repository owner.
- **Date:** 2026-10-13.
- **Supersedes:** Only ADR-034's statement that the normative timestamp label is the sole approved false-positive exception. All other scanner/security/release requirements remain.

## Context

The K4B preflight classified both reported `generic-api-key` findings as the same public Git revision in `infra/docker/staging/staging-test-user-current.json`, field `application.roleSourceCommits.api`. Independent review at `2026-10-13T09:52:45.046Z` confirmed the complete revision resolves to a Git commit object, the JSON value is source provenance, and the historical/current source versions produce exactly this finding. Neither is a credential input. No credential rotation or revocation is required for these findings.

The owner explicitly authorized only this verified rule/path/field/revision exception, documentation, positive canary testing and full security verification. Commits, history rewrite, deployment, staging changes and policy widening remain prohibited.

## Decision

Keep all pinned Gitleaks default detectors and the existing exact normative-prose allowance unchanged. Record one literal exception in `infra/security/gitleaks-provenance-exception.json` for:

- rule `generic-api-key`;
- exact path `infra/docker/staging/staging-test-user-current.json`;
- field `application.roleSourceCommits.api`;
- public revision `1bfc42e50c6f7b3f1a27168df22c99018356ab18`;
- the reviewed finding line and match, verified against only two byte-identical reviewed source versions, pinned by SHA-256.

Gitleaks still detects the revision. The scan runner first validates the raw scanner exit/report agreement, then classifies only a finding satisfying every contextual constraint. For history it reads the exact file blob from the finding's full commit ID; for the candidate it reads the exact snapshot file. It verifies the full source digest, parsed JSON field, literal provenance line, redacted match and available public Git commit object. All other findings block. Exceptions are counted explicitly separately from detected and blocking findings; neither raw reports nor source content are exported.

The pinned scanner's [location calculation](https://github.com/gitleaks/gitleaks/blob/v8.30.1/detect/location.go) reports this exact match at columns 9–56 after a preceding newline or 8–55 on the first diff line. Only these exact column pairs qualify for history; the current snapshot requires 9–56. Both retain the same absolute line 41, literal match and reviewed full source digest. This difference was reproduced by the actual historical canary, rather than inferred from synthetic report metadata.

This uses a contextual check after detection because the pinned [Gitleaks allowlist implementation](https://github.com/gitleaks/gitleaks/blob/v8.30.1/config/allowlist.go) supports secret/match/line targets, not JSON ancestry. A native path-and-line allowance could also exempt another `api` field. Full reviewed-source hashes make this decision narrower: even unrelated edits to the binding reopen review. No whole path, rule, commit, arbitrary hash, API field, baseline or fingerprint is allowed.

Preserve full local reachable-ref history and nonignored candidate scanning, scanner hashes, non-shallow requirement, empty fingerprint-ignore input, inline-ignore rejection, archive depth, environment allowlist, private temporary reports and cleanup failure blocking. No application or operational binding is edited to hide a finding.

## Alternatives

- A global/path/40-hex allowlist would conceal unrelated credentials and is rejected.
- Renaming/removing provenance would damage preserved operational evidence and leave history unresolved.
- A line-only native allowance cannot prove the approved JSON ancestor.
- History rewrite or credential rotation is neither necessary for this public revision nor authorized.

## Consequences

Any new revision, field, path, rule, source digest or unreviewed location remains blocking and needs another explicit decision. The existing normative-prose canary and generated genuine-detector positives verify retained coverage. A historical-only generated credential must remain blocking after removal from the current fixture.

The scan remains limited to locally reachable refs and tracked/nonignored candidate files. Ignored runtime files, remote refs not fetched locally, unreachable objects, unsupported formats and external exposure are outside this evidence. The dirty K4A images are not clean release artifacts, and changes to release inputs require a future authorized clean rebuild and applicable rescans. K4B remains **NO-GO** until separately approved after all remaining source, regression and fresh operational gates are satisfied.
