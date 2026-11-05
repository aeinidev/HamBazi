# Independent final whole-branch review — Admin Phase 4

Historical review cut; the [2026-11-06 follow-up](admin-phase4-release-blockers-review.md) and [current qualification](admin-phase4-qualification.json) record the subsequent cursor fix and passing complete local CI. This original verdict remains unchanged for its reviewed evidence.

Reviewed range: `bf34fc0a4aa4638099018a2ba05c6b6ba7711a9e..c33e060bb19ab86c07147785eb3c6559e26ceeef` (11 commits). Reviewed against the approved Phase 4 design/plan, ADR-093 and ADR-079/085. This is an independent final review, not an adoption of per-task approvals or the interrupted reviewer's interim comments. Review is read-only except this requested report; no suites, source changes, history changes, server operations or subagents.

## Strengths

- Owning Games/Rooms/Matches readers expose documented public ports. Admin composition dispatches through those ports rather than querying foreign tables. The fixed Matches database primitive keeps parameterized scope/date/player predicates before ascending-ID pagination, with a bounded 51-row result. No new dependency, service, queue or database was introduced.
- Strict independent schemas preserve the old resource DTOs. Base and fine read permissions intersect on the server, both sets of denies survive, and authenticated session/current authorization is checked for every request. Ordinary roles receive no automatic new fine grants. The permission vocabulary expansion and durable-history rollback floor are explicit in ADR-093.
- SELECT projections and narrow SQL grants exclude config/state/reconnect policy, event payload, invitation and credential material. Registered players and server bots have distinct truthful representations; roster/result overflow fails closed. History selects only allowlisted event metadata and committed public result columns, including null outcomes where evidence is absent. No changed read path logs hidden data.
- Diagnostics follow durable Room expiry and eligible ACTIVE/HUMAN/DISCONNECTED/unreplaced seat deadlines, preserving UNKNOWN when evidence is absent. They neither invent a global timeout nor mutate the resource.
- UI is real typed Backend integration, Persian/RTL, with labelled filters, explicit observation times/timezone, loading/empty/error states, internal table scrolling, permission-gated links/subviews and abort guards. Parent authorization revision keys clear/remount resource state. Existing ResourceActions/OperationFlow retain explicit request/reauthentication/approval/execute/receipt handling.
- Writer fixes are narrow: one-row processed-command createMany avoids unnecessary RETURNING privileges without weakening uniqueness/atomicity; guarded first Room UPDATE retains version/state/startedMatch guards and table-lane arbitration without broader grants. Actual DB tests cover successful close/termination, replay and races. Abort admission cleanup is idempotent and retains the hard cap while admission is pending; actual HTTPS partial-body tests exercise exhaustion, recovery and repeated accounting.
- Qualification truthfully distinguishes tested runtime 30eaec0, later documentation c33e060, individual diagnostics, final CI and exact image identities. Failed attempts and unrun gates remain visible. Fresh seven-image scans and the separate Admin image identity/TLS checks are useful scoped evidence, without being presented as deployment approval.

## Issues

### Critical (Must Fix)

None identified in the reviewed implementation. This is not a declaration of zero possible defects or release qualification.

### Important (Should Fix)

1. **Known qualification blocker: unchanged whole CI remains failed.** `docs/security/admin-phase4-qualification.json:286` records migration-fault-release FAILED; `:302` onward records four trailing entrypoint gates UNRUN. I independently read the actual final-standard-ci result and log: exit 1, 864.14 seconds, 23/28 gates passed, suppressed cause. This is an outstanding acceptance/merge gate, not a newly discovered source defect or a documentation misrepresentation. Earlier same-runtime 306 Vitest + 6 browser migration diagnostics cannot override the later aggregate failure. Before merge approval, investigate with real cause evidence and obtain a passing unchanged whole CI for the reviewed runtime; do not weaken gates, deadlines or assertions. No additional rerun was performed or authorized in this review.

No new Critical/Important code finding was identified beyond that existing qualification blocker.

### Minor (Nice to Have)

1. **Carried, verified: history cursor OpenAPI accepts a broader decimal range than runtime.** `apps/api/src/admin/infrastructure/contract.ts:234` generates the query definition from the input schema, whose `packages/validation/src/admin-game-management.ts:76` decimal regex permits values such as 2147483648; its numeric pipe rejects values above 2147483647. Generated-contract consumers can therefore construct a documented-but-rejected cursor. Constrain/document the HTTP string's int32 upper bound in the generated contract and add a matching boundary contract assertion. Normal server-generated cursors remain valid; this is not a scope bypass.

