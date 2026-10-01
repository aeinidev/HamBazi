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

| Owner       | Tables/delegates                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| auth        | sessions, bot_update_receipts, bot_onboarding_flows                                                                        |
| users       | users, user_settings, profile_mutation_receipts                                                                            |
| games       | games                                                                                                                      |
| rooms       | rooms, room_members, room_command_receipts                                                                                 |
| matches     | match_admissions, match_reservations, matches, match_players, game_events, processed_commands, game_results, outbox_events |
| chat        | chat_messages, chat_streams; insert-only outbox_events                                                                     |
| leaderboard | user_game_stats, consumer_receipts                                                                                         |
| outbox      | outbox_events                                                                                                              |

Phase 9A adds Matches-owned durable admission/reservation arbitration; see
[matchmaking admission](matchmaking.md). Queue ordering remains Redis scope.
The API has column-scoped metadata writes; Worker has no admission table grants.

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

### Phase 6A2 expansion

ADR-014 adds Auth-owned session metadata as a second additive migration. The
original foundation migration is unchanged. No credential/hash is persisted;
API gets read/insert and revocation-column update only, and Worker gets no session
access. Immutable metadata and one-way revocation are enforced by a trigger;
unique user/command IDs preserve issuance idempotency. Session policy is now
governed by ADR-014 rather than the historical open-decision note above.

Root `pnpm test:auth:local` runs the isolated database harness with `--api-auth`
after API/dependency builds. In that mode, it establishes the previous schema,
baselines its migration in the isolated database only, inserts a synthetic
old-release row, then runs the normal expansion deploy and verifies the row is
unchanged. It removes only that probe before ordinary fixtures. It runs foundation
and Auth/Users integration suites, then compares session metadata/revocation and
account identities, names, handles and statuses across a PostgreSQL restart
without printing their values. This is a test-only migration
rehearsal, not permission to baseline or reset a deployed database.

The API integration suite requires the harness's additional
`TEST_AUTH_DATABASE_READY=foundation-completed` marker and expected fixture count;
do not run it against a normal developer database. The standalone database
`test:local` still exercises clean initial deploy of both migrations.
Neither command installs services, reads the project's `.env`, or deploys to
staging/production. See [authentication boundary](telegram-authentication.md).

### Phase 6B1 account creation

[ADR-015](../adr/015-account-identity-policy.md) uses the existing Users table and
unique Telegram ID/public-handle/UUID constraints; no migration or grant change
is needed. Users' owned repository inserts with conflicts ignored and selects
the Telegram identity in the same short transaction. A missing identity after a
skipped insert means a handle/UUID collision, with at most five application-layer
attempts. Concurrent repeated creation never updates the winning row. The API
integration gate covers two-client creation races, forced handle/UUID collisions,
uniqueness, rollback, eligibility, handle stability and database unavailability.

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

## Bot onboarding metadata expansion (6B2B2)

Migration `202609210001_bot_onboarding` adds Auth-owned `bot_update_receipts` and
`bot_onboarding_flows`; prior foundation/session migrations are unchanged.
Receipts are unique per bot/update and flows per bot/Telegram sender. They store
only IDs, schema/optimistic versions, processing/reply enums and timestamps.
No name draft, raw update, content JSON, credential or authentication hash is
stored. SQL checks fix retention to seven days and 15 minutes respectively;
triggers prevent identity/expiry rewrites and version regression. Receipt expiry
and flow expiry indexes support bounded maintenance selection.

API receives SELECT/INSERT/DELETE and column-specific UPDATE for workflow state;
it cannot rewrite receipt identities or expiry. B2 gave Worker no access; B3A
adds only SELECT on `id, expires_at` and DELETE for bounded cleanup via Auth's
public port. DELETE is table-wide; expiry/batch enforcement remains in Auth's
repository. Bot continues to have no DB credentials. Repository delegates and ESLint
ownership permit only Auth repositories to access the new models. No foreign key
to Users or persisted name payload creates cross-module ownership coupling.

Receipt locking and flow compare-and-swap changes commit together in short Auth
transactions. Users account creation happens outside them after durable admission
and is independently idempotent. Cleanup selects at most the requested limit
(1–500) per table and rechecks expiry at deletion. B3A supplies opt-in internal
HTTPS admission and configured Worker scheduling; neither runs merely by
applying grants. See [internal transport operations](bot-internal-transport.md)
and [ADR-016](../adr/016-onboarding-transports.md).

## Match writer extension (Phase 11A)

Matches alone has a fixed `lockMatch(uuid)` helper on its scoped client. It is
valid only inside a transaction and executes a parameterized row lock; there is
still no arbitrary SQL escape hatch. Other owners cannot obtain this helper.
The additive processing migration preserves old inserts/history while introducing
nullable readiness/digest metadata and trusted lifecycle receipt actors.
See [Match processing](match-processing.md) and [ADR-023](../adr/023-match-atomic-processing.md)
for transaction ordering, compatibility and replay requirements. Future seat/state
writers must serialize through the same Match lock.

## Outbox delivery extension (Phase 11B)

Migration `202609290002_outbox_claims` adds nullable `claimed_until` without
rewriting existing events. Worker receives only the additional delivery-column
UPDATE grant. The outbox scope exposes fixed transaction-only
`lockDueOutbox(at, limit)` SQL with SKIP LOCKED; no general SQL surface is added.
Matches owns the repository and Worker uses its public application port.

`forModule("leaderboard").consumeOnce(consumer, eventId, operation)` inserts a
unique receipt and executes the consumer's owned database effects in one
transaction. Concurrent duplicates skip effects; failure rolls back both. Other
owners are rejected because they do not own consumer receipts. This is a reusable
persistence primitive, not a stats projection or permission to perform network
I/O inside the callback. The harness proves concurrent deduplication and rollback
and compares receipts across restart. See [outbox delivery](match-outbox.md) and
[ADR-024](../adr/024-transactional-outbox-delivery.md) for compatibility and recovery.

## Phase 15A Chat expansion

Migration `202610010001_chat` preserves previous Chat insert shapes while adding
nullable retry/sequence metadata, unique keys and an independent stream counter.
Chat gets message read/insert, stream read/insert/counter-update and insert-only
outbox access. Worker cannot read Chat content. The isolated suite preserves the
populated preceding schema and checks committed messages/streams across a real
PostgreSQL restart. See [Match chat](match-chat.md) for legacy-row visibility,
authorization, transaction boundaries and rollback.
