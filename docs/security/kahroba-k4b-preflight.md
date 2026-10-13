# Kahroba K4B security and operational preflight

Date: 2026-10-13. **Recommendation: NO-GO for deployment.** This completes the requested focused review; no deployment, activation, restart, access change, credential rotation, admission expansion, timer renewal, Git commit, push, merge, PR or history rewrite was performed.

## Subsequent approved scanner remediation

The owner subsequently approved only the exact public-revision false-positive remediation. [ADR-068](../adr/068-exact-public-provenance-secret-scan-exception.md) records that decision; the [verification report](kahroba-gitleaks-remediation.md) records its results. This supersedes the scanner's pending-approval status below, while preserving the original preflight findings and failed-check evidence as historical observations. All other blockers and the K4B **NO-GO** remain. No deployment authority follows from the remediation.

## 1. Gitleaks findings and disposition

The pinned Gitleaks 8.30.1 binary was hash-verified. The unmodified repository scanner was rerun across all reachable local Git refs and the current candidate. Result: **blocked, one history finding and one current finding**. No new allowance, ignore, inline suppression or policy threshold change was applied.

Private redacted reports were separately inspected, then deleted. Both findings are `generic-api-key` at line 41 of the preserved staging binding, field `application.roleSourceCommits.api`. For each source version, the matched line was verified to contain that JSON field's complete forty-character revision; Git independently confirmed it identifies a reachable commit object. This is build/source provenance, not a credential input. No application authentication code consumes this provenance field as a secret. Matched values and raw reports are not included here or in retained logs.

**Disposition: both are false positives for a public Git revision.** No actual exposed credential or historical credential exposure was identified in these reported findings. No rotation or revocation is required on their account. This does not prove credentials never leaked elsewhere: ignored runtime files, unfetched remote refs, unreachable history, unsupported encodings and exposure outside Git remain outside this scan.

Evidence: `test-results/kahroba-k4b-preflight/findings.json`, `findings-review.log`, `secrets.log`; private finding review completed at `2026-10-13T08:53:16.802Z`.

## 2. Required security remediation — proposed, not applied

The technical false-positive classification does not automatically clear the machine gate. ADR-034 authorizes only the existing exact normative-prose allowance; it does not approve a new Git-revision allowance.

Recommended owner-reviewed change: record an explicit false-positive decision, then implement a detector exception limited to **all** of the following:

- `generic-api-key` finding only;
- exact staging binding path;
- exact `application.roleSourceCommits.api` provenance field/complete source line;
- the single verified public revision from the private review, matched literally and anchored, not arbitrary forty-character hashes or future revisions;
- documented owner, evidence, approval date and re-review condition when this provenance value/schema changes.

Keep default detection, full-history/current-tree scanning, inline-ignore rejection and the empty fingerprint-ignore input. Do not exempt a directory, all commits, all `api` fields, all hexadecimal strings or all historical findings. Do not alter the operational binding to hide a match or invalidate its evidence hashes. Renaming/removing the current field alone would leave the historical finding and is not sufficient. History rewrite is prohibited.

**Approval is still required before applying that exception.** No proposed exception was used even for a trial scan, and no result is presented as passing under an unapproved configuration. After explicit approval, validate the narrow implementation with generated credential canaries (including a different credential in the same path and historical-only exposure), run `SECURITY_SCANNER_DIR=... pnpm test:infra`, and rerun the uncached `security-scan.mjs secrets` over the full candidate/history. Any unexpected match or scanner error remains blocking.

If a separate actual credential exposure is discovered, use a private incident record without its value; identify the issuer/scope and exposure window, obtain explicit rotation/revocation approval, revoke the exposed credential and any derived sessions/grants as applicable, update only approved secret delivery, verify services and audit safe usage evidence. Do not rotate live credentials or rewrite history under this preflight.

Fresh dependency audit passed with **zero advisories at every severity**. No dependency or version pin was changed.

## 3. Clean reproducible release source

Read-only review at `2026-10-13T08:51:26Z` found HEAD `11c2a53036b6cb4bce14cc040a95e31a208e592c`, full local history, no staged changes, **45 modified tracked files and 108 nonignored untracked files**. These counts include existing owner work and K1–K4A, not just Kahroba implementation. All 51 files in the final K4A hash ledger still matched before this documentation update. Protected Coup engine, Bot/Auth/Users, schema/migrations and affected original test sources have no tracked diff against HEAD.

The two K4A builds still have equal complete manifests and image references. They remain `sourceDirty=true`; no clean candidate revision exists. Current report/documentation updates also mean the complete current source snapshot is not identical to the earlier image context. Neither a tag, matching functional code nor manually changing `sourceDirty` satisfies the source gate. Existing CI evidence export, staging acceptance and renewal enforce clean pinned source.

Safest release procedure, **requiring separate commit authorization**:

