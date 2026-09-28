# Match outbox and result inputs — Phase 11B

[ADR-024](../adr/024-transactional-outbox-delivery.md) describes guarantees and limits.
The configured Worker can now poll and publish committed domain intents through
`createMatchOutboxPort`; no Socket, gameplay job or statistics consumer is started.

## Contracts and ownership

`@hambazi/api/matches` is an explicit application export. The repository stays
inside Matches and selects the narrower `outbox` scope. Worker receives validated
allowlisted domain DTOs, never Match snapshots, Prisma models or raw errors.
The database helper locks a bounded due batch with `FOR UPDATE SKIP LOCKED`.
`attempts` fences claims; nullable `claimed_until` holds the lease deadline and
`next_attempt_at` holds retry scheduling. Updating delivery fields cannot mutate
payload/identity. No event can be returned for publication before claim commit.

| Stored type / version   | Queue                  | Payload                                                                          |
| ----------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `matchmaking.found` / 1 | `matchmaking-found-v1` | Existing Match/reservation reference                                             |
| `MATCH_CHANGED_V1` / 1  | `match-changed-v1`     | Match ID, stateVersion, lastEventSeq, status                                     |
| `MATCH_FINISHED_V1` / 1 | `match-finished-v1`    | Match/game ID, engine/state/ruleset pins, finish time, counters, standard result |

Each queue job carries `{schemaVersion:1,eventId,aggregateId,type,occurredAt,
correlation,payload}`. jobId is eventId. Correlation permits only UUID requestId and
validated W3C version-00 traceparent; neither raw headers nor arbitrary fields are
forwarded. The Match application accepts this context separately from player
intents, then stores it on every emitted outbox row. Consumer callbacks receive
it unchanged. Existing REST schemas and Phase 9 event names remain unchanged.

Finish payloads contain placements, winner, reason and numeric metrics only, with
strict shapes and roster validation. One finish input is written inside the same
transaction that enters FINISHED. Failure of either outbox insert rolls back the
entire command; retries cannot emit another finish input. Historical 11A FINISHED
records have change intents and durable engine state but no finish event: this
release does not fabricate historical results or silently backfill them. Any such
backfill must use the pinned engine and an explicitly authorized migration.

## Consumer pattern

`domainEventProcessor(type, consume)` validates the job version, route and aggregate
binding, calls the owning application port and accepts only APPLIED/DUPLICATE.
It replaces unexpected exceptions with a fixed error before BullMQ stores them.
Register real consumers only when their owning use cases exist; there are no dummy
handlers that acknowledge and discard work.

The future statistics repository can use
`database.forModule("leaderboard").consumeOnce(consumer, eventId, async db => …)`.
The existing unique receipt key and owned effect commit together; a concurrent
second delivery returns DUPLICATE. A thrown effect rolls both writes back. Keep a
stable consumer identity for the same logical effect across compatible deployments;
changing it intentionally starts a distinct deduplication namespace. Never put
network side effects in this callback. Other owners are denied pending an explicit
ownership extension. Phase 15B still owns actual results/aggregates and rebuilds.

## Opt-in configuration

Keep MATCH_OUTBOX_ENABLED absent/false until consumers and operations are ready.
An explicit false disables polling even if old policy values remain in the environment.
Enabling requires all fields below, plus the existing Worker DB/Redis/namespace
and cleanup configuration. The bounds are resource guards, not production defaults.

| Setting                         | Allowed range                               |
| ------------------------------- | ------------------------------------------- |
| MATCH_OUTBOX_INTERVAL_MS        | 100–60,000                                  |
| MATCH_OUTBOX_BATCH_SIZE         | 1–100                                       |
| MATCH_OUTBOX_LEASE_MS           | 1,000–300,000; greater than publish timeout |
| MATCH_OUTBOX_ATTEMPTS           | 1–20                                        |
| MATCH_OUTBOX_BACKOFF_MS         | 100–60,000                                  |
| MATCH_OUTBOX_MAX_BACKOFF_MS     | base backoff through 3,600,000              |
| MATCH_OUTBOX_PUBLISH_TIMEOUT_MS | 100–30,000                                  |

The same attempts/base-backoff policy is attached to queued consumer jobs. Successful
consumer jobs are removed; failed jobs remain visible. Existing Redis Worker ACLs
suffice; no credentials or dangerous command permissions are added. Polling uses
bounded parallel publication of one batch with no overlapping tick. Shutdown drains
all attempts before closing resources. A deadline can leave a late enqueue, so
receipts—not timeout cancellation—provide logical side-effect protection.

## Failures and recovery

Publication failure schedules bounded exponential backoff. Exhausted, malformed or
unsupported records remain FAILED in PostgreSQL. An expired claim is reclaimed with
a higher attempt; stale/released acknowledgements cannot mark it. A last-attempt
crash becomes FAILED when scanned after expiry. Failed/uncertain mark after enqueue
is recovered through lease expiry and may duplicate publication.

`redrive(eventId)` is trusted recovery for a retained FAILED/PUBLISHED row. It keeps
payload, identity and the monotonically increasing attempt counter. After exhaustion
it gives one additional attempt; another failure returns to FAILED. Do not reset
counters or manufacture new IDs. Consumer-failed jobs already present under that
jobId require their own failed-job retry after correcting the cause.

Redis is ephemeral. After queue loss, reconcile the incident's retained published
outbox IDs and redrive those requiring delivery. Consumer receipts make replay safe
for transactional effects. This phase provides the per-event primitive, not an
automated incident detector/admin endpoint or a production recovery approval.
PUBLISHED is enqueue acceptance; it does not prove processing. Preserve database
records and failed jobs pending an approved retention policy.

## Rollout and rollback

Apply `202609290002_outbox_claims` and the updated column-scoped Worker grants using
the existing migration-owner workflow before enabling polling. Old rows have null
claims and old API insert shapes continue to work. The scoped database helper does
not expose arbitrary SQL. Roll back by disabling polling and draining the Worker;
retain the additive column, result event handler/version and retained queue data.
Do not roll back a producer to a consumer set that discards unknown jobs. No live
migration or enabled production dispatcher is part of local verification.

Events logged are worker.outbox_published/retry/failed/unavailable. Optional logged
fields are matchId, stateVersion and requestId only. Do not attach a job, payload,
claim, raw exception or traceparent to telemetry. Central metrics/trace exporters
remain Phase 16; failed records and retained failed jobs must be monitored by the
future operations integration.

## Verification

The isolated PostgreSQL/Redis suite covers atomic finish rollback/retry, persisted
correlation, invisible uncommitted rows, two-worker claims, expired/stale fences,
backoff/exhaustion/redrive, legacy schema dispatch, publish-before-mark recovery,
real BullMQ job identity/context, queue-loss replay, restricted grants and configured
Worker startup/drain. Database integration covers concurrent transactional consumer
effects and receipt rollback. This is local verification, not deployment, staging
E2E, load/soak or a production Redis-loss drill.
