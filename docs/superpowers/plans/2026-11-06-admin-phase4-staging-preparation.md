# Phase 4 Staging preparation implementation plan

> Execute the already authorized local preparation with Superpowers verification/TDD for compatibility; one independent final review. No deployment.

**Goal:** Verify Phase3-compatible rollback on post-Phase4 data, finalize backup/restore/emergency and live-QA gates, and bind current security evidence without a historical causal-fix claim.

**Architecture:** Keep current product source unchanged. Build a separate Phase3 baseline plus the exact permission-vocabulary and proven writer/abort security backports required by ADR-093. No destructive migration, history rewrite, new service, security exception or invented capacity target.

**Spec:** Approved Phase4 design/ADR-093 and user's current local-only preparation request.

## Constraints and review focus

- Local synthetic disposable databases/credentials only; no SSH/server/real OWNER/keys/env/data/backups, Staging/Production changes, load/capacity tests, deployment or Phase5.
- Persist ROLE_SAVE/ADMIN_ACCESS using new keys, then revoke current grants; original Phase3 parser must reject historical keys while compatible fallback parses them. Revocation does not erase history.
- Verify the old Phase3 schema and all21 migrations are unchanged/redeployable; retain restriction enforcement/expiry/reconciliation and successful narrow-credential close/termination/abort fixes.
- Binary/client fallback must remove advanced Phase4 surfaces without discarding compatible permission/action/history parsers. Failed/stale evidence blocks activation.
- Real full encrypted backup/offserver/same-archive restore and live QA remain separate authorized gates; synthetic tests cannot close them.

## Task 1 — Isolated compatibility and artifact

- [x] Make a private full-history Phase3 baseline candidate at bf34fc0, install frozen dependencies and record a reproducible minimal patch recipe.
- [x] Observe original Phase3 parser RED on current new-key ROLE_SAVE/ADMIN_ACCESS data; apply only five permission keys, two proven writer repairs and abort cleanup preserving original Phase3 route allowlist.
- [x] Build compatible Backend and Phase3 client with declared scripts; freeze patched source and build/scan the immutable fallback Admin image from the existing qualified runtime/dependencies.
- [x] Rehearse current→fallback→current on the same owned disposable DB. Assert historical actions/grants/receipts/Audit preserved, deny-by-default RBAC, no advanced Phase4 routes, Phase3 restrictions/private-note behavior and metadata unchanged. Include grants-revoked history and pending operations where safe.

## Task 2 — Release/backup/QA documentation

- [x] Review existing private backup CODE only; identify stale tool guards and missing receipt bindings. Finalize exact real-ceremony prerequisites and safe failure/restore decisions without executing them.
- [x] Publish live QA matrix for unauthenticated/pending/limited-role/OWNER, scope, Audit, session revoke, games/rooms/Matches, races/idempotency and privacy. Real writes require their explicit QA authorization and synthetic targets.
- [x] Record historical migration risk and diagnostic capture/stop/rollback policy separately from actual CI success; no silent risk waiver.

## Task 3 — Evidence and final review

- [x] Revalidate source/artifact hashes and scan freshness under unchanged policy; record actual new scan failures or stale evidence honestly, no blind full-CI repeat without a code change.
- [x] Independently review recipe, rehearsal and final runbook/evidence; format/secret-check new documentation, commit and report residual gates. Stop before any live action.

Outcome: local Admin fallback proof completed; new real-backup bundle qualification and actual authorized target/archive/live-QA gates remain NO-GO prerequisites, not completed work. Historical cause remains unknown. Final review/evidence-document checks are recorded separately before commit.
