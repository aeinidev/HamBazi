# Read-only game catalog operations

Policy: [ADR-018](../adr/018-read-only-game-catalog.md).

## Runtime and rollout

Set API CATALOG_READ_LIMIT explicitly (recommended 60; integer 1–600 per user per
60 seconds, shared across list/detail). Existing API DB/Redis credentials and
Auth issuer namespace are reused. No new grant or credential is required.

Apply the reviewed migration before the new API. It seeds only absent data;
conflicts never overwrite existing rows. There are no runtime writes or automatic
repairs. Investigate incompatible existing configuration through the approved
change process. Rollback can leave the additive disabled metadata row in place;
no destructive down migration is needed. Do not activate games during rollout.

## Reads and failures

GET `/v1/games` returns `{schemaVersion:1,games:[...]}`; GET `/v1/games/coup`
returns `{schemaVersion:1,game:...}`. Both require a valid session and ACTIVE user.
Disabled/maintenance entries are visible, but playable and all capability flags
are false, readiness NOT_IMPLEMENTED, descriptor null. Arbitrary config is never
returned. Unknown slug: 404; missing baseline, invalid configuration or database
failure: sanitized 503. No stale cache fallback.

Quota exhaustion: 429/Retry-After. Redis outage permits reads only after normal
authentication. Warning `catalog.rate_read_fail_open` contains requestId/errorCode
only; `catalog_rate_read_fail_open_total` is a process-local safe-logger counter.
Central metrics export/alerts remain the observability phase. Never log tokens,
raw config or dependency errors.

## Maintenance and activation gate

This phase projects maintenance state but cannot operate a live kill switch,
change configuration or terminate matches. API/Worker writes remain denied.
Do not grant writes or bypass the operator path using ad-hoc SQL. Phase 7C must
deliver approved admin auth, RBAC, MFA, private access, append-only audit and
versioned/idempotent configuration changes before activation. Future admission
must recheck Games server-side. Active-match termination/version semantics belong
to the lifecycle implementation, not a catalog status flip.

## Verification

Unit/HTTP tests cover schemas, statuses, readiness, authorization, limiter failure,
exhaustion, write-route absence and contract compatibility. Isolated PostgreSQL/
Redis tests cover seed preservation, grants, repository failure/projection,
restart persistence, multi-client quota races and authenticated runtime TCP reads.
These do not claim production deployment, playable gameplay or operator readiness.

## Phase 14A mode discovery

[ADR-028](../adr/028-catalog-matchmaking-modes.md) adds optional `matchmakingModes`
to list/detail responses. Current registry output is
`[{"id":"standard","title":"Standard"}]`. IDs are extensible slugs; browser code
selects and sends an ID from this response, never a Coup-specific constant.
Absent modes on older servers disable mode selection. Metadata is independent
of effective availability: all production capabilities remain false and
`descriptor` remains null. No row, migration, grant or operator-control change.
The original baseline and the new modes baseline are both checked.
