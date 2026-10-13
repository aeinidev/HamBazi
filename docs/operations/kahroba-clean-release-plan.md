# Kahroba K4B — Proposed clean release source

Date: 2026-10-13. **Proposal only: no commit, push, deployment or staging change is authorized by this document. Production HOLD remains.**

## Verified source position

Discovery found a clean checkout at existing commit `e76fcac52006d5b82270924c84fea5e33ffd3d17`, whose parent is verified pre-Kahroba baseline `11c2a53036b6cb4bce14cc040a95e31a208e592c`. The aggregate commit already contains K1–K4A and the approved security remediation. It existed when this task began; no commit was created here. Earlier documents correctly describe their earlier dirty source, but are not the current checkout status.

The [exact inventory](kahroba-release-inventory.json) records all **160 paths: 112 additions and 48 modifications**, source sizes and SHA-256 values. It separates the two preserved owner operational files and identifies all proposed additional paths. Group labels aid review; the path inventory is authoritative.

| Existing aggregate group                                      | Paths |
| ------------------------------------------------------------- | ----: |
| K1 rules, dataset, engine, fixtures and MIT attribution       |    28 |
| Multiplayer application and contracts                         |    31 |
| Web assets, views, local preview and browser tests            |    48 |
| Worker v1/v2 consumers and statistics                         |     5 |
| Runtime configuration                                         |     3 |
| v2 result validation                                          |     2 |
| Approved security remediation                                 |     6 |
| Local harness, packaging and preparation                      |     6 |
| Workspace manifests and lockfile                              |     3 |
| Architecture, contracts, design and operational documentation |    26 |
| Preserved owner operational evidence                          |     2 |

The only new implementation delta in this task is three test files. The full mandatory release-browser driver exposed the same obsolete English Coup labels during verification and also required the existing target-confirmation flow. The [regression report](../testing/kahroba-k4b-regressions.md), this plan and its inventory are the proposed documentation delta. None is committed yet.

## Preserve unrelated work

Keep `infra/docker/staging/staging-test-user-current.json` and `docs/operations/incidents/2026-10-12-staging-containment.md` byte-identical. They are already in the existing aggregate; do not remove them, rewrite that commit or treat their historical data as current target truth. Any separate decision to exclude owner evidence from a different release branch must preserve the original checkout and undergo explicit review first.

Keep all Bot/Auth/Users/Coup production sources, existing public contracts, schema and fifteen existing migrations, other game assets, SDK/SRI, dependency/image/scanner pins and admission/containment definitions unchanged. The release proposal neither changes the Moderate zlib decision nor grants approval for public Kahroba. No new migration or generated Prisma source belongs in the commit.

Ignored files remain excluded: runtime environment files, dependency directories, compiled output, Turbo cache, generated Prisma client, local scanner/baseline directories and `test-results/` logs, screenshots, fixtures and private reports. The exact inventory is public path/hash metadata, not an export of runtime configuration values.

## Proposed commit boundaries — require separate approval

1. **`test(release): align Bot onboarding and Coup preview regressions`**
   - `apps/api/tests/integration/bot-delivery.test.mjs`
   - `apps/web/tests/preview/preview.spec.ts`
   - `apps/web/tests/release/mvp.spec.ts`
   - Complete the documented acknowledged-name registration fixture; retain zero-account-before-name, exact-once account effects, chosen-name persistence, restart/duplicate handling and support timing/privacy checks. Match Persian controls and observe one actual synthetic income command; preserve preview authentication/storage/debug isolation. Align the existing real-release Coup driver with those same labels and explicitly choose/confirm a legal target; keep acknowledgement/revision, offline catch-up, privacy, finish/result/statistics and restore gates.
2. **`docs(release): record K4B regression evidence and clean-source plan`**
   - `docs/testing/kahroba-k4b-regressions.md`
   - `docs/operations/kahroba-clean-release-plan.md`
   - `docs/operations/kahroba-release-inventory.json`
   - Record fresh and failed executions separately, the exact existing source delta, remaining gates and approval boundaries.

