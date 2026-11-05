# Independent review — Phase 4 release-blocker follow-up

What this change does: The history cursor input pattern now describes the same positive int32 range already enforced at runtime. Regression assertions check the generated query schema and endpoint contract. A private observer is being used to retain narrow failure context during local qualification.

Reviewed source range: `8c1e669..ae6a3ed7369a25db4a03a3566db44c35161a93fc`. The initial implementation review was followed by assessment of the completed aggregate CI, final exact-image receipts and current qualification/readiness documentation. Runtime source did not change between these review cuts. Review was read-only except this report, with no test reruns, source/history/server edits or subagents.

## Findings

No actionable Critical, Important or Minor implementation finding identified in this scoped change.

The previous failed final CI remains historical evidence. The passing baseline migration run does not establish why the earlier run failed. The new candidate now has its own complete passing CI evidence. The requested historical causal diagnosis/repair remains an unresolved task requirement, not evidence of a newly proven migration defect. No material misrepresentation or missing local automated gate was found in the final qualification/readiness record.

## Implementation assessment

- `packages/validation/src/admin-game-management.ts:73`: The pattern partitions positive decimal strings at every prefix of 2147483647. The alternatives cover 1 through 2147483647 without permitting leading zeroes, signs, decimal/exponent syntax or larger values. The existing Number conversion and positive bounded integer pipe remain. Runtime accepted values and the inferred numeric application type are preserved.
- `packages/validation/tests/admin-game-management.test.ts:103`: The regression compares generated input-schema acceptance and runtime acceptance with an independent decimal/range predicate. Cases exercise the decimal-prefix boundaries, 1, 2147483647, 2147483648, zero, empty/whitespace and malformed strings. The recorded RED specifically failed because the generated pattern accepted 2147483648 while runtime rejected it.
- `apps/api/tests/admin/game-management-contract.test.ts:72` and `docs/contracts/admin.openapi.json:17499`: Endpoint contract assertions verify the meaningful boundary behavior, and the generated artifact changes only the cursor pattern. No frozen baseline or compatibility checker was changed.
- Connected flow: `apps/api/src/admin/infrastructure/contract.ts:234` still generates history parameters from the same input schema; `apps/api/src/admin/infrastructure/http.ts:429` still parses HTTP input through it; `apps/api/src/matches/infrastructure/repositories/admin-read.ts:213` retains positive int32 validation and parameterized sequence pagination. Authentication, permission intersection, owning-module reads, projections and response validation are unchanged. The read-only graph query independently identified the schema imports from contract and HTTP modules; current source was checked directly rather than relying on graph freshness.
- The added plan accurately requires full unchanged 28-gate qualification and preserves the local-only and release boundaries. There is no new dependency, public capability, persistence write path or migration implementation in this diff.

**Spec compliance:** Approved for the scoped cursor correction. The approved Phase 4 behavior and module/security boundaries are preserved, and the unchanged whole-CI local acceptance condition now passes. The broader follow-up plan's requested historical causal diagnosis/repair is not complete: the cause remains unestablished and no migration correction was proved necessary or applied.

**Code quality:** Approved. The explicit range pattern is longer than the former unbounded pattern, but it solves the generated-input-schema discrepancy at the owning schema with no new abstraction or manual contract override. Boundary assertions explain and protect it.

## Private observer assessment

Inspected `/home/mehdi/.cache/hambazi-phase4-final-fix-vetmgy4h/capture-migration-failure.mjs`, the final self-test source/receipt, and both private Python runners.

- The wrapper delegates ordinary `execFile` to the original implementation. Its promisified form calls the original promisified implementation and returns that same promise. It neither substitutes successful output nor converts rejection into success.
- Selected contexts are fixed to top-level `pnpm check` (root-quality) and `pnpm test:auth-http:local` (migration-fault-release). Output retention is limited to numeric/fixed-format process metadata, constrained source-location/timeout matches and existing fixed stage/location lines from the owned harness. The stage producers in the auth/database/restore harnesses were inspected. No raw stdout/stderr, error object, environment or command is serialized by this observer.
- Final self-test receipt records exit code 7 and a source location; its assertion excludes the synthetic raw-output canary. The recorded self-test exited 0 and checks ordinary success and rejection preservation. This is supporting local diagnostic evidence, not a gate pass.
- The runners use an environment allowlist plus an explicit fixture environment; the observed environment does not include `NODE_OPTIONS`. Loading the observer with the parent Node import option does not automatically preload child Node processes. The scripts and their 600-second gate deadlines remain unchanged.
- The observer should remain explicitly identified as private diagnostic context in final records. Its self-test and source inspection do not establish historical failure cause, exhaustive telemetry safety of unrelated fixture output, or equivalence to uninstrumented execution under every possible host failure.

No observer bypass or deliberate weakening of CI assertions/timeouts was found.

## Evidence assessed

Directly read the actual private receipts under `/home/mehdi/.cache/hambazi-phase4-final-fix-vetmgy4h`:

- Cursor RED: exit 1, 35 pass / 1 fail; exact documented cursor 2147483648 mismatch.
- Cursor GREEN: exit 0, 151 validation tests.
- Compiled public surfaces: exit 0; API tests: exit 0, 1085 tests.
- Validation typecheck and scoped lint: exit 0. Contract check, generation and formatting: exit 0.
- Previous-runtime migration baseline: exit 0 in 280.66 seconds, including six release browser cases and a 45-table logical restore. The integration count and runtime identity are controller-bound context; this review directly inspected the receipt/tail, not an independent execution or exhaustive audit of the private log.
- Final observer self-test: exit 0; preserved rejection code 7, fixed diagnostic metadata and canary exclusion.

