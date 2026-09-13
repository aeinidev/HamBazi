# Local configuration and data services

This is a development-only PostgreSQL/Redis topology, not a deployment manifest.
See [ADR-010](../adr/010-configuration-and-local-services.md). Application startup,
Prisma schemas/migrations and database integration tests are documented in
the [Phase 4B database foundation](database-foundation.md).

## Prerequisites and commands

Use the repository's pinned Node/pnpm toolchain and install dependencies with
`pnpm install --frozen-lockfile`. Install Docker Engine and a compatible Docker
Compose plugin through the platform's approved setup process before service use.
Run the declared scripts from the repository root:

1. `pnpm infra:env` creates an ignored, mode-0600 `.env` with independent random
   passwords and matching URLs. Existing files, including symlinks, are refused.
   `.env.example` documents the fields; copying its placeholders is not setup.
2. `pnpm infra:config` validates Compose quietly without printing interpolated
   credentials.
3. `pnpm infra:up` starts both services and waits up to 90 seconds for health.
4. `pnpm infra:status` shows container status and health.
5. `pnpm infra:down` stops/removes containers and the network, preserving the
   PostgreSQL named volume. There is deliberately no volume-wipe script.

Only `127.0.0.1:5432` and `127.0.0.1:6379` are published by default. These are local
developer defaults, not production capacity or endpoint decisions. If ports are
occupied, edit the matching `POSTGRES_HOST_PORT`/`REDIS_HOST_PORT` and all affected
connection URLs together; no environment-variable interpolation occurs inside
the generated URL strings. These URLs are for host-run clients, not future app
containers. A Docker-enabled host must verify connectivity before database work.

## Configuration contract

`@hambazi/config` is a Node-only package. Call `parseRuntimeConfig(environment,
"api")` or `parseRuntimeConfig(environment, "worker")` before creating clients or
listeners. API requires `NODE_ENV`, `API_DATABASE_URL`, `API_REDIS_URL`, `API_PORT`,
and comma-separated `ALLOWED_ORIGINS`. Worker requires `NODE_ENV`,
`WORKER_DATABASE_URL`, and `WORKER_REDIS_URL`. Unknown fields are ignored, and the
returned configuration and origin list are frozen. API and Worker do not receive
the migration/bootstrap credentials through this parser.

URLs are `SecretValue` objects: call `reveal()` only at the consuming client
boundary. Catch `ConfigurationError` and handle its safe `code`/`fields`; never
log the original environment, exception cause from a client, or a revealed URL.
The future bootstrap owns fail-fast process behavior; current app entry points
still have no startup logic. Web must never import server config or embed these
variables in a client bundle. Bot configuration arrives with Telegram auth work.

## Permissions and persistence

PostgreSQL initializes `hambazi_api`, `hambazi_worker`, and `hambazi_migrator` only
on first startup against an empty volume. API/Worker cannot create schema objects;
the migrator can create in `public`, but cannot create databases or roles. Prisma
development migration commands may need a separately provisioned shadow database;
do not grant runtime users CREATEDB to make them work. Phase 4B owns that workflow
and per-table grants. Readiness currently uses `pg_isready`, which does not prove
application login or table permissions.

Redis disables its default user. API/Worker authenticate separately and may use
only `hambazi:*` keys and channels; future cache/queue clients must use that
namespace and integration-test their command requirements. Health uses a separate
PING-only user. ACL hashes live in private tmpfs files; health credentials are
passed through environment, not command-line arguments. Redis uses no persistent
volume and loses data on restart. Do not store authoritative records there.

Do not print `.env`, run verbose interpolated Compose config, paste inspection
output, or enable shell tracing around credentials. Local Docker administrators
can inspect container environments. Restrict workstation access; production
secret delivery remains a later deployment responsibility.

## Failure and recovery boundaries

- If Docker is missing/unavailable, definition and unit tests can still run with
  `pnpm test:infra` and `pnpm --filter @hambazi/config test`. They do not replace
  live service checks. No automated system Docker installation is provided.
- If startup times out, inspect status first. Share only sanitized diagnostics;
  never include URLs/passwords or unfiltered environment inspection.
- Changing `.env` does not rotate existing PostgreSQL roles. Preserve the volume
  and coordinate password rotation explicitly. Never delete it to repair a login
  error. Redis reloads ACL credentials from its environment on container recreate.
- An unavailable PostgreSQL database must block future durable operations. Redis
  outages may degrade coordination but must not erase committed database state.
- Before adopting this setup for Phase 4B, verify both healthy containers,
  authenticated role access, negative privilege/ACL checks, Redis restart loss,
  and PostgreSQL persistence across `infra:down`/`infra:up`. These checks have not
  been run against Docker because Docker is unavailable. Phase 4B additionally
  verifies the actual PostgreSQL role bootstrap, permissions, and restart data
  persistence in an isolated native PostgreSQL cluster; that does not verify
  Compose networking, named-volume mounts, or Redis behavior.

Production restore/PITR, RPO/retention, hosting/region, capacity, and final SLOs
remain unresolved architectural decisions. This local runbook does not settle
them or authorize deployment.
