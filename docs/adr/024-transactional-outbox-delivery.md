# ADR-024 — Leased outbox delivery and result projection inputs

- Status: Accepted for application implementation under Phase 11B authorization
- Owner: HamBazi implementation maintainer; project owner retains deployment decisions
- Date: 2026-09-29
- Supersedes: none; extends ADR-021 and ADR-023

## Context

The architecture requires atomic outbox insertion, post-commit at-least-once
publication, bounded backoff, idempotent consumers and correlation propagation.
Phase 11A provides the atomic writer. A crashed publisher may have published
without marking its row, and Redis is ephemeral; queue job identity alone cannot
prove that a logical consumer effect has already committed.

## Decision

Matches owns the outbox application/repository port; the Worker owns polling and
BullMQ publication. Worker uses the explicit API Matches package export and never
queries tables itself. The database outbox scope has a fixed parameterized
`FOR UPDATE SKIP LOCKED` batch selector, available only in transactions. Claims
increment `attempts` as a monotonic fence and set additive nullable `claimed_until`.
The transaction commits before returning any event to the publisher. Delivery
updates require the original attempt and a live lease. Failure releases the claim,
sets bounded exponential backoff, and becomes FAILED at the configured attempt
limit. Expired final attempts become FAILED on the next scan. Unknown schemas
are quarantined without publishing their raw payloads.

Only Worker gains UPDATE on the new delivery column. No payload or identity grant
is widened. Prior API inserts and existing rows remain compatible. No claim owns
a database lock during Redis/network I/O. All timers, batch bounds and retry values
are explicit Worker configuration; the feature is disabled by omission or an
explicit false flag. No production values are selected.

Retain `matchmaking.found` v1 and `MATCH_CHANGED_V1`. Introduce a separate additive
`MATCH_FINISHED_V1` containing standard result, game/version pins, counters and
finish time. It is inserted with the finishing snapshot, audit events, receipt
and change intent. Reject malformed/non-roster results before committing. No
raw engine event/state, deck, command, credential or independent RNG material
enters dispatch queues. Result projection tables and leaderboard behavior remain
Phase 15B; this event provides their durable input.

Player intents remain unchanged. Trusted composition may supply separately
validated requestId/traceparent to the Match port; first accepted context is stored
on its outbox rows, forwarded in the event/job envelope and passed to the consumer
application callback. Retry context never changes committed events. Existing
matchmaking correlation fields remain compatible. Logging uses only event name,
Match ID, stateVersion and requestId; traceparent travels as context, not a payload
log. Actual HTTP/Socket Match adapters and telemetry exporters remain later phases.

Publish to distinct versioned matchmaking-found, match-changed and match-finished
BullMQ queues with eventId as jobId. Mark PUBLISHED only after enqueue acceptance.
A publish timeout or crash can redeliver; a failed database mark leaves its lease
for recovery. Polls do not overlap in one process, shutdown stops claims and drains
all in-flight attempts before closing the publisher/database. Consumer adapter
failures use fixed safe errors; failed jobs are retained, successful jobs can be
removed because durable consumer receipts supply deduplication.

Provide `forModule("leaderboard").consumeOnce(consumer, eventId, effect)` as the
consumer-owned persistence pattern using the existing consumer_receipts table.
Insert-if-absent and the owned database effect occur in one short transaction.
Concurrent copies wait on the unique key; rollback removes both receipt/effect.
The callback performs only owned database work, never external effects. Runtime
scope rejects other owners; no shared business rule or statistics consumer is
implemented here. Future other owners require an explicit ownership extension.

## Alternatives

Holding SQL locks across publishing violates the transaction boundary. Marking
before enqueue loses events on failure. An expiry timestamp without an attempt
fence allows an old publisher to acknowledge a newer claim. Queue job IDs alone
lose their deduplication history when jobs or Redis data disappear. Recording a
consumer receipt in a separate transaction can lose an effect after a crash.

## Consequences

PUBLISHED means broker acceptance, not consumer completion. PostgreSQL retains
outbox events and Match truth if Redis loses data. Trusted per-event redrive can
requeue FAILED or PUBLISHED records by the original ID, retaining the attempt
counter and granting one further attempt after exhaustion. It is not an exposed
admin route; future operator access requires the architecture's authorization and
audit controls. Redis-loss reconciliation must redrive affected retained events;
this is not an automatic detection or recovery service. Consumer-failed BullMQ
jobs require repair/retry in their owning consumer, not merely another enqueue
with an already-existing jobId. Completed consumers remain protected by receipts.

Do not enable production dispatch until the intended consumer versions and recovery
procedure are deployed. Phase 11B supplies no placeholder/no-op consumers. Queued
messages remain waiting until their actual owning phases are implemented. Delivery
may be duplicated or reordered; Match seq/resync and eventId consumer idempotency
remain authoritative. Retention/cleanup, activation, numeric production policy,
realtime, reconnect, result-table projection and launch readiness remain gated.
