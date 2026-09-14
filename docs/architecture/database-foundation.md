# Database foundation

See [ADR-011](../adr/011-prisma-database-foundation.md) for ownership, storage, and
compatibility decisions. This phase implements storage infrastructure, not domain
repositories, game transitions, API endpoints, or an outbox dispatcher.

## Ownership and application use

Only server-side composition roots and owning repository adapters may depend on
`@hambazi/database`. The public package exports `createDatabase`, safe errors,
options, and owner names; generated files are private. Create one instance per
process with that process's validated `databaseUrl` and explicit pool/timeout
settings. Connect before accepting work; stop admission and drain work before
disconnecting. There is no global singleton or connection on module import.

`forModule(owner).execute(callback)` supplies owned top-level Prisma delegates.
`transaction(callback)` supplies the same delegates inside one short PostgreSQL
transaction. Do not perform network calls, publish events, or throw business-rule
payloads in these callbacks. Errors are sanitized. Match-specific locking,
expected-version comparison, idempotent response selection, and bounded retries
remain Phase 11A, not claims made by this generic foundation.

| Owner       | Tables/delegates                                                                     |
| ----------- | ------------------------------------------------------------------------------------ |
| users       | users, user_settings                                                                 |
| games       | games                                                                                |
| rooms       | rooms, room_members                                                                  |
| matches     | matches, match_players, game_events, processed_commands, game_results, outbox_events |
| chat        | chat_messages                                                                        |
| leaderboard | user_game_stats, consumer_receipts                                                   |
| outbox      | outbox_events                                                                        |

Foreign keys do not grant permission to traverse another module's relations.
Request data through its application port instead. Repository adapters map all
Prisma records into module-owned domain/DTO types; never share generated models
through public application ports. Phase 5B's [boundary checks](boundaries.md)
enforce repository locations, literal owner selection, and explicit scalar query
shapes; they do not replace mapping review or integration tests. Bot, Gateway, frontend, shared contracts, and game engines
must not import this package.

## Schema and migration workflow

From the repository root, these declared commands need no database credentials:

- `pnpm --filter @hambazi/database db:format`
- `pnpm --filter @hambazi/database db:validate`
- `pnpm --filter @hambazi/database db:generate`
- `pnpm --filter @hambazi/database typecheck`
- `pnpm --filter @hambazi/database test`
- `pnpm --filter @hambazi/database build`

Generated TypeScript lives in `src/generated/prisma`, is ignored by Git/lint/
formatting, and is compiled into `dist`. Build/typecheck regenerate it explicitly.

Provision the database and ADR-010 roles before deployment. Supply
`MIGRATION_DATABASE_URL` through a secure process environment, then run
`pnpm --filter @hambazi/database db:migrate`. No `.env` is loaded implicitly and no
runtime or bootstrap credential is substituted. The runner applies Prisma
migrations, then the role grants from `prisma/permissions.sql`. A grants failure
fails the command even if the schema already committed; retry after correcting
provisioning. `db:migrate` never resets a database or starts services.

`db:diff` is a **read-only baseline comparison from an empty schema**. Its output
does not include the hand-authored PostgreSQL constraints/triggers or grants and
must never overwrite a reviewed migration. Add future migrations rather than
editing an applied one. Review expand/backfill/contract compatibility, preserve
custom invariants, and retain one release overlap. There is no `db push`, reset,
automatic destructive rollback, or Prisma Studio workflow in the repository.
Migration development requiring a shadow database needs an explicit isolated
database; do not add CREATEDB to API/Worker/migrator as a shortcut.

The current baseline preserves match engine/schema/ruleset pins and append-only
history. It does not enforce every business invariant: host transfer, room
capacity under contention, turn authority, complete event sequences, and atomic
command publication need their owning use cases and later tests. JSONB is storage,
not validation of an engine's versioned payload. User status, connection-state
vocabulary, retention, session policy, and product defaults are not frozen here.

## Integration tests

Use `pnpm --filter @hambazi/database test:local` with `TEST_POSTGRES_BIN` pointing
to an existing directory containing `initdb`, `pg_ctl`, and `psql`. For extracted
distribution packages, supply `TEST_POSTGRES_SHARE` if initdb cannot locate its
share directory, and the platform loader's library path if needed. The script
does not download/install binaries or change system services. Run as non-root.

The harness creates a private temporary cluster on a dynamically selected
loopback port, with random SCRAM credentials. It runs the actual local role
bootstrap, applies the migration twice, checks Prisma-visible schema drift,
executes integration tests, verifies schema and committed data after restart,
and stops before deleting only that cluster's generated
temporary directory. If shutdown fails, data is preserved and the command fails.
It never reads or overwrites the developer's root `.env` or application database.

`test:integration` supports an explicitly provisioned **empty isolated** database
through `TEST_DATABASE_URL` (fixture administrator), `API_DATABASE_URL`, and
`WORKER_DATABASE_URL`, with `TEST_DATABASE_CONFIRM=isolated-hambazi-test`. Migrate
and grant permissions first. Missing confirmation or a populated target fails
before fixture writes. Never point this suite at a development database containing
user work, staging, or production. The suite intentionally exercises rejected
DDL/history mutations and creates synthetic fixtures; it does not clean up a
manually provided database.

Root `pnpm check` includes database unit tests, not environment-dependent
integration tests. Run the database integration gate separately for schema,
transaction, client, or permission changes. Integration evidence covers real
PostgreSQL, not Docker networking or Redis. Those Phase 4A checks remain tracked.

## Security and operations

- Raw auth secrets and unnecessary RNG material have no schema columns. Snapshot
  and event payloads may contain architecture-required hidden state, accessible
  only through the owning Match service; never log or expose them directly.
- Chat is stored only for the future membership-protected feature. No retention
  job, moderation policy, or public access is created here.
- Error codes and migration-stage names are safe diagnostics. Do not print raw
  Prisma errors, SQL parameters, connection URLs, or environment files.
- Role grants are explicit and must be reviewed with each feature. Runtime roles
  cannot create tables or mutate event/command history; database administrators
  can still change schema, so operations need their own authorization and audit.
- Production TLS trust, hosting, backups/PITR, retention, deployment rollback,
  and capacity remain later gates. Local database restart is not a backup restore.
