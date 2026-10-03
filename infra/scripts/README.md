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
