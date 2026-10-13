# Kahroba — Approved Gitleaks false-positive remediation

Date: 2026-10-13. **Security remediation completed; K4B deployment remains NO-GO.** Authorization covers only the verified public-revision exception, documentation and local verification. No commit, push, deployment, staging access/change, restart, containment renewal, admission change, credential rotation or history rewrite was performed.

## 1. Findings and exact disposition

Both original findings are `generic-api-key` at line 41 of `infra/docker/staging/staging-test-user-current.json`, field `application.roleSourceCommits.api`. Private review at `2026-10-13T09:52:45.046Z` independently reconfirmed the literal public revision identifies a Git commit object. The original historical and owner-preserved current binding versions were hashed separately. No credential exposure was identified in these findings; rotation/revocation is unnecessary for them.

The owner's explicit approval is recorded in [ADR-068](../adr/068-exact-public-provenance-secret-scan-exception.md). The [exception descriptor](../../infra/security/gitleaks-provenance-exception.json) binds the exact rule, relative path, complete JSON field, literal public revision, finding line/match and only the two reviewed full-source SHA-256 values. A changed revision, field, path, rule or source content remains blocking and needs another review/approval.

The [runner](../../infra/scripts/security-scan.mjs) validates raw scanner exit/report consistency before applying this one contextual classification. Historical evidence comes from the exact commit/file blob reported by Gitleaks; candidate evidence comes from its private snapshot. The full source hash plus parsed JSON field and literal line prevent a different `api` field from qualifying. The pinned scanner's first-diff-line column convention is handled only for the same exact history match, source line and reviewed blob; the current column pair remains fixed. It separately reports detected findings, reviewed false positives and remaining blocking findings.

All default detection rules and the prior exact normative-prose exception are preserved. Native Gitleaks still detects the public revision; no broad allowlist, ignored path/rule/commit/fingerprint, baseline or inline suppression was added. Full reachable-local-ref history, non-shallow enforcement, candidate coverage, empty fingerprint-ignore input, inline-ignore rejection, archive scanning, pinned binary hashes, private environment/report handling and cleanup failure blocking remain. Security/dependency/image policy and version pins are unchanged.

## 2. Verification

Verified Gitleaks **8.30.1**, binary SHA-256 `88f91962aa2f93ac6ab281d553b9e125f5197bbbce38f9f2437f7299c32e5509`. `SECURITY_SCANNER_DIR` points to the existing locally verified scanner directory; no scanner install or pin update was needed.

| Check                                                                                    | Actual result                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused `pnpm exec vitest run infra/tests/security-scans.test.mjs`, scanner provisioned  | 9 passed; zero skipped                                                                                                                                      |
| `SECURITY_SCANNER_DIR=<verified directory> pnpm test:infra`                              | 14 files, 131 tests passed; zero skipped; exit 0                                                                                                            |
| `SECURITY_SCANNER_DIR=<verified directory> node infra/scripts/security-scan.mjs secrets` | Full `git --log-opts=--all` history and tracked/nonignored current candidate passed; exit 0                                                                 |
| History finding accounting                                                               | 1 detected, 1 exactly reviewed false positive, **0 blocking**                                                                                               |
| Current finding accounting                                                               | 1 detected, 1 exactly reviewed false positive, **0 blocking**                                                                                               |
| Changed JavaScript ESLint, `--max-warnings 0`                                            | Passed, exit 0                                                                                                                                              |
| Changed Markdown/JSON/JavaScript Prettier check                                          | Passed, exit 0                                                                                                                                              |
| Source/index preservation                                                                | Original HEAD and index unchanged; all original files outside the five approved modified paths hash-identical; protected staging binding/incident untouched |

The real pinned-scanner tests cover:

- the exact original allowance and the prior normative-prose allowance;
- a different forty-character revision in the same field/path;
- the same revision, line and columns under a different JSON ancestor;
- another path containing the same original content;
- changed source bytes, wrong rule, wrong location, unexpected match material and inconsistent scanner evidence;
- generated detector-shaped GitHub credentials in the approved field and another field of the same file;
- positive detection in current files and temporary fixture history;
- a historical-only generated credential after a second fixture commit removes it, while the reviewed public revision is independently classified;
- redacted generated values and deletion of private reports/fixture repositories.

Only disposable test repositories received fixture commits; the HamBazi repository received none. No credential value was printed. During development, a history-canary assertion exposed Gitleaks' first-diff-line column difference, and an initial generated fixture replacement was narrowed to the intended JSON field. The first whole-tree trial also caught a new prose match in the newly written ADR; that sentence was clarified without adding an exception. These intermediate failures were resolved before the passing checks; no unrelated finding was suppressed.

Safe local evidence is under ignored `test-results/kahroba-gitleaks-remediation/`: `baseline.json`, `review.json`, `verification.json`, test/lint logs, final scan/format and preservation records. Private raw reports were removed. Evidence is local verification, not hosted CI or deployed-target validation. The final scan is rerun after the report/documents are present so its candidate includes all remediation source files.

## 3. Exact repository changes

Created:

1. `infra/security/gitleaks-provenance-exception.json` — one approved literal descriptor and reviewed source hashes.
2. `docs/adr/068-exact-public-provenance-secret-scan-exception.md` — approval, scope, proof, alternatives and re-review conditions.
3. `docs/security/kahroba-gitleaks-remediation.md` — this verification report.

Modified:

1. `infra/scripts/security-scan.mjs` — fail-closed contextual classification after unchanged detector execution; explicit numeric accounting.
2. `infra/security/gitleaks.toml` — explanatory comments only; detector/allowlist semantics unchanged.
3. `infra/tests/security-scans.test.mjs` — real-scanner boundary/positive/history canary coverage.
4. `docs/security/kahroba-k4b-preflight.md` — subsequent approval link; original observations preserved.
5. `docs/operations/kahroba-restricted-staging-plan.md` — security-only status note; deployment gates/procedure preserved.

Ignored local review/test evidence is not a release-source change. No gameplay, Bot/Auth/Users, result contract, schema/migration, lockfile, image or runtime/operational binding was modified.

## 4. Remaining blockers and stop

The Gitleaks machine blocker is cleared for this exact local source. Deployment remains **NO-GO**:

- K1–K4A and this remediation remain uncommitted; a separately authorized reviewed clean-source candidate, rebuild and fresh evidence are required. Earlier dirty images cannot be promoted or relabelled.
- Three pre-existing Bot failures and the legacy preview failure still affect mandatory release checks. They were not changed, waived or rerun as part of this narrow security task; retain the preflight's actual failure evidence.
- Existing owner SSH credential context and fresh authenticated target/configuration/containment/scan readbacks remain unavailable. The previously recorded deadline is not a fresh timer verification or renewal authority.
- Private runtime configuration, the two-human disposable recovery scope, exact v2-compatible rollback pair and bounded native acceptance still require the documented prerequisites and approvals.

The permitted Moderate zlib decision remains unchanged and applies only to the earlier exact inspected images/evidence; future clean artifacts need fresh exact-image scans. Production HOLD, only the existing owner and `@devtest98`, no public Kahroba availability, existing match/history preservation, v1/v2 compatibility and consumer-before-producer/admission-last ordering remain mandatory.

The scanner evidence does not cover ignored runtime files, remote refs not fetched locally, unreachable history, unsupported formats or outside-Git exposure. The full-source digest restriction deliberately reopens the gate on any binding edit. **Stop after this remediation. K4B requires separate explicit authorization; none was granted or exercised.**
