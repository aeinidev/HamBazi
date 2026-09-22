# ADR-017 — Profile preferences and revision-guarded edits

- **Status:** Accepted
- **Owner:** HamBazi product owner (approval), HamBazi engineering (implementation)
- **Date:** 2026-09-22

## Context

Phase 7A implements architecture sections 6.1, 14 and 15. The owner approved
the proposed settings, revision, seven-day retry and rate-limit profile with one
adjustment: Redis failure permits authenticated GET /v1/me with safe telemetry,
but denies PATCH /v1/me. ADR-015 name and immutable-handle rules remain unchanged.

## Decision

Users owns profile/preferences and mutation receipts. Auth supplies authenticated
session identity through composition; Users never imports Auth. Only ACTIVE users
can read/edit. Responses omit Telegram identity, status and persistence fields.
Preferences v1 are locale auto/fa/en (default auto) and theme system/light/dark
(default system). Missing rows read as defaults without persistence. Unknown
fields and empty patches are rejected; partial preferences merge. UI remains later.

PATCH requires schemaVersion 1, UUID commandId and expectedVersion. A shared
monotonic profile revision covers name and preferences. A transaction atomically
checks ACTIVE status and revision, changes fields, increments revision even for
same-value intents, and inserts a receipt. Distinct competing edits cannot both
succeed. Handles, IDs and account status are never editable. Reusing an unexpired
command ID with different normalized input returns PROFILE_CONFLICT (409).

Receipts retain per-user command ID, normalized request digest, applied revision
and timestamps for 168 hours. No historical name/settings payload is retained.
The digest is personal metadata, not anonymous data, and is never telemetry.
Matching committed retries return the original minimal command/revision ack,
not historical profile text; GET returns current profile. Receipt expiry removes
the old ack guarantee; expectedVersion still prevents reapplication of an old
successful request. Every retry authenticates and checks current eligibility.
Bounded Worker cleanup removes expired receipts only, using restricted grants.

Explicit profile read/write rate limits use separate distributed per-user
60-second windows; recommended values 60/10, maxima 600/60. Retries count.
Exhaustion returns 429 and Retry-After for either method. Redis outage permits
GET only after normal authentication/authorization, recording an allowlisted
warning and a process-local counter; PATCH returns 503. This does not bypass
database/session failures. No extra rename cooldown or launch-capacity claim.

## Alternatives

- Last-write-wins: simpler, but loses concurrent edits; rejected.
- Store old profile responses: unnecessary historical personal data; use minimal ack.
- Fail closed on reads: rejected by the owner in favor of read availability.
- More preferences: defer audio/notifications/privacy until owning features exist.

## Consequences

Clients must reload after conflict and fetch current profile after acknowledgements.
Additive schema/grants and cleanup rollout precede API deployment. Read fail-open
weakens abuse protection during Redis outages; monitor the explicit counter/log
and retain ingress resource controls. No public metrics/admin endpoint is added.
The process-local metric can be scraped through future observability composition;
structured warning events already support external log-based metrics/alerts.
No game catalog, UI, session policy or live deployment is included.
