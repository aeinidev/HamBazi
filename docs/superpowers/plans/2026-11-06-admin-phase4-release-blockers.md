# Admin Phase 4 release blockers implementation plan

> **For agentic workers:** Use superpowers:executing-plans and systematic-debugging; complete the already authorized local correction, then one independent final review.

**Goal:** Establish the migration-fault-release cause, repair it and the cursor contract mismatch, and rerun all 28 unchanged CI gates.

**Architecture:** Preserve the existing Phase 4 modular monolith, owning readers, command writers and security boundaries. Diagnose with synthetic disposable fixtures and private logs before choosing a fix; use existing helpers.

**Tech Stack:** Existing pinned Node/pnpm/Docker, Vitest, Playwright, PostgreSQL/Redis and Zod/OpenAPI.

**Spec:** [Approved Phase 4 design](../specs/2026-11-04-admin-phase4-design.md), with the user's 2026-11-06 correction authorization. No new feature scope.

## Global constraints

- Local development/test only; no SSH, Staging, Production, real OWNER/data/credentials, deployment or Phase 5. Capacity deferred.
- No removed tests, weakened assertions/security, arbitrary timeout increases or fabricated CI evidence.
- Preserve all historical failures and bind new evidence to exact source/artifacts.

## Review focus

- Migration diagnostic must distinguish service setup, real assertion, browser and cleanup failures; a later success alone does not establish cause.
- Fix root cause at its owning source, not by retrying away failure.
- Cursor contract and runtime agree at 1, 2147483647, 2147483648, zero and malformed decimal strings.
- All 28 gates must actually execute; independent passes are not aggregate CI approval.
- New artifacts and rollback/backup prerequisites must remain distinguishable from deployment authorization.

### Task 1: Diagnose and repair migration-fault-release

**Files:** Read infra/ci/{verify,gates}.mjs, infra/scripts/test-auth-http-local.mjs and packages/database/scripts/test-local.mjs plus the failing owning fixture; edit only the proven root source and its regression test.

- [ ] Run the exact failing gate on the previous isolated candidate with CI environment and private diagnostics; identify the precise failing stage/test.
- [ ] Trace the failure, compare passing path and test one specific hypothesis. Record limitations if historical failure cannot be reproduced.
- [ ] Write/observe a focused RED; implement the minimum correction; verify GREEN and the full migration/fault/release gate without weakened controls.

### Task 2: Align cursor contract

**Files:** packages/validation/src/admin-game-management.ts, packages/validation/tests/admin-game-management.test.ts, generated docs/contracts/admin.openapi.json as needed; inspect apps/api/src/admin/infrastructure/contract.ts and its tests.

- [ ] Add a failing generated-query-schema boundary assertion against runtime for the exact cursor cases in Review focus.
- [ ] Apply the smallest existing Zod/OpenAPI-compatible restriction; retain runtime positive-int32 semantics.
- [ ] Run validation/API contract checks and regenerate through declared scripts, without changing the frozen baseline/checker.

### Task 3: Full qualification and final record

**Files:** docs/security/admin-phase4-qualification.json, final-review record and docs/operations/admin-phase-4-release-readiness.md; retain the existing backup/rollback plan.

- [ ] Commit runtime fixes; build a clean full-history local candidate without developer environment and install frozen dependencies.
- [ ] Execute unchanged node infra/ci/verify.mjs through all 28 gates, inspect actual results and qualify final exact image identities/fresh scans including Admin.
- [ ] Obtain independent final review; record actual passes/failures/unrun gates, root cause evidence, remaining backup/rollback/live gates and deferred capacity.
- [ ] Commit documentation, verify Git status/diff and stop before deployment.