These individual receipts support the correction. They are not a substitute for the new candidate's unchanged aggregate CI, exact artifact identities or fresh scans.

## Final qualification evidence assessment

Directly inspected the actual `runner/hambazi-ci-evidence/manifest.json`, whole-ci result/log, frozen-install receipt, final image inventories/scans, dedicated Admin result and private build/scan/identity fixture sources. Inspected the current diffs in `docs/security/admin-phase4-qualification.json` and `docs/operations/admin-phase-4-release-readiness.md`.

- Whole-CI receipt: exit 0 in 1937.28 seconds. Actual manifest contains all 28 distinct stages in the unchanged entrypoint order, all passed, ending at normal-web-build. Qualification gate entries exactly equal manifest entries. Root quality records 2497 tests; Admin integration 81; migration/fault/release 306 plus six browser cases; formerly unrun ordinary browser / built SDK / preview isolation / normal build gates now pass, with 31 / 39 / 2 browser cases for the first three. Core image smoke records 46 checks and two browser cases.
- The 45-table restore claim is supported by the configured isolated restore path, successful aggregate gate and the standalone baseline's direct restore output. The aggregate manifest counts tests/browser cases but does not independently inventory restored tables; no new raw aggregate child output was retained. This distinction does not turn the baseline into aggregate evidence.
- Independently recomputed all 18 current result/log hash pairs and all 18 listed execution/artifact hashes. Independently verified all 864 CI inventory file sizes/content hashes against the candidate, and all 22400 Admin build-context entries against the private context plus its canonical source digest. All matched. These are artifact inspections, not suite reruns.
- Candidate HEAD/tree equal `ae6a3ed7369a25db4a03a3566db44c35161a93fc` / `98de5e1791c7b4c6a5c5ef16f6e173cb48b62833`; full history, clean status and absent root developer `.env` were checked directly. Lockfile/schema/toolchain/security-policy hashes match the manifest and relevant artifact inventory. CI source, test harnesses, policy and lockfile are unchanged from previous runtime `30eaec0`; all 21 SQL migrations are unchanged from the Phase 4 base.
- The manifest/build inventory bind the same source snapshot and build-input digests. The Admin build inventory names the exact CI API and Web/runtime images, binds the core inventory digest, and exactly equals the published qualification object. The Admin scan and 43-check receipt exactly equal their qualification objects; requested image, expected image ID and actual running image ID agree. Private build/scan/fixture source inspection supports the production-mode local TLS/identity checks and does not reveal an assertion bypass.
- All seven recorded exact-image scans report zero findings at every recorded severity, including Unknown. Their recorded scanner database timestamps meet the unchanged 24-hour freshness policy at the recorded qualification time. Dependency policy retains one Moderate minimatch advisory with zero High/Critical; this review makes no claim about current or future advisory freshness.
- The observer source hash matches the recorded hash. The documentation explicitly says the parent entrypoint used the private observer and was not an uninstrumented rerun. The observer did not capture a new failure; it did not change gate commands, assertions, retries or deadlines. No extra uninstrumented rerun is inferred or claimed by this review.
- The old failed qualification is preserved in Git at `8c1e6690e789cc91cbe0cee359203c38a1442061`; its recomputed raw-file digest matches the new record. Historical failures, the original 23-pass/one-failed/four-unrun outcome, and unknown causes remain visible. The completed 28-gate attempt is represented as a new attempt, not a rewrite of that history.
- Current readiness text and JSON consistently separate automated success, unresolved causal diagnosis, synthetic-only scope, real backup/restore, compatible rollback artifact, live QA and capacity limits. The pending final-review publication link/status is an intentional final documentation step, not claimed completed evidence.

## Final verdict

**Implementation: approved. Local automated qualification: passed for the exact reviewed candidate, with the disclosed parent observer. Requested historical causal diagnosis/repair: incomplete. Deployment readiness: NO-GO.**

The former missing aggregate pass is resolved by a real complete 28-gate run. No additional source defect or qualification-record correction is required by this review. This is approval of the cursor implementation and truthful local automated evidence, not unconditional approval that every requested outcome is complete: the historical migration cause remains unestablished. The passing old-runtime standalone gate and new complete sequence do not establish a cause, a migration fix or an implicit risk exception. Preserve that unresolved requirement when reporting completion or making any integration decision.

Real backup/same-archive restore, compatible rollback artifact/rehearsal, separately authorized Staging/live QA and other existing release prerequisites remain open. No deployment approval is given.

## Declined to judge

- Historical migration-fault-release cause: not reproduced and no causal evidence established. No speculative source fix is warranted by the passing baseline alone.
- An uninstrumented entrypoint rerun: not performed or claimed. Evidence reviewed is the disclosed observer-assisted aggregate run.
- Hosted Actions; Staging/Production state, OWNER/real data/credentials, SSH, deployment or Phase 5: outside scope and untouched.
- Real encrypted backup, off-server copy, restoration of that same archive/config-key capsule and compatible production rollback artifact: remain separate release prerequisites; synthetic local restore is insufficient.
- Capacity/load/stress/reconnect storm/two-hour soak: unrun and deferred; no peak target inferred.
- Exhaustive unrelated Phase 4 source rereview, independent browser execution, every private log line, current live vulnerability/advisory freshness, independent recreation of removed core source context, Docker-daemon reinspection, and all host-failure behavior of private diagnostic tooling: not assessed here. Source snapshot/build-input digests were assessed through the actual bound inventory and unchanged builder. Prior whole-branch review remains historical context, not substituted for this exact-diff review.

Skipped: suite reruns, source/test/history/server changes and user-owned graphify-out writes. Risk: passing local automated qualification does not resolve historical causality or establish deployment readiness.
