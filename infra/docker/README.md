# Docker infrastructure

This directory owns the local PostgreSQL/Redis Compose definition and its role/ACL
bootstrap scripts. Use the declared root `infra:*` commands and follow the
[local development runbook](../../docs/architecture/local-development.md).
Ports bind only to loopback; normal shutdown preserves PostgreSQL data. Live
validation requires Docker. `apps/` now owns Phase 18B1's four portable non-root
application image targets and reviewed base/archive pins. See
[packaging operations](../../docs/operations/packaging.md) for build, scan and
disposable runtime entry points. These are local candidates; provider-specific
deployment and staging activation remain deferred. `release/` owns the separate
application-only portable Compose template and unresolved input schema; it neither
creates data services/networks nor publishes ports. See
[deployment preparation](../../docs/operations/deployment.md) for validation and
owned definition/replacement/rollback rehearsals.

Build the locked PostgreSQL derivative before startup and follow the
[local image transition runbook](../../docs/security/local-image-transition.md).
Legacy populated volumes are refused; no automatic data migration or deletion
occurs. Full Compose host connectivity remains unverified on the tested Docker
internal network; disposable image integration checks use a separate bridge.

See [workspace ownership](../../docs/architecture/workspaces.md) and the
[implementation plan](../../docs/implementation-plan.md).