1. Preserve the entire current worktree and staged/unstaged/untracked distinction in a private, hash-inventoried local safety copy. Include binary assets/tests/licenses; exclude ignored runtime credentials, caches and generated files. Do not stash, reset, clean, discard or bulk-stage the user's work.
2. Inventory the proposed release scope against K1/K2/K3/K4A ledgers. Explicitly separate the owner's existing containment/binding changes from implementation; retain them in the original worktree regardless of whether approved for the release. Review scanner-policy and regression resolutions as their own changes.
3. Create an isolated full-history checkout/worktree from the verified base with the reviewed release delta. Keep the shared development worktree untouched. Before authorization this review checkout may be dirty; that is not release-ready.
4. Only after separate authorization, commit the reviewed selection on an isolated release branch. No push, merge or PR is implied by commit authorization. Verify exact Git tree, clean status, original pins, frozen lockfile and all required gates. A future SHA is intentionally not invented here.
5. Build fresh four-role artifacts from that exact clean revision with the approved private Web flag/browser policy; repeat mandatory scans/contracts/integration/browser/package checks and source/image binding. Prepare a tested v2-capable rollback pair. Do not relabel or promote the old dirty images as clean artifacts.

No safety copy, worktree, branch or commit was created during this review; only the review ledger and documents were written. Evidence: `source-review.json`, K4A `files.json` and `artifacts.json`.

## 4. SSH, staging access and containment

Documented access is the original owner's key-authenticated SSH/operator context. Effective local target is the recorded root account, VPS `185.110.191.104`, port 22, default identity paths, with no documented alternate port/jump/proxy/identity. The local SSH directory has known-host and authorized-key files but **no default private-key files**. An agent socket exists but has **zero loaded identities**.

A bounded noninteractive, strict-known-host SSH diagnostic established TCP, matched the existing known host key, offered zero public keys and exited 255 without authenticating. Raw diagnostics were withheld. This locates the available blocker in the missing local credential context; it is **not proof that server SSH is down, a firewall is blocking SSH, or the owner's authorized key has been revoked**. No password prompt, access modification, alternate username probing or insecure host-key acceptance was attempted.

Next permitted access step is to make the existing approved owner key available through its normal local secure SSH context, without sending passwords/private keys in chat, or have the existing sole operator run the reviewed read-only checks and return sanitized evidence. Do not create a new operator, upload a key, change SSH/firewall settings or use provider-console mutations as a workaround.

Read-only TLS HEAD at **2026-10-13 08:50:13 UTC / 12:20:13 Tehran** returned Web **200** with existing security/no-store headers. Private Kahroba remains unactivated; the later recorded API probe is retained alongside the review. Public HTTPS does not prove private health, installed images, Docker daemon identity, database state, mounts or timers.

The binding was last recorded at `2026-10-12T19:14:11.651Z`. It records normal security expiry **2026-10-13 13:18:23 UTC / 16:48:23 Tehran**. At the `08:54:20 UTC` review that deadline was **not yet expired**, with about 4h24m remaining. This is arithmetic on historical evidence, not a fresh installed-timer readback or permission to extend a window. The historical renewal authorization grants no new operational action. Current maintenance state, timer enablement/next trigger/service hashes and target scans still require authenticated operator verification. If the deadline passes, preserve containment; do not renew or reopen traffic under this scope.

Some older runbook paragraphs contain superseded prepared-directory/timer values. Use the latest binding as a recorded reference and verify it on the target before invoking tools. Recorded prepared directory is `/opt/hambazi-staging/private/prepared-approved-home-web-685d9f6`, operator runner `/opt/hambazi-staging/private/runner-home-entry-1bfc42e`; neither is certified current by this review. The old single-owner acceptance binding must not be reused as acceptance for this two-human Kahroba scope.

## 5. Regressions, release policy and zlib

Fresh focused checks, with the production SDK pin preserved:

