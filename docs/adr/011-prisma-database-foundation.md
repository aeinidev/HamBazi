# ADR-011 — Prisma foundation, durable invariants, and persistence clarification

- **Status:** Accepted for the Phase 4B foundation
- **Owner:** HamBazi engineering; persistence clarification explicitly approved by the project owner
- **Date:** 2026-09-14
- **Supersedes:** the blanket application-persistence prohibition in the former AGENTS.md section 9 only

## Context

Architecture sections 11.8, 13.1, and 14 require durable match snapshots/events and
PostgreSQL chat history. The previous guide accidentally included these payloads
in a blanket persistence prohibition. The owner explicitly instructed: “Proceed
with the correction and continue Phase 4B.” The guide now distinguishes authorized
restricted application storage from telemetry. Raw authentication secrets remain
non-persistent. This does not authorize unnecessary RNG/seed storage or resolve
session, chat retention/moderation, backup, or other open decisions.

The database package was an empty compilation scaffold. It needs a migration
baseline, generated-client isolation, short transaction capability, separate
runtime/migration roles, and real PostgreSQL verification before product modules.

## Decision

Use Prisma CLI/client/adapter-pg 7.10.0, pg 8.23.0, and the existing Node 24 /
TypeScript 6 toolchain. The CLI registry's `latest` points to 8.0.0-rc.14 at review;
do not select a prerelease. Generate ESM TypeScript with `prisma-client` into an
ignored directory inside `packages/database/src`; build/typecheck explicitly
generate it. Credentials are not required to generate or validate schemas.

Allow only Prisma's reviewed Node compatibility preinstall and engine-download
postinstall through pnpm's build-script allowlist. Keep release-age and peer
checks. Audit found vulnerable transitive CLI dependencies, so narrowly override
`@prisma/config>deepmerge-ts` to 8.0.2 and `prisma>mysql2` to 3.24.4. The deepmerge
major override needs the repository's config/generation/migration checks on every
Prisma upgrade; remove overrides once upstream adopts patched compatible
versions. MySQL is not a HamBazi storage backend. Prisma Studio is not a product
dependency or an approved administrative surface.

Use application-supplied UUIDs for internal user/room/match/event/action IDs,
PostgreSQL BIGINT for Telegram IDs, timestamptz timestamps, and JSONB for versioned
state/payloads. Do not seed product settings or a Coup ruleset here. Game IDs are
registry-owned strings. Storage status strings have CHECK constraints only where
the architecture defines the lifecycle; other domain vocabulary is deferred.
Stats include game/metric/period dimensions without fixing period calendars or
retention. No session/refresh table is introduced before OD-003 is resolved.

The initial migration creates the MVP tables plus consumer receipts, with foreign
keys, identity/seat/sequence/action uniqueness, positive schema counters, and
outbox retry indexes. A match may have no engine snapshot before activation.
ACTIVE/FINISHED require an object snapshot. Triggers prevent normal mutation or
truncation of event/processed-command history and prevent engine/schema/ruleset
pin changes, counter regression, or an unversioned snapshot update. The migration
is transactional and additive. The redundant generated `CREATE SCHEMA IF NOT
EXISTS public` is omitted: even for an existing schema PostgreSQL checks database
CREATE permission, which the migrator intentionally lacks. Schema provisioning
belongs to the bootstrap administrator. Future upcasters requiring persisted version
changes need a separately reviewed migration; silently changing active matches
is not supported.

`createDatabase` owns one client/pool per process, explicit pool/time limits,
connect/disconnect, and owner-selected infrastructure callbacks. Only top-level
delegates for that owner are supplied; no raw SQL or global client is exported.
Generated models are not exported as shared application contracts. These callbacks
are for module-owned repository adapters only: map records into owned domain/port
DTOs there, never return them through cross-module ports. Relation traversal into
another module is prohibited even if Prisma's generated relation types permit it.
This is not a security sandbox or the complete Phase 5B dependency fitness gate.
Future Match row-lock primitives belong inside its repository adapter, not in
generic application or frontend code.

Database errors expose only a small stable infrastructure code, without SQL,
Prisma metadata, rejected values, or original causes. No query logging is enabled.
Callbacks must contain database work only; handle business-rule outcomes outside
this boundary because thrown callback errors are deliberately sanitized. No
automatic transaction retry or game command processing is implemented here.

Apply migrations with the dedicated migration owner. A separate idempotent grants
file uses the local role names from ADR-010. API/Worker cannot perform DDL or read
migration bookkeeping. Worker cannot read user profile or chat tables. Both may
write match records only through owning use cases; history is insert/select only.
Worker may update outbox delivery columns, not payload. There are no blanket
future-table grants or runtime DELETE permissions on durable history. Production
role provisioning/mapping and destructive retention maintenance remain separate
reviewed operations.

## Alternatives

- Export the complete Prisma client/models globally: convenient but encourages
  cross-module queries and persistence types in application contracts.
- SQLite or an in-memory substitute for integration tests: cannot prove actual
  PostgreSQL locking, privileges, JSONB, and transactional migration behavior.
- Give the migrator CREATEDB or runtime users administrator rights: conceals
  privilege errors. Deploy uses an already-provisioned database; no shadow
  database or reset workflow is introduced.
- Implement Match processing/outbox dispatch now: exceeds the phase. This phase
  provides schema constraints and transaction tests, not a playable service.

## Consequences

The migration runner captures CLI diagnostics and returns only safe stage/error
codes. Operators must use a protected session for deeper diagnostics and must
never enable verbose Prisma logging with real secrets or payloads. Generated
client artifacts are rebuilt, not committed. Direct integration tests require an
explicit isolated empty database; the local harness creates its own cluster with
random credentials, uses the actual role bootstrap, deploys twice, tests, restarts,
then shuts down before removing only its generated temporary data.

Docker topology/Redis ACL checks remain separate from native PostgreSQL testing.
Neither local integration success nor this ADR is evidence of staging readiness,
production backup recovery, full module enforcement, or game replay correctness.

## References

- [Prisma client setup](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction)
- [Prisma configuration](https://www.prisma.io/docs/orm/reference/prisma-config-reference)
- [Deepmerge advisory and patched major](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)