Retain the existing aggregate ancestry. Do not amend/rebase/reset/split it or bulk-stage the tree. After explicit commit authorization, use an isolated release checkout with full history and only the reviewed six-path delta. Preserve any subsequently added owner work in the shared checkout. Verify the proposed staged diff and exact hashes before each commit. Commit approval does not authorize push, PR, merge, deployment or timer renewal.

## Required assets, generated data and documentation

- Include all **17 committed original-art WebPs, 822,484 bytes**, and `docs/design/kahroba-assets.json`; their current bytes match all recorded SHA-256 values. Preserve the owner's original ZIP/reference outside the release; they are not runtime files. Asset regeneration is unnecessary and could introduce unreviewed codec differences.
- Include the full verified card/noble economic fixtures, `dataset-provenance.json`, MIT attribution and engine/model/replay tests. Preserve their current bytes; the licensed reuse and original-art decisions in K1 remain applicable.
- Include generated result-v2 and private-runtime-v1 contracts **and their baselines**, alongside the unchanged original v1 contracts. Run the existing generators in disposable copies and compare every output byte; do not update a baseline to make a changed contract pass.
- Keep ADR-064 through ADR-068 and Kahroba architecture/design/testing/operations documentation. The registration SQL is a proposed dormant DML artifact; including it grants no authority to execute it.
- Produce compiled packages, Web HTML/JS/CSS/headers, Prisma client and container artifacts through pinned build scripts in the release environment. Do not commit these ignored outputs.

## Reproducibility and clean-source gates

1. Verify the exact new commit/tree, clean checkout, full reachable history, lockfile integrity and the documented Node/pnpm/Docker/scanner pins. Install with the existing frozen lockfile; never relabel a dirty snapshot as clean.
2. Execute all required gates using the documented CI force/concurrency policy. Fresh local results and the wider gate limits are in the regression report. Cached logs are not new execution. Hosted evidence/protection checks remain a separate requirement.
3. Regenerate and diff contracts in disposable copies. Verify SDK SHA-384/SRI, all WebP hashes, dataset/license and archive integrity. Record generated build-output hashes separately from release-source hashes.
4. Build two fresh four-role candidates from that exact clean revision with identical reviewed private Web feature/origins/frame policy. Compare complete source/build-input manifests and immutable image references. The old dirty K4A builds reference the old parent snapshot and cannot be promoted.
5. Rescan those exact new images with the pinned scanners and normal fresh advisory database. The existing permitted Moderate zlib finding stays visible; HIGH/CRITICAL/UNKNOWN and scanner errors block. Test packaged/static/runtime compatibility, production preview exclusion and dormant-by-default Kahroba.
6. Preserve v1/v2 consumers and result readers; establish an exact v2-capable API/Worker rollback pair. Deploy consumers before producers and admission last only after separately authorized target verification/deployment. Queue draining does not make an old incompatible Worker safe.

The inventory's own hash and new documentation hashes are sealed in the external local final ledger to avoid recursive self-hashes. Review source hashes again at the authorization boundary; any later source change invalidates the prior clean candidate binding.

## Remaining release risks and stop

Local test success is not a clean release artifact or permission to operate staging. The newly executed built-SDK mandatory gate reports 10 passed / 28 failed and remains blocking; ordinary/Midnight/Kahroba successes cannot replace it. Resolve that gate without a waiver before declaring a release candidate ready. Before K4B, obtain separate commit/release-source authorization, fresh artifacts/scans and an authenticated read-only target audit. Verify actual containment/timer state, private roles/namespace/Room target, admission hashes, current pins/jobs/history, recovery-scope acceptance, exact rollback pair and bounded two-account native acceptance. Only the existing owner and `@devtest98` are permitted; production/public Kahroba remain HOLD.

Do not renew the recorded historical containment window or infer current server state from saved bindings. No load/soak, live access change, new identity, migration, service restart, deployment or production operation is part of this step. **STOP: request separate approval for the two proposed commits; staging deployment needs another explicit approval after its remaining gates are clear.**
