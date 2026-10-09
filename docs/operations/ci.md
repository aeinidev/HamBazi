# CI quality and protected release checks

[ADR-041](../adr/041-ci-trust-and-evidence.md) defines the trust and evidence
policy. `.github/workflows/ci.yml` runs the required quality job on every push,
pull request, merge-group candidate and manual run, plus a weekly default-branch
advisory check. It has no deployment, publication or production credentials.
All action references are full upstream commit SHAs reviewed alongside
`infra/ci/toolchain.json`. No shared package, Turbo, scanner or browser caches
are restored. Turbo gates run with `TURBO_FORCE=true` and local-only caching.
Run one Turbo task at a time to avoid oversubscribing compiler probes
on hosted runners; test deadlines and application behavior stay unchanged.

## Required gates

The workflow provisions Node 24.20.0, Corepack 0.35.0 and root-declared pnpm
12.4.1, then runs the declared frozen install. The verified tool installer
creates a new private directory below `runner.temp`; existing directories are
refused. Archive and binary hash mismatches or SDK integrity drift block.
`HAMBAZI_CI_ARCHIVE_DIR` is an optional local offline source for the same pinned
archives and SDK bytes, never a verification bypass. CI downloads official bytes.

The stock runner's Docker/PostgreSQL versions do not reproduce the locked
service image and restore clients. The official pinned Docker action installs
29.8.1 with the containerd snapshotter and selects its own Docker context. The
PGDG script installs signed PostgreSQL 18 server/client packages only when CI,
Linux x64 and Ubuntu noble guards match. Do not run this privileged provisioning
script on a developer or production host. Browser binaries/system libraries
come from the existing lockfile-selected Playwright CLI.

`node infra/ci/verify.mjs` runs these gates in order and stops at the first error:

| Gate                         | Command / purpose                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workflow                     | Hash-verified actionlint and executable trust-policy checks                                                                                                              |
| Secrets / dependencies       | Existing uncached `security-scan.mjs secrets` / `dependencies`; full reachable history and frozen candidate                                                              |
| Public surfaces              | `pnpm build` before compiled public-port consumers                                                                                                                       |
| Root quality                 | `pnpm check`: formatting, ESLint, boundaries, typecheck, domain/unit/infra tests, build and contract check                                                               |
| Contracts                    | API `contract:check`, then `contract:generate`, Prettier and `git diff --exit-code -- docs/contracts`                                                                    |
| Bot                          | Declared Bot `test:integration` with owned TLS fixtures                                                                                                                  |
| Images                       | Reproduce the locked PostgreSQL derivative, pull pinned Redis, scan both actual local digests with fresh Trivy data                                                      |
| Application images           | `infra/release/build.mjs`, `scan.mjs` and `test-local.mjs`: build four non-root candidates, scan their exact digests and exercise hardened disposable runtimes/built Web |
| Migration / faults / release | `pnpm test:auth-http:local` with `TEST_POSTGRES_MODE=compose`, `TEST_RESTORE_DRILL=isolated`, `TEST_RELEASE_BROWSER=isolated`                                            |
| Browsers                     | Web `test:browser`, built SDK `test:browser --config telegram-production.playwright.config.ts`, and `test:preview` sequentially                                          |
| Normal policy                | Final Web `build` restores normal production policy                                                                                                                      |
| Evidence                     | Require clean Git/source identity; hash reviewed builds/contracts and record scalar results/release gates                                                                |

The database harness owns all Docker networks, containers, volumes, credentials
and disposable databases. It exercises all migrations, repeat deployment,
upgrade/restart durability, ownership/grants and backup restoration. API/Worker
fault/race checks and built Mini App gameplay use those real services. Tests do
not use the developer `.env`, existing services or live Telegram accounts.
Do not run browser gates concurrently; their fixed loopback ports are shared.
See [release suites](../testing/release-suites.md) for fixture coverage/limits.

All scanner failures, stale/malformed data, High/Critical findings and unknown
image severities block. Lower-severity findings retain the existing scanner
policy and require risk review; they are not accepted by a green quality check.
No new exception or severity threshold is introduced. Security and contract
checks run outside Turbo and cannot be satisfied by its cache.

## Privacy and artifact policy

Each gate has bounded captured output and a timeout. Logs show fixed stage
identifiers, success and allowlisted scanner finding IDs/severity counts; failure exports no raw stdout/stderr, command,
environment or exception cause. Browser trace/video/screenshots remain off and
the existing scalar/private-button checks still apply. No failing reports,
database dumps, chat, cards, tokens or launch data are uploaded. Reproduce failures
in a disposable local fixture; do not enable raw CI debug or capture entire
workspaces to investigate them.

