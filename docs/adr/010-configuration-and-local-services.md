# ADR-010 — Validated configuration and isolated local services

- **Status:** Accepted for local development and configuration foundation
- **Owner:** HamBazi engineering
- **Date:** 2026-09-13

## Context

Architecture sections 3, 16, 19, 21, and 23 require runtime validation, private data
services, distinct least-privilege API/Worker credentials, reproducible local
infrastructure, and no secret leakage. No validation library or service runtime
existed before Phase 4A. Production hosting, capacity, and backup decisions remain
open and must not be inferred from a development topology.

## Decision

Use Zod 4.6.2 as the single runtime schema library, initially inside
`@hambazi/config`. Later transport schemas belong to `@hambazi/validation`; do not
add a competing validator. Version 4.6.2 is pinned because newer 4.6.4 caused pnpm
to add a release-age exception during installation. Remove that generated
exception and retain the existing supply-chain gate. Zod 4 supports the pinned
TypeScript 6 compiler and future JSON Schema generation needs.

Expose `parseRuntimeConfig`, `ConfigurationError`, `SecretValue`, and their types
only through the config package's public root. The caller passes an environment
dictionary and API/Worker role: imports do not read environment/files, log, or
connect to services. Only the selected role's settings are returned. Invalid
configuration produces a stable local `INVALID_CONFIGURATION` code and field
names, never raw Zod issues or rejected values. This is not a public REST error
contract. Credentials use explicit `reveal()` and redact normal string, JSON, and
Node inspection output. This is defense in depth, not permission to log config or
to expose revealed strings.

Require explicit environment, authenticated PostgreSQL/Redis URLs, and (for API)
port and a finite origin allowlist. Production inputs require HTTPS origins,
`rediss:` and a single PostgreSQL `sslmode` of `require`, `verify-ca`, or
`verify-full`. These are syntax-level safeguards; future client adapters must
honor TLS settings and validate server trust. This does not approve a production
deployment, certificate policy, or session strategy. Bot/Web settings arrive with
their implementations; no Telegram credentials are needed for this phase.

Use Docker Compose for local PostgreSQL 18.6 Bookworm and Redis 8.10.1 Trixie,
with version tags and multi-platform manifest digests pinned in the definition.
Publish only on IPv4 loopback and use an internal bridge network. PostgreSQL uses
a named volume at the PostgreSQL 18 image's `/var/lib/postgresql` mount point;
normal shutdown never removes it. Redis uses tmpfs, disables persistence, and uses
`noeviction`. Durable reconstruction of jobs/presence is a future application
responsibility; local Redis loss must never stand in for durable match storage.

Generate independent 256-bit local passwords in a mode-0600, ignored `.env`,
refusing overwrite or symlink traversal. Local Compose environment variables are
visible to the local Docker administrator; this is not production secret storage.
Keep a separate bootstrap PostgreSQL administrator and migration role. API and
Worker initially have CONNECT/USAGE only; each future migration must grant only
the table/sequence operations its role needs. There is no blanket default table
grant. Redis disables the default user, uses separate API/Worker ACL users scoped
to `hambazi:*` keys/channels, denies dangerous commands, and gives health checks
PING-only access. ACL command grants must be tested against actual Redis/BullMQ
clients when introduced, not assumed compatible now.

## Alternatives

- JSON Schema/Ajv: valid architecturally, but adds separate schema/type authoring
  machinery for this small TypeScript-first foundation.
- Shared administrator credentials: simpler locally but hides privilege errors
  and violates API/Worker separation.
- Redis persistence: unnecessary for the disposable local coordination layer;
  production queue recovery/durability remains a separate operating decision.
- Production manifests now: would silently choose unresolved hosting and storage
  policies; deferred to the deployment phase.

## Consequences

Docker Engine and Compose are required to start services. Static definition and
shell tests cannot prove authentication, ACL enforcement, volume recovery, or
service health; live checks remain required on a Docker-enabled machine before
Phase 4B integration work. Role initialization runs only for an empty PostgreSQL
volume. Credential rotation of an existing database is an explicit maintenance
operation, not an `.env` regeneration or volume deletion.

## References

- [Zod documentation](https://zod.dev/)
- [PostgreSQL official image](https://hub.docker.com/_/postgres)
- [Redis official image](https://hub.docker.com/_/redis)
- [Redis ACL documentation](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/)
- [psql environment variables and quoting](https://www.postgresql.org/docs/current/app-psql.html)