Carried expected fixture telemetry is recorded in the ledger/readiness document. I found no new sensitive telemetry in this branch; unrelated pre-existing output cleanup is not a merge condition for Phase 4.

## Spec compliance verdict

**Local implementation: compliant, with the retained minor contract-description mismatch. Qualification/completion: incomplete.** Search/details, bounded roster/history, evidence-based diagnostics, safe command reuse, owning boundaries, server scope intersection, Persian UI and local acceptance coverage are present. The explicitly ruled historical Match types, unavailable installed-version evidence, truthful personal bot metadata and minimal writer/transport repairs are compatible with the approved scope. Phases 1–3/OWNER/authentication machinery and frozen resource shapes remain in place; no Phase 5 or live activation was added.

Task 6 fulfilled truthful local release preparation; it did not achieve the plan's passing whole-CI acceptance condition. This final report closes only the independent whole-change review activity, not the failed CI or future release gates.

## Code quality verdict

**Approved with the stated minor and qualification condition.** The production changes are focused, use existing boundaries and command machinery, have explicit trust-boundary validation and meaningful DB/browser/transport coverage. I found no material architectural, privacy, authentication, command-atomicity or maintainability defect in the reviewed code. Generated OpenAPI/evidence volume accounts for much of the branch size; it is not equivalent to runtime complexity.

## Evidence assessed

Read the design/plan, ledger and rulings, task 6 report/review, ADR-093/079/085, release readiness/rollback plan and qualification record. Inspected every changed production source surface and its connected authorization/UI/DB snapshot/command code, plus schema, owner-role integration, browser and ingress regression tests. Reviewed generated-contract construction and representative generated definitions rather than treating thousands of generated lines as independent hand-written logic. Read the actual final CI receipt/log directly; no suites were rerun. Controller's separate all-hash verification is supporting evidence, not a substitute for this code review.

Recorded scoped evidence includes Admin 81, ingress 5, API 1085, seven exact fresh-scanned images, core smoke 46+2 and dedicated Admin identity/TLS 43. Final current-source root quality passed; earlier Kahroba timeouts remain unexplained historical failures. The dependency policy passed with one existing Moderate minimatch advisory, no High/Critical; the branch adds no dependency or lockfile change.

## Declined to judge

- Root cause of final migration-fault-release failure: actual entrypoint suppresses diagnostics; insufficient evidence, no rerun permitted. Gate remains failed.
- A passing unchanged whole CI and its four trailing gates: absent from final attempt. Earlier independent diagnostics are not an aggregate pass.
- Root causes of historical allocation/readiness/ECONNRESET, Phase 2/3/browser and Kahroba timeout failures: no established causal evidence; later passes do not explain them. The separately proven abort leak is not assumed to explain the original browser failure.
- Runtime execution of docs-only c33e060: evidence binds runtime 30eaec0; no claim that the documentation commit itself ran CI.
- Live Staging/Production identity, config/grant drift, ingress, live limited-role 403 and revoke-session receipt/Audit QA: outside authorization and not exercised by local fixtures.
- Fresh real encrypted full backup, off-server copy and genuine isolated restore of the same archive/config-key capsule: future separately authorized gate; synthetic logical restore cannot certify it.
- Production rollback artifact preserving vocabulary/history parser, Phase 3 behavior and writer/abort fixes: no qualified artifact exists; future build/fresh scan/rehearsal remains required.
- Capacity/load/stress/reconnect-storm/two-hour soak and hosted Actions: unrun; peak target undecided and not inferred.
- Current live vulnerability/advisory status or future image freshness: assessed the recorded local receipts only, made no network query or release-admission claim.
- New independent visual/browser execution or screenshot certification: tests and recorded inspection evidence were reviewed; no browser or suite rerun was performed in this read-only review.
- Exhaustive audit of private qualification runners or every private log line: relied on bound records, controller's all-hash verification and direct final CI inspection; did not claim independent rerun/reproduction of every artifact check.

## Assessment

**Ready to merge? No.** No new material implementation defect was found, but the approved plan requires passing unchanged whole CI and the actual final entrypoint is failed with four gates unrun. Release remains **NO-GO** independently of this review and until the separately authorized release gates also pass.

Skipped: suite reruns, live operations, user-owned graphify-out changes and source/test/history edits. Risk: scoped passes and clean local image scans do not establish aggregate or deployment readiness.
