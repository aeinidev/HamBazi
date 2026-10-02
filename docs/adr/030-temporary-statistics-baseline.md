# ADR-030 — Durable results and temporary statistics baseline

- Status: Accepted; project owner explicitly approved the proposed Phase 15B baseline
- Owner: HamBazi engineering; project owner retains activation and final product-policy decisions
- Date: 2026-10-02
- Supersedes: none; extends ADR-011 and ADR-024

## Context

Phase 11B supplies immutable versioned finish inputs, not result-table projections.
Architecture sections 14 and 17 require durable Match results and rebuildable,
idempotent statistics. The owner approved the baseline recorded in the Phase 15B
implementation-plan assessment before these public behaviors were implemented.

## Decision

For Coup, credit one completed game to each roster account and one win to the
recorded winner, including after Bot takeover. TERMINATED Matches earn no credit.
Losses are completed games minus wins. Support all-time and Monday 00:00 UTC weeks
using recorded finish time. Seasonal calendars, ratings and retention/erasure
policy remain unresolved. Rank equal wins equally using competition ranks
(1, 1, 3); opaque user ID orders tied entries. Include zero-win participants.
Authenticated active accounts may read their own per-game statistics and paged
leaderboards containing only opaque ID, display name, rank and wins. Pages have
at most 50 entries and reflect current aggregates; refresh repairs ranking drift.

Matches owns immutable finish records and per-seat game_results, written with
snapshot/events/receipt/outbox in its existing transaction. Its public result port
verifies legacy queued finish envelopes against durable Match/outbox truth before
materializing missing records. It never infers missing historical results by
replaying an old engine. Leaderboard owns statistics and generation metadata;
Worker joins public ports without accessing tables or sharing Prisma models.
Leaderboard may call the public Users eligibility/display-name port. No other
foreign query/import is permitted.

Use a separate generation-statistics table rather than changing the existing
user_game_stats key or old consumer callback contract. Generation applications
deduplicate by Match as well as event ID. A short PostgreSQL head-row lock fences
live projection and rebuild changes. Live deliveries update both active and
building generations. Rebuild scans immutable result pages into the building
generation, deduplicates overlap, and switches the head atomically. Failed builds
leave the active generation intact; trusted abort permits recovery after a crash.
Retain old generations until separately authorized cleanup. No Redis ranking.

REST and the real finish consumer are opt-in. Reuse the existing configured Redis
catalog read limiter with a distinct statistics namespace; statistics reads fail
closed on limiter failure. Consumer concurrency and queue settings are explicit.
No live gameplay activation or new numeric production policy is inferred.

## Alternatives

Queue job IDs alone lose deduplication on Redis loss. Recomputing aggregates in
place exposes partial counts and races with live consumers. Giving Leaderboard
Match table access breaks ownership. Excluding Bot wins would require a different
owner-approved credit policy and new finish-time control metadata.

## Consequences

Statistics are eventually consistent. A returning spectator can receive a win
earned by their replacement Bot under the approved seat-credit rule. Weekly
boundaries use UTC, not a local calendar. Rebuild needs privileged trusted Worker
composition and valid retained finish inputs; old outcomes without those inputs
remain a separate backfill gate. New tables/grants are additive and old writer and
consumer shapes remain compatible during release overlap. Telemetry never carries
result metrics, account names, private state or message content. Staging, retention,
capacity and live activation gates remain open.