Only successful non-PR, non-merge-group main runs upload
`runner.temp/hambazi-ci-evidence/manifest.json`. Each artifact is named
`ci-evidence-<sha>-<run-id>-<attempt>`, refuses overwrite/missing files, excludes
hidden files and expires after 14 days. This is CI evidence retention, unrelated
to user data or the unresolved production backup retention decision.

The manifest contains source commit/tree, tool/runtime and lock/schema policy
hashes, allowed compiled-file/public-contract path/size/hash triples, numeric
gate counts, validated public scanner summaries (including all four application
image digests/source/build-input identity) and current release gates. It includes no file contents or raw test
report. `productionReleaseApproved` is always false. A dirty source tree, checkout
SHA mismatch, symlink, missing build or loopback production policy refuses it.
No image/archive upload, signature or provenance attestation is produced.
Application image evidence must match the clean current commit; dirty or
different-source image candidates block export. Future 18B deployment must bind
its reviewed images to the verified source revision and
must never promote a fork/PR artifact merely because this workflow ran.

## Repository protection and release requirements

After owner-led publication, a repository administrator must verify a successful
hosted run and configure the main branch ruleset/protection with:

- Required status check **Required quality and supply-chain gates**, supplied by
  workflow **HamBazi CI** / job `verify`; select the observed GitHub check rather
  than an unverified guessed context. Require the current candidate/up-to-date
  base; keep merge-queue `merge_group` coverage if a queue is enabled.
- PR review, restricted force pushes/deletion and controlled bypass. Review CI,
  scanner/tool/image pins, contracts, grants and release policy changes explicitly.
  Assign actual review owners through repository settings; no owner/team identity
  is invented in this phase.
- Verify denied deliberate lint/test/contract/scanner candidates and successful
  evidence binding before relying on these checks for releases.

These settings require repository administration and are not installed by YAML.
No hosted execution or enabled protection is implied by local test success.
Record the hosted run URL and actual required-check configuration when available.

Before final release readiness also require Phase 7C activation controls, 18B
non-root scanned deployment images/migration/rollback/restore/HTTPS staging smoke,
and **deferred production-like capacity validation**: 2x approved peak,
reconnect storm, at least two-hour soak and durable result reconciliation.
Resolve the applicable owner decisions, including provider/final SLO/backup policy.
17C is **Completed for MVP with performance exceptions** under
[ADR-048](../adr/048-mvp-capacity-acceptance.md); neither CI nor packaging claims
the production performance targets passed. OD-001's peaks are already approved.
Phase 19 must hold release if any of these gates lacks accepted evidence.

Phase 18B1 supplies portable local image candidates and actual CI build/scan/smoke
gates. Hosted staged E2E/environment protection/publication remains unperformed
and outside this task's external authority. Approved personal 18B3 now has a real
[owner-SSH acceptance gate](runbooks/private-operator.md#exact-personal-staging-acceptance-gate):
ten hash-bound native/E2E/rollback/availability/header reports, normal fresh eight
image gates and current private/public probes. This is protected by owner SSH,
not a claim of hosted environment approval rules. No CI secret or production
credential is added. Local five-case ordinary MVP browser evidence and actual
personal staging evidence retain different scopes. Phase 19 review is Completed
with **HOLD**; even Completed phase statuses cannot grant production release.
ADR-041 and the normal hosted release requirements above remain enforced.

## Local verification

Run the actual entry points in a clean disposable full-history checkout of the
candidate, without `.env`. Install with `pnpm install --frozen-lockfile` and
provision tools in an absolute new directory outside the checkout:

```sh
SECURITY_SCANNER_DIR=/absolute/new/private/tools node infra/ci/provision-tools.mjs
```

Use compatible Docker 29.8.1/containerd, PostgreSQL 18 binaries/share paths and
Chromium already provisioned without modifying the developer host. Set
`TEST_POSTGRES_BIN`, `TEST_POSTGRES_SHARE`, `SECURITY_SCANNER_DIR`,
`TELEGRAM_SDK_FIXTURE_PATH` and an owned `RUNNER_TEMP` outside the checkout; set
`LD_LIBRARY_PATH` only if the local binaries require it. Then:

```sh
node infra/ci/verify.mjs
```

The source must be clean for the final evidence gate. A candidate fixture may
have its own synthetic commit in its owned temporary Git repository; do not
commit or alter the user's worktree merely to satisfy this gate. Treat its
manifest as local candidate evidence, never a published source/release artifact.
The local runner does not exercise GitHub's action service, privileged runner
provisioning, artifact upload or repository protection settings.
