# Operational scripts

This directory owns development and operational scripts for declared repository
workflows. `create-local-env.mjs` implements `pnpm infra:env`: generate distinct
local credentials in a private, ignored `.env` without overwriting existing work.
See the [local development runbook](../../docs/architecture/local-development.md).
Do not place business rules or committed credentials here.

See [workspace ownership](../../docs/architecture/workspaces.md) and the
[implementation plan](../../docs/implementation-plan.md).
