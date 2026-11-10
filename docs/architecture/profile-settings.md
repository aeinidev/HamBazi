# Profile and settings operations

The requested [Profile Hub](../design/profile-hub.md) adds optional username and
avatar fields under [ADR-080](../adr/080-profile-hub.md). Stable `publicHandle`
and settings v1 retain their original meaning. `GET /v1/me` may now include nullable
`username`/`avatar`; `PATCH /v1/me` accepts those optional fields. The separate
authenticated username-availability route is advisory and uses the read quota.
Username uniqueness is enforced in the save transaction and by a database index.
The bounded JPEG avatar is current profile data; source uploads are not persisted.
Only profile PATCH accepts up to 256 KiB; other HTTP body limits remain unchanged.
Apply migration `202611090001_profile_hub` before API/web rollout. Keep additive
columns and the existing receipt cleanup on rollback. The sections below describe
the original Phase 7A behavior; ADR-080 documents its additive extension.

Phase 7A implements [ADR-017](../adr/017-profile-settings.md). Users owns profile
data, preferences, revisions and retry receipts. HTTP composition adapts Auth's
session port into a verified user identity; Users has no Auth dependency.

## API

`GET /v1/me` requires a current bearer session and ACTIVE account. It returns
schemaVersion, userId, displayName, publicHandle, version and settings. No Telegram
ID, status, timestamps, session or receipt metadata is projected. Missing settings
read as locale `auto`, theme `system`, without creating rows. Unknown persisted
settings/schema versions fail safely rather than being silently discarded.

For the entry slice in [ADR-062](../adr/062-chosen-entry-name-and-telegram-photo.md),
Bot and direct Mini App registration choose `displayName` through the same Users
completion port. The profile read and existing public-name player-view projection
read that saved value. Telegram photo is session-scoped presentation data from the
additive registered-session-photo route, not a `GET /v1/me` field.

`PATCH /v1/me` requires schemaVersion 1, UUID commandId, expectedVersion and a
nonempty patch containing displayName and/or nonempty settings. Allowed locales
are auto/fa/en and themes system/light/dark; omitted keys retain current values.
ADR-015 validates/normalizes display names; names remain plain text for escaped
rendering. IDs, public handles, status and Telegram mapping cannot be edited.
Preferences are stored now; frontend translation/theme rendering is a later phase.

The success body contains schemaVersion, commandId and appliedVersion. Fetch GET
for the current profile. Every accepted new command increments the shared revision,
including no-op values. Old revisions and mismatched command reuse return 409
PROFILE_CONFLICT. Reload and issue a new command after conflict; never blindly
reuse a command ID with altered intent. Matching normalized retries recover the
same acknowledgement for seven days, even after later successful edits. Once a
receipt expires, old acknowledgements cannot be recovered; a stale expectedVersion
still prevents replayed effects. Invalid/empty input returns 400 without mutation.

The Users repository uses short Serializable transactions with at most five
attempts on serialization/unique conflicts. Name, settings, revision and receipt
commit atomically. No network work occurs in transactions. Reads use a consistent
transaction snapshot. Receipt digests are personal metadata, never log fields;
they are not a historical name/settings store. Retention is exactly 168 hours.

## Rate-limit availability and telemetry

Supply explicit API environment settings:

| Setting             | Recommended | Bounds                        |
| ------------------- | ----------- | ----------------------------- |
| PROFILE_READ_LIMIT  | 60          | 1–600 per user per 60 seconds |
| PROFILE_WRITE_LIMIT | 10          | 1–60 per user per 60 seconds  |

The two Redis windows are atomic, separate and shared across API replicas under
the configured Auth issuer namespace. Retries/invalid authenticated patch attempts
count. Quota exhaustion returns 429/Retry-After for both methods.

If Redis is unavailable or its result is invalid, GET **fails open only for the
rate check**: session authentication, account eligibility and PostgreSQL access
remain mandatory. PATCH returns 503 without invoking mutation. GET therefore
remains usable with durable sessions during a Redis outage; a DB/session failure
does not become a successful profile response.

Safe Pino warnings use events `profile.rate_read_fail_open` and
`profile.rate_write_fail_closed`, with requestId and fixed errorCode only.
`createSafeLogger().profileMetrics()` exposes process-local counters
`profile_rate_read_fail_open_total` and `profile_rate_write_fail_closed_total`.
They reset on restart. External log-based alerts can count these events now;
central metrics export/alert infrastructure remains the observability phase.
Do not add names, settings, request bodies, tokens or Redis errors to telemetry.

## Rollout, cleanup and rollback

Deploy the additive profile migration and permissions before API/Worker code.
Existing user rows receive profile_version 0; handles, names and settings are not
backfilled/replaced. API requires the two new explicit budgets. No deployment or
live database mutation is performed by implementation tests.

Worker also schedules `profile-receipt-cleanup-v1` with payload
`{schemaVersion: 1, limit}`. It reuses the existing explicit BOT_CLEANUP interval,
batch-size, attempt and backoff settings and WORKER_QUEUE_NAMESPACE, but has a
separate queue/scheduler from onboarding. Both v1 handlers remain supported.
Each batch selects at most 500 expired receipt IDs and rechecks expiry on deletion.
Worker can select only id/expires_at and delete receipts; it cannot read profile,
settings or digests or mutate users. Queue retries/concurrent cleanup are safe.
Expiry is enforced by API even if physical cleanup is delayed by Redis loss.

After Redis loss, restart Worker to recreate its scheduler. Monitor queue failure
events/backlog; restore Worker access and drain bounded batches. API startup probes
Redis best-effort; connected clients retry transport with bounded command waits.
During rollback keep additive columns/tables/grants and preserve pending jobs.
An older Worker does not clean the new queue, so restore the compatible Worker to
resume physical deletion. Do not drop receipts to resolve edit conflicts.

## Validation

`pnpm check` includes profile schemas/compatibility, application and HTTP tests.
`pnpm test:auth-http:local` covers isolated PostgreSQL/Redis races, rollback,
receipt expiry/permissions, live TCP composition, cleanup and restart persistence.
Use the documented isolated PostgreSQL binary settings; never point the harness
at existing application data. Live Telegram E2E remains owner-deferred until a
public HTTPS environment is available; it is not a passed test or a Phase 7A gate.
