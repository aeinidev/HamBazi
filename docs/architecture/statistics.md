# Match results and statistics

[ADR-030](../adr/030-temporary-statistics-baseline.md) records the owner-approved
Phase 15B baseline. This is an opt-in local capability, not evidence of live
gameplay activation, staged Telegram readiness or launch capacity.

## Ownership and consistency

Matches commits one immutable `match_results` envelope and per-seat `game_results`
with its finishing snapshot, audit events, command receipt and unchanged
`MATCH_FINISHED_V1` outbox input. PostgreSQL is the source of truth. Result records
include standard placements/winner/reason/metrics, finish time, counters and pins;
they contain no engine snapshot, deck or independent RNG material. Immutable
guards also reject owner-level UPDATE/DELETE/TRUNCATE on these result tables.

Worker validates a real versioned finish job, asks the public Matches result port
to corroborate it against durable Match/outbox/roster truth, then invokes the
public Leaderboard projection port. A failure between these operations leaves
durable result truth ready for retry. The projection receipt and effects commit
atomically; a second event ID for the same Match is also deduplicated by its
canonical payload digest in each generation. A changed result fails closed.

Leaderboard owns generation values, applications and head metadata. New
`stats_values` rows have generation/game/user/metric/period dimensions. The old
`user_game_stats` table and Phase 11B callback shape remain intact during release
overlap; new reads and projections do not use its foundation-only values.
Leaderboard cannot query Match tables. Names and eligibility come through public
Users ports; Worker cannot read user profiles. Telemetry contains neither names,
result payloads/metrics nor private state. No Redis ranking cache is introduced.

## Approved behavior and REST

Credit one completed game per roster account and one win to its recorded winner,
including wins earned after Bot takeover. TERMINATED Matches earn no statistics.
For Coup, losses equal completed games minus wins. `all_time` and `week:YYYY-MM-DD`
keys use durable finish time; weeks start Monday 00:00 UTC. Queue delay or replay
does not move a result into a later week. No seasonal calendar or rating exists.

- `GET /v1/me/stats?period=all_time|weekly`: own per-game completed/win/loss counts.
- `GET /v1/leaderboards/coup?period=all_time|weekly&offset=0&limit=50`: Coup wins.

Both require a valid memory-token session and ACTIVE account. Unknown or duplicate
query fields, unsupported periods, negative/noncanonical offsets and limits outside
1–50 fail validation. Offsets are bounded to 1,000,000 as a query resource guard.
Other endpoints retain their existing query-string rejection. Counts/ranks are
exact decimal strings rather than JavaScript numbers. Equal wins receive equal
competition ranks (1, 1, 3); opaque UUID ascending orders a tie. Zero-win
participants appear. Only opaque ID, public display name, wins and rank are
returned; inactive names become `Player`. Account erasure remains a separate policy.

Each page uses one database snapshot. Pagination across requests observes current
aggregates and may shift when results arrive. Refresh restarts at page zero. Reads
are eventually consistent with asynchronous projection; the UI makes that delay
visible, provides empty/error states, and renders names as plain text with bidi
isolation. Profile shows own counts; FINISHED Match navigation invalidates the
statistics query cache. Logout clears the existing memory-only query/session state.

The [OpenAPI document](../contracts/statistics.openapi.json) has its own new frozen
v1 baseline. Existing REST/realtime baselines and finish-job v1 shapes are unchanged.
API contract generation/check scripts include statistics and CI task inputs include
the new baseline. Queue schema validation and failed-job recovery use existing
at-least-once infrastructure rather than a placeholder consumer.

## Configuration and rollout

Statistics routes and consumer are disabled by omission or `STATS_ENABLED=false`.
`STATS_ENABLED=true` exposes API routes with the existing configured
`CATALOG_READ_LIMIT` in a distinct hashed statistics namespace. That Redis limit is
shared across both statistics endpoints per account; failure returns 503 and
exhaustion returns 429/Retry-After. It never bypasses identity checks.

Worker opt-in also requires explicit `STATS_CONCURRENCY` (1–16) and
`STATS_DRAIN_TIMEOUT_MS` (1,000–60,000), alongside its existing runtime/database,
queue namespace and cleanup configuration. These bounds are resource guards, not
selected production values. Producer and consumer must use the same configured
queue namespace. Deploy the actual consumer before enabling outbox dispatch.
Shutdown pauses new claims and waits for accepted projection work; a drain failure
is reported safely. Uncertain completed jobs can redeliver and remain idempotent.

Deploy the additive `202610020001_statistics` migration and reviewed permissions
with the existing dedicated migration role before new result-writing API/Worker
code. Runtime API can insert/read results and read aggregates; only Worker updates
the projection head/counts. No production migration is performed by this phase.
Old writers can continue emitting retained v1 finish inputs. The result port
recovers those records without replaying engines, mutating Match versions or
assuming missing outcomes. Older Matches without a validated durable finish input
need a separately reviewed backfill; they are not silently counted.

## Trusted rebuild and recovery

Build the Worker and its dependencies using the repository's build script. In an
authorized protected Worker environment, the declared maintenance command is:

```sh
pnpm --filter @hambazi/worker stats:rebuild
```

This is a trusted local operator entry point, not an HTTP admin route. It uses
Worker credentials and existing explicit runtime configuration, connects only to
PostgreSQL, and reports fixed completion/failure text without payloads or secrets.
Do not run it against an unapproved environment or expose it as a public API.

The procedure creates a BUILDING generation under the head-row lock, corroborates
legacy finish envelopes in bounded pages, scans immutable result records in pages
of at most 25, and commits bounded projection batches. Live consumers serialize
briefly on the same head and update both active and building generations. Match
application uniqueness prevents scan/live overlap from double-counting. Once the
scan completes, one transaction marks the old generation RETIRED and atomically
publishes the new head. Readers never see an incomplete build. Pending finish jobs
can still add newly committed results after cutover under normal eventual delivery.

A failed rebuild aborts its generation and preserves the old active head. A process
crash may leave BUILDING metadata. Confirm the former builder has stopped before
using the explicit recovery command, then rerun the rebuild:

```sh
pnpm --filter @hambazi/worker stats:rebuild --abort-building
pnpm --filter @hambazi/worker stats:rebuild
```

The generation ID fences old builders: stale apply/finish/abort cannot touch a newer
build. Conflicting or malformed durable finish truth stops recovery; investigate
under authorized restricted access, repair through a reviewed owning procedure,
then retry. Do not manufacture missing results or skip failures to claim a complete
rebuild. API reads need not be disabled; the real finish consumer can stay running.

Redis/job loss does not erase PostgreSQL results. Rebuild restores counts from
result truth, while the existing outbox recovery procedure repairs affected queue
delivery. Consumer receipts continue preventing duplicate effects after a rebuild.
Do not purge receipts, results or generations. Cleanup/retention is separately gated.

Rollback disables the new routes/consumer or rolls back code while retaining the
additive schema and grants. Existing queued finish inputs remain readable and old
writer shapes remain valid. No destructive down migration, automatic generation
cleanup, final retention/erasure policy, seasonal activation, production gameplay,
staging HTTPS/WebView validation or load-test readiness is claimed.
