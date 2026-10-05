# Operational scripts

This directory owns development and operational scripts for declared repository
workflows. `create-local-env.mjs` implements `pnpm infra:env`: generate distinct
local credentials in a private, ignored `.env` without overwriting existing work.
See the [local development runbook](../../docs/architecture/local-development.md).
Do not place business rules or committed credentials here.

Phase 17A1 adds the standalone `security-scan.mjs` gates and
`build-local-postgres.mjs` locked local image builder. See
[security scanning](../../docs/security/scanning.md) and
[image setup/transition](../../docs/security/local-image-transition.md).
`TEST_POSTGRES_MODE=compose` selects actual local image/bootstrap verification
in the existing isolated database harness. `test-postgres-transfer.mjs` uses only
its own synthetic source/target services for a cross-base logical transfer drill.
Neither tool accepts an existing database/volume or migrates live data.

See [workspace ownership](../../docs/architecture/workspaces.md) and the
[implementation plan](../../docs/implementation-plan.md).

Phase 16C adds [operational runbooks](../../docs/operations/runbooks/README.md),
[metrics/reporting documentation](../../docs/architecture/operational-observability.md)
and provider-independent dashboard/alert definitions. `TEST_RESTORE_DRILL=isolated`
on the existing `pnpm test:auth-http:local` harness invokes the database-owned logical
backup/restore rehearsal, using only its disposable services. It never restores or
redirects a live service. See the [restore runbook](../../docs/operations/runbooks/restore.md).

Phase 17B adds `TEST_RELEASE_BROWSER=isolated` to the same disposable HTTP
integration harness. It runs real-service Chromium MVP/failure paths after
database/API/Worker suites without adding a script or accepting live endpoints.
See [release suites](../../docs/testing/release-suites.md) for commands,
prerequisites, privacy boundaries and the retained concurrency/fault matrix.

Phase 18A adds the standalone `infra/ci` tool provisioning, workflow policy,
sequential verification and content-free evidence entry points. The
[CI guide](../../docs/operations/ci.md) documents actual gates, clean-checkout
requirements and protected-release settings. No root script, production
credential or deployment command is added. Phase 17C stays Pending and required
on production-like staging before final release readiness.

Phase 18B1 adds `infra/release/build.mjs`, `scan.mjs` and `test-local.mjs` for
portable local application image candidates. The existing read-only CI job runs
those real gates; no image is uploaded/published and release approval stays false.
See [packaging operations](../../docs/operations/packaging.md). Provider-specific
staging, access, backup/PITR and final SLO decisions remain deferred/open.

Phase 18B2 adds `infra/release/prepare.mjs` and `test-definition-local.mjs`, plus an
explicit `--rollback-to` disposable mode in the existing image smoke entry point.
See [deployment preparation](../../docs/operations/deployment.md) and its separate
migration/rollback gates. Preparation validates only; it does not activate staging
or run against existing data services.