| Check                                                                                                             | Result                                                                                          |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm test:kahroba:local --bot-regression`                                                                        | Fresh disposable DB 17 passed; sessions 62 passed; Bot delivery **3 passed / 3 failed**, exit 1 |
| `TELEGRAM_SDK_FIXTURE_PATH=<repository pinned SDK> env -u GIO_MODULE_DIR pnpm --filter @hambazi/web test:preview` | **1 passed / 1 failed**, exit 1                                                                 |
| Unmodified pinned secrets CLI                                                                                     | **Blocked: history 1/current 1**, exit 1                                                        |
| Dependencies CLI                                                                                                  | **Passed: zero findings**, exit 0                                                               |

The Bot failures again occur at `bot-delivery.test.mjs:196:36`, `216:31`, `243:31`. Their fixture sends a registration intent and immediately expects account/support effects without the valid-name reply required by existing `PROMPT_NAME`/`WAITING` onboarding. Original Bot/Auth/Users/test sources are unchanged, and K3's clean pre-Kahroba export reproduced the same failures. The fresh result confirms a pre-existing test/behavior mismatch; it does not silently excuse it.

The legacy preview again fails at `preview.spec.ts:33:66`: English `Your cards`/`AMBASSADOR`/`declare income` expectations do not match the existing Persian Coup view. Its original source is unchanged and K3's clean baseline reproduced it. No unrelated product or test behavior was changed.

`docs/operations/ci.md`, ADR-041 and executable `infra/ci/verify.mjs` require integration and preview-isolation checks. The migration/fault gate invokes `test:auth-http:local` → `test:auth:local` → the database harness, whose API suite explicitly includes `bot-delivery.test.mjs`. Thus both retained failures affect required release verification; `pnpm check` passing alone cannot clear them. **No existing waiver or scoped acceptance for these failures was found.** Resolve them under separately authorized scope, or obtain an explicit documented staging-only policy decision if allowed; never label failing checks as passed or infer a waiver from “pre-existing.” No normal protected/production release can be declared green through risk acceptance alone.

The candidate's fresh exact-image evidence remains within the normal 24h limit at `08:54:38 UTC`: advisory UpdatedAt age about 2.22h, DownloadedAt about 0.62h. All four app images retain exactly one **Moderate zlib CVE-2026-85091** each, fix available; K4A's two data replicas retain one each, ingress/ACME zero. Zero HIGH/CRITICAL/UNKNOWN. ADR-056, the risk register and existing severity policy explicitly retain this Moderate decision and remediation tracking. It applies to the inspected candidate finding without a new suppression or severity waiver; it is not fixed and does not grant production approval. A clean rebuild or later deployment must rescan its exact images and re-evaluate severity/age. No image/pin or advisory policy was changed.

## 6. Remaining blockers and restricted-plan audit

| Gate                                 | Status / next action                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secret scanner                       | False positives explained; machine gate still blocked. Explicit narrow-decision approval and validated remediation required.                                                                                                                                                                                  |
| Clean release source                 | Dirty reviewed source only. Separate commit authorization, selected clean revision, rebuild and evidence required.                                                                                                                                                                                            |
| Required regressions                 | Three Bot and one preview failure remain; no recorded waiver. Separate repair or explicit permitted scoped policy decision required.                                                                                                                                                                          |
| Owner operational access             | Missing local key context; authenticated read-only target audit unavailable.                                                                                                                                                                                                                                  |
| Current target/containment           | Historical reference only; verify actual daemon/images, private health, timer/deadline/service hashes, mounts, queues, migration count and scan bindings.                                                                                                                                                     |
| Private runtime configuration        | Seal existing queue namespace, Room limits/verified named-app target, transport lease values and reviewed routing/DML. Local `play` is not a staging short name.                                                                                                                                              |
| Recovery scope                       | ADR-050 excludes backups/PITR/restore for personal disposable staging; ADR-058 grants only the existing tester's ordinary personal features. Neither explicitly accepts the new two-human Kahroba recovery scope. Owner confirmation/extension is required; do not provision backups or claim restore passed. |
| Rollback                             | Need exact fresh v2-capable API/Worker rollback artifacts and actual active-pin/job/history review. Old staged Worker is not assumed compatible.                                                                                                                                                              |
| Native test and deployment authority | Native two-account acceptance is a bounded post-activation test; K4B deployment remains separately unapproved.                                                                                                                                                                                                |

The updated [restricted plan](../operations/kahroba-restricted-staging-plan.md) preserves production HOLD; the existing original owner and `@devtest98` only; no additional real identities or public Kahroba play; no new schema migration; existing Coup/Anarchist matches and historical v1/v2 results; Worker/readers before API producers; admission last; and existing staging maintenance/containment controls.

Rollback closes new admission first, preserves active Kahroba routes/pins/state until safe completion or explicit maintenance, and retains v2 consumers/result readers/statistics rebuild indefinitely for historical shared victories. Queue draining alone never makes the old Worker safe. No invented human timer, termination, re-deal or Bot fallback is authorized. Backup restoration and data-loss recovery are not claimed by restart/reconnect tests.

## 7. Plan amendments and evidence

Only two repository documents changed in this preflight: this report was created and `docs/operations/kahroba-restricted-staging-plan.md` was updated with the blocker sequence and access/policy distinctions. Gameplay, Bot/Auth/Users, scanners, staging bindings, service files, role/admission files, schemas and dependencies were not changed. Logs and safe JSON review ledgers are ignored local evidence under `test-results/kahroba-k4b-preflight/`; redacted raw findings existed only in a private deleted temporary directory.

No full unchanged game/browser/container workload was repeated. K4A's hash-matching implementation and exact candidate scan/build evidence are retained with their actual timestamps; targeted failures and security checks were independently rerun. This is focused review, not hosted CI, native acceptance or actual target validation.

## 8. Recommendation and stop

**NO-GO for K4B restricted staging deployment now.** Local engine/runtime evidence is sufficient for review, but clean-source, scanner, mandatory-regression and fresh operational gates are not clear. Preserve the recorded timer and production HOLD. Resolve/approve the concrete local remediation and release-source steps first, then obtain a new authenticated read-only target preflight before requesting deployment approval.

Stop after this preflight. Explicit approval is required before any K4B deployment or activation; this review grants none.
