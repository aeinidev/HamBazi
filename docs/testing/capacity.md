# Phase 17C laptop capacity harness

Status: **Completed for MVP with performance exceptions** (2026-10-07), under
the explicit owner policy in [ADR-048](../adr/048-mvp-capacity-acceptance.md).
Mandatory correctness, authorization, integrity, idempotency, recovery and
security gates remain required. Production performance/staging targets remain
unmet or unproven; no failed artifact is reclassified as passing.

The unchanged approved workload is **1,000 concurrent users / 200 active Matches /
50 gameplay commands/sec**, with **2,000/400/100** at 2x [ADR-045](../adr/045-initial-capacity-target.md).
REST/ack p95 ≤ 300 ms, committed fanout p95 ≤ 500 ms, reconnect success ≥ 99%
and reconnect p95 ≤ 5 seconds remain future normal-load validation targets
[ADR-046](../adr/046-normal-load-capacity-slos.md). OD-002, remaining OD-007 and
staging/recovery decisions are open. Staging remains fully deferred.

## MVP mandatory-gate evidence and exceptions

The current repaired checkpoint passes `pnpm test:capacity:smoke` in **105.498
seconds**: artifact `abddf655-7b0c-4ac4-ba07-85e3eee7e313.json` reconciles **89
acknowledged commands / 89 durable receipts**, **three terminal results/statistics
applications**, **39 duplicate intents**, **18/18 reconnects**, **64 receipt checks
across owned PostgreSQL/Redis restarts** and **one real idle-turn timer recovery**.
There are zero reported errors/gaps; cleanup passes. Of **54 offered slots**, two
are missed while the Worker is deliberately offline. Finalization adds commands
outside offered windows, explaining 89 total acknowledgements; unsent slots are
not accepted-command loss. The ten-second probe soak is not a two-hour soak.

The current native integration and built release-browser run passes **274
integration tests (17 Database / 230 API / 27 Worker)** and **5/5 Chromium cases**,
with ten dependent builds. Existing targeted load/concurrency regressions cover
the repairs; no additional production repair is required by these passing gates.

| Mandatory invariant                                                 | Current executable evidence                                                                                                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atomic state/events/receipt/outbox and deterministic result         | `match-processing.test.ts`: failed-write rollback, distinct-writer/version races, complete persisted Coup replay/result; database constraints and restart checks                       |
| No duplicate effect or lost acknowledged command in completed probe | Six unknown-commit rounds with eight concurrent original-intent retries each; smoke 89/89 exact receipts; finish/statistics deduplication                                              |
| Admission, identity, role and privacy                               | Rooms/invite/start/capacity tests; session, Match membership, Bot-replaced actor denial, resync role/private-view tests; real browser forged-launch and output checks                  |
| Recovery and shutdown ownership                                     | Reconnect/timeout epoch races, stale jobs, crashed-node leases, real queue retry/reconstruction, accepted-work drain; current smoke Worker/API recovery and both data-service restarts |
| Repaired contention and bounded concurrency                         | 64-Room overlapping turnover; eight-table resync/renewal/registration/recovery waves; real-socket ordering and withheld-recipient-ACK regressions                                      |
| Security controls retained                                          | Existing abuse/input/authorization/privacy/contract regressions; unchanged CI scan policy, private credentials and default-disabled production gameplay; no accepted security waiver   |

See [release suites](release-suites.md) for test owners and fixture limitations.
The checkpoint's **900 API / 27 Database / 106 infrastructure** passing unit
counts (one existing optional scanner skip) are retained evidence, not new runs
in this documentation-only acceptance change. No fresh image/dependency/history
scan, public TLS, live Telegram or production activation is claimed.

The last large diagnostic remains failed: `6131a2aa-8b2c-4692-8d2a-5ed5bc3cae5d.json`
accepts **12,744/15,000** normal offers at **42.467/sec**, and **13,461/30,000**
stress offers at **42.165/sec** including settlement. It does not sustain target
populations through turnover. Normal reconnect succeeds **1,000/1,000** but its
observed maximum is **10,241.391 ms** and histogram p95 upper bound **60,000 ms**;
the five-second timing gate did not pass. Stress first reconnect succeeds
**1,200/2,000**, with 800 failures. Current normal logical-intent/recipient p95
upper bounds **2,000/5,000 ms** include setup/recovery; they do not isolate the
approved acknowledgement/commit-to-fanout measures. Its **24,460/29,205** terminal
receipt coverage is incomplete. The disposable database is gone, so no retrospective
zero-loss statement is possible. Current passing bounded correctness evidence
does not fill that historical gap or prove correctness at arbitrary production load.

Remaining throughput, turnover population, queue/dispatch delay and reconnect
performance, proposed 17CT timing instrumentation, full target-load fault/soak
and production-like staging validation are **deferred post-MVP work**. They do
not block MVP 17C completion under ADR-048. The original full-profile performance
gates, numeric policies and `releaseApproved: false` remain unchanged. Production
readiness still requires the independent staging/security/recovery/owner gates.

## Run

Node/pnpm and dependencies use the repository manifests and frozen lockfile.
Docker must be available with the pinned local PostgreSQL and Redis images.
Keep loopback ports 4174 and 4176 free. Existing listeners are never reused.

```sh
pnpm test:capacity:smoke
pnpm test:capacity:local --connections 2000
pnpm test:capacity:local --profile docs/testing/capacity-profile.mvp.json
pnpm test:capacity:local --profile docs/testing/capacity-profile.mvp.json --normal-and-stress
pnpm test:capacity:local --profile docs/testing/capacity-profile.mvp.json --stress-only
pnpm test:capacity:local --profile /absolute/path/to/approved-capacity-profile.json
```

The smoke first uses two synthetic connections and one two-player table. It
leaves that table idle across its retained sixty-second turn deadline and requires
a new public deadline from the real BullMQ timer worker before offering one
intent/second. It then scales to four connections, two tables and two
intents/second with a ten-second soak. These are tool probes,
not approved peaks. Smoke success does not pass the two-hour or launch gates.

Use the [approved MVP profile](capacity-profile.mvp.json) for the owner-approved
workload, or copy [the template](capacity-profile.template.json) for a separately
approved revision. Numeric
workload values must be positive integers. This fixture permits requests for at
most 2,000 simultaneous clients and two seats per
table; twice the peak Match count must fit inside twice the peak CCU. A larger
workload requires an explicit fixture/quota change, not silent clipping.
Reconnect timing must fit the fixture's explicit 60-second grace policy. Full
runs reject a soak shorter than 7,200 seconds or missing targets before starting
services. A profile is test input, not an accepted OD decision or release approval.

Phase 17CP's explicit `--normal-and-stress` mode repeats the same approved normal
and 2x workload, normal reconnect and three stress reconnect waves. It continues
after failed normal population/SLO gates solely to collect the requested stress
diagnostic; transport, admission, privacy and reconciliation failures still stop
the run. It omits service-restart scenarios and the two-hour soak, records every
omitted stage and failed normal gate, and always exits nonzero with kind
`normal-stress-diagnostic`, `minimumSoakPassed: false` and `releaseApproved: false`.
It still validates the complete approved profile before allocating services.
The default full-profile command retains its original gates and soak requirement.
If normal validation stops on a transport/correctness failure before scaling,
`--stress-only` independently admits the approved 2x population, warms up at its
command rate, runs the same five-minute stress window and three reconnect waves,
then reconciles accepted commands/results. It records the additionally omitted
normal validation with kind `stress-diagnostic`; it also always exits nonzero and
cannot replace normal SLO or full soak evidence.

The `--connections` probe authenticates the requested number of clients, holds
them for 30 seconds, reconnects them simultaneously and holds them for another
30 seconds. It rejects any observed connection loss and incomplete reconnect.
It performs no Match/game load or two-hour soak and has no latency acceptance
target. Probe success cannot satisfy 17C. Startup account creation uses eight
concurrent tasks; reconnect offers every connection in the same wave.

Clients bind distinct synthetic Linux loopback source IPs (`127.1.*.*`), including
HTTP and WebSocket transport. No forwarded-identity header is trusted and auth
limits remain 300/IP/minute and 30/identity/minute. This tests distributed-client
admission rather than shared NAT login throughput. Transport headroom is bounded
and derived from the requested client count, including room for retiring sockets
during reconnect; its exact policy is in each report. API/Worker pools remain
10/4. The capacity fixture explicitly uses ten-second Engine.IO pongs, a five-second
heartbeat timeout and a thirty-second lease, with a sixty-second reconnect grace.
These are local experimental settings, not approved production operating policy.
Reports record the entire presence policy. The original one-second heartbeat
admission experiment accumulated approximately 325,000 session index scans while
establishing 63 of 200 Matches; it was stopped without reaching load/SLO measurement.
Changing the heartbeat removes that extra diagnostic traffic and must be disclosed
when comparing evidence. There is no additional synthetic application ping loop.
The generator and services share the laptop's resources.

Phase 17CQ's capacity composition explicitly uses four concurrent Match delivery
jobs (recorded in report metadata), with the original per-socket ordering,
authorization and admission bounds. Chat retains its prior single consumer.
The prior one-consumer normal/stress diagnostics are preserved; compare their
scenario hashes and concurrency rather than treating these as identical runs.
No pool, quota, timer, retry budget, workload target or SLO was changed.
Registered Presence heartbeats now use durable renewal guards without discarded
game-view reads; initial registration, reconnect and delivered views retain their
full projection checks. Compare source hashes when assessing this change.
Covering snapshots are now acknowledged before their ordered invalidations;
the unchanged client cursor consequently avoids redundant catch-up reads for
already delivered state. Uncovered invalidations still trigger catch-up.

The gateway suppresses re-projection of wakeups already covered by a recipient's
acknowledged version/sequence, after live session/membership/role checks. The
private capacity driver now waits for offered commands and follow-up reads to
settle on failure, then asks the server to stop admission and drain transports
before closing its clients. This prevents fixture teardown from being confused
with measured database failures. Reconnect waves remain simultaneous; no drain
scheduling applies to those measured waves.

API and Worker database counters are separate. Pool acquisition, new-connection
and closed-pool errors use exact pinned driver constants mapped to fixed codes;
no driver message, query, parameters or error detail is exported. The first wait
records recipient version lags and a private scalar durable/outbox audit, including
pending/published/failed counts. Expected owner callback conflicts are separated
from sanitized database boundary failures. The optional diagnostic environment
`TEST_CAPACITY_CPU_PROFILE=isolated` samples the API for ten seconds through an
in-process Node inspector session; no debugger listener is opened and raw profiles
remain only in memory. Reports export fixed CPU category counts and elapsed time.
Fixed caller buckets also attribute leaf CPU samples through known owner frames;
missing ancestry remains `other`. These counts measure sampled CPU work, not
database wait time. Profiling adds overhead and cannot serve as final latency
acceptance evidence.

`TEST_CAPACITY_QUERY_WORK=isolated` optionally observes promise-based driver
and callback-based queries in normal/stress diagnostic modes. Fixed table/operation buckets expose
active/maximum counts, ongoing maximum ages and completed duration histograms;
unknown statements use `other`. No query text, parameters, rows or error details
are retained. These are driver wall times, including client queueing and Node
event-loop delay, rather than isolated PostgreSQL execution times. Pool callbacks
preserve their receiver, arguments and original query return. Metadata records this observation; it adds overhead and
is not final latency acceptance evidence. It is disabled in ordinary/full runs.

The snapshot-wait audit also exports bounded active-delivery job counts, distinct
Match count, maximum jobs per Match and processing age. Match/job identities and
payloads are excluded. Queue counts and job reads are separate observations and
can race with job completion; they are not an atomic queue snapshot.

Normal diagnostic CPU profiles arm after warmup; independent stress profiles
arm after admission so a warmup failure can be observed. Both sample when any ongoing work
phase first exceeds two seconds, recorded as `cpuProfilingStage=work-backlog`.
The fixture checks this diagnostic trigger every 500 ms; it changes no application
timeout or workload. Historical profiles sampled before or just after warmup.
Profiler stop can run late when the process is busy; exported elapsed time is
measured rather than assumed to be ten seconds. Worker automation
observations export only fixed checkpoint categories and durations. A checkpoint
more than one version beyond the expected version proves obsolete work; the
`SINGLE_ADVANCE` category alone does not prove that this job performed a write.
No job identity, intent, returned checkpoint or game state is retained.

Admission, resync, session and reconnect port failures use fixed owner/operation/code counters. A
Redis command observer distinguishes invalid-window replies from aborts/rejections
without retaining scripts, keys, subjects or exception text. The first rejected
Socket operation is captured separately from later cascading errors; transport
ACK failure records the fixed event name and connected flag. The first pool
acquisition timeout also retains its timestamp and fixed counters. A failed
snapshot wait also audits scalar BullMQ waiting/active/delayed/failed counts and
oldest waiting age; database outbox publication alone does not prove recipient
delivery. The diagnostic queue connection is fixture-owned and closes on exit.
At the first driver failure a separate resource probe records fixed PostgreSQL
state/wait aggregates and pool counts, including blocked connections and maximum
transaction age. It does not retain backend identities or query text. This probe
occurs after notification and is timestamped; it cannot reconstruct an earlier
database state.

The fixture explicitly paces transport-pong reauthentication and lease renewal
at four concurrent operations, recorded as `realtimeHeartbeatConcurrency`.
Queued heartbeats retain live authority and expiry guards. This changes execution
scheduling, with the previous default retained by the gateway factory; it does
not alter heartbeat/lease/grace deadlines, session expiry, admission quotas,
command retries or workload targets. A 32-socket regression checks that four busy
socket tails cannot occupy every heartbeat slot and prevent 28 idle sockets from
renewing. Deferred maintenance waits for its socket tail, acquires a slot, then
rechecks the tail before appending; a separate race covers newly arrived work.
The fixture likewise records four concurrent intents and disconnect closures as
`realtimeIntentConcurrency` and `realtimeDisconnectConcurrency`. These pace
already admitted work within the same pending budgets; guards remain live after
waiting. Fixed database work counts/timings distinguish admitted callbacks from
queued transactions at the first pool timeout. Pure game timing records only
fixed operation counts and elapsed milliseconds, with arguments/results omitted.
Private gateway work snapshots report only fixed operation/phase categories,
active/waiting counts, maximum phase ages and completed-phase count/total/maximum
durations. Heartbeat queue/authentication/renewal and Match fanout
tail/authentication/membership/projection/ack phases include ongoing work, so
completed-only delivery histograms cannot hide a stalled operation. They exclude identities, inputs,
credentials, socket contents and gameplay state.
Admitted intents are observed from arrival: `order` waits behind prior intents,
`tail` waits for current transport work, and `slot` waits for execution capacity.
These fixed categories distinguish queued work from its rate/authentication/owner
service time without changing scheduling or admission. Completed maxima remain
useful when a first-failure resource probe runs after a burst has already drained;
the probe's elapsed timestamp must be reported with that limitation.
Phase counts include repeated waits and are not unique-command counts. Scheduled
work retains its admission position across active-tail waits, without reserving
execution capacity while ineligible. A four-/32-socket regression covers older
intent progress after the blocking projection finishes while newer sockets can
proceed during that projection.
Current-cursor catch-up skips empty event and unused receipt queries, retaining
its Match lock, fresh roster/role and recipient projection on every call.
Gateway deadline failures are retained, but fixture resource disposal awaits
the underlying drain before closing the database and Redis. This prevents a
timed-out drain from continuing against disposed dependencies; it does not
extend the configured deadline or treat cleanup as successful.
Presence renewal selects only required durable metadata and avoids re-reading a
live lease just extended under its Match lock.
The first heartbeat after activation keeps its initial guard projection and
durable connection registration but skips the unused post-commit view. Initial
subscription still transmits a fresh post-commit PlayerView/SpectatorView.

Record the owner, scope, date, units, measurement definitions and approval in an
ADR/decision record before treating inputs as launch targets. Laptop-only
authorization in [ADR-044](../adr/044-temporary-laptop-server.md) does not decide
the final provider/region or public gameplay activation.

## Scenario and measurement

The runner builds compiled API/Worker dependencies, provisions its own random
Docker PostgreSQL volume/network and ephemeral ACL-protected Redis, creates and
migrates a separate `hambazi_release` database, and forks the existing real-service
release composition. API, Worker and migrator retain separate credentials and
grants. Root `.env`, laptop data, public ingress and Telegram credentials are not
used. Synthetic launch and access/admission tokens remain in process memory.

The API fixture injects the same eligible synthetic CatalogPort as Phase 17B
and verifies stored production Coup is DISABLED. Clients authenticate through
the real HTTP boundary and use real Socket.IO commands, membership, readiness,
Match writer, CSPRNG engine, outbox, BullMQ and statistics projection. Capacity composition also starts the
existing timer/reconnect automation worker with Worker credentials and its retained
Coup adapter from the API package's documented server composition export. The
local recovery scan uses 100-Match pages every second, three attempts, 100 ms
backoff and a five-second drain deadline. These are test settings, not final
production policies. Engine action/response/decision deadlines remain 60/30/30
seconds. The driver waits for expired turns to recover through real jobs, includes
that wait in command latency and can reconcile an automatically finished table.
The former outbox/statistics-only fixture failed during warmup after setup outlasted
the first turn deadlines; its failed result is retained without SLO claims. Half the
paired tables use private invitations; the remainder use real matchmaking.
Each pair's two matchmaking enqueues are serialized so its tickets stay adjacent
in the real FIFO. Match assignment, subscription/readiness and private-room
admission overlap; setup uses batches of at most eight tables. Found Match IDs
are still checked for both recipients, so an unexpected roster fails the test.
This fixture does not establish a general burst matchmaking traffic model. Capacity
Room recovery runs in a separate single-flight scheduler with fifty-room pages every
second, rather than a full sweep inside each matchmaking tick. Its cursor
continues across pages, and shutdown waits for outstanding recovery. The driver
deadline includes a bounded allowance proportional to table count; it does not
shorten the approved soak or change a product latency gate.

Full runs first establish 1,000 clients and 200 tables, perform a 60-second warmup,
five minutes at 50 commands/sec and a normal-load reconnect wave. Normal acceptance
requires REST and command-ack p95 ≤ 300 ms, dispatch-to-recipient p95 ≤ 500 ms,
reconnect success ≥ 99% and reconnect completion p95 ≤ 5 seconds. Success and
timing are measured separately; failed first-wave reconnects remain failures even
if a retry restores the client. A failed normal gate stops before the stress soak.

Then the driver grows to 2,000 clients/400 tables and runs five minutes at 100
commands/sec, three simultaneous reconnect waves, Worker reconstruction with
offered commands, HTTP/Socket restart and another reconnect wave, PostgreSQL
and Redis container restart with active tables, then at least two hours at twice
the peak command rate. Each data-service restart pauses offered commands and
metrics, waits for real authenticated health and adapter backoff, reconnects all
clients and checks every current accepted receipt. It does not measure throughput
during a DB/Redis outage. Ports remain fixed across owned-service restart.
Sessions re-authenticate from fresh
synthetic `initData` every ten minutes. Each terminal table is reconciled and
replaced; final drain finishes every current table without creating new ones.
Only income, coup and card-loss intents are selected from the recipient's
strictly validated PlayerView. No hidden state is read to choose commands.

Commands are offered on a fixed clock. Busy-table slots and generator lag are
counted separately as missed, rather than slowing the offered rate to hide saturation.
Definitive stale-version rejections synchronize before a bounded new intent;
ambiguous transport failures retry the original action ID and expected version.
Repeated accepted intents must return the same receipt. Every tenth offered
intent also requests the authenticated profile; this explicit REST mix is not
an inferred user traffic model. Churn can reduce concurrent active tables, so
each stage records minimum/maximum observed active Matches and connected clients.
Full acceptance requires those observed minima to meet the approved normal or
stress population for every load/soak stage. A brief observed drop during turnover
fails that gate; sampling does not prove continuous population between observations.
The small smoke reports drops without claiming full acceptance.

HTTP retries require an explicit retryable server error, status 503, a read or
stable original REST command ID, and at most three retries. Private control
operations and non-retryable INTERNAL_ERROR responses are never retried by this
guard. Backoff is included in REST latency. Error diagnostics retain only fixed
codes, HTTP status, route category or Socket event name; no payload/message is kept.

REST latency measures dispatch to complete body. The current command timer starts
at the logical intent, before possible expired-turn recovery, catchup, terminal
reconciliation and replacement admission, and continues through retries to an
accepted acknowledgement. It can therefore include work before the gameplay RPC
is sent; it is not an isolated RPC acknowledgement duration. Dispatch-to-all-recipient
latency measures the original dispatch to both clients observing at least the
accepted version. It is a conservative end-to-end bound, not isolated
commit-to-fanout timing. Reconnect measures WebSocket establishment, subscription
and projected snapshot; clients then reconcile against the durable cursor.
Percentiles are upper bounds from bounded histograms; slow observations and
overflow are retained. Stage histograms separate steady load/soak from warmup,
intentional outages and final drain. Planned outage misses remain visible.

Reports include application payload byte counts (excluding transport framing),
API RSS/heap/CPU/event-loop delay, PostgreSQL connections/commits/rollbacks/deadlocks
and Redis memory/connections/commands/rejections at startup, every minute and
completion. The test data source is disposable and known; administrative
PostgreSQL access is used only for aggregate test-service metrics. Recipient
views, events, SQL, chats, credentials and raw child errors never enter reports.

After each finish, Match-owned scalar audits prove each accepted action ID and
resulting version exists, event count equals the durable sequence, one result
and finish outbox event exist, two result seats exist, and statistics applied
once. Private rooms must be CLOSED. Graceful cleanup removes only owned
containers/volume/network and temporary credentials, retaining scalar JSON
evidence in ignored `.capacity-results/` with private file/directory permissions.
Failed runs retain fixed failure stages and scalar counts; they cannot produce
success evidence. Source revision, tracked-diff hash, scenario/lockfile hash,
image digests, topology, hardware, pools and fixture quotas are recorded.

Focused diagnostics distinguish raw callback codes from the sanitized database
boundary's codes. A domain `GAME_STATE_CONFLICT` thrown under a transaction can
produce a generic database-boundary count while its owning repository still
returns the correct domain rejection; this count alone is not evidence of a
database outage. Counter snapshots at the first driver failure and settled
driver stop separate load observations from teardown effects. The driver stops
new invalidation reads and settles admitted moves/reads before reporting failure
and closing sockets. A first snapshot wait records only recipient counts for
missing/stale/disconnected/syncing state, never views or identities.
Additional aggregate histograms separate delivery service time from intent age
when the consumer starts publication. Intent age begins at the producer's stored
timestamp before commit and includes commit/outbox/queue delay; it is not an
isolated commit-to-recipient SLO measurement. Raw query/error text and private
intent fields are excluded.

## Acceptance and remaining evidence

A socket acknowledgement failure uses a fixed diagnostic code; no underlying
Socket/HTTP error message is retained. Room reconciliation waits for both the
statistics application and durable private-room closure.

Full local runs return nonzero for reconciliation/privacy errors, missed steady
load slots, observed populations below target, missing required stages, an
insufficient soak or failed **normal-load** latency/reconnect targets.
Normal-load latency targets never gate the 2x stress stages. Stress observations
retain all offered/accepted/missed traffic and latency, plus correctness, recovery
and stability results. Schema-version-2 reports identify this separation explicitly.
Every report has `releaseApproved: false`, including a locally successful full
run. The 17C release gate still requires the approved workload and SLO record,
production-like deployed topology, resource saturation/failure analysis and
remediation with repeated evidence.

This harness exercises API/Worker reconstruction and PostgreSQL/Redis restart
with active tables. Sustained DB/Redis failure with offered commands,
unknown-commit fault injection at load, timeout/Bot takeover capacity,
public TLS/ingress/affinity, six-player/claim/exchange traffic, chat load and real
Telegram WebViews remain separate required scenarios. Existing [release suites](release-suites.md)
cover correctness of those applicable failure paths; unit/integration correctness
is not capacity evidence. The laptop public composition still serves auth/profile/
catalog only; this work does not activate production gameplay under Phase 7C.

## Current failed evidence and prerequisite

The full-profile laptop diagnostic
`.capacity-results/d67bd80a-a200-49e2-82a9-f76fdd54e3dc.json` missed 8,123 of
15,000 normal offers and observed only four active Matches at its minimum. Its
dispatch and reconnect p95 upper bounds were both 10,000 ms. That run predates
the later driver corrections and cannot establish capacity at the approved workload.

Parallel setup then failed before gameplay. The private scalar artifacts
`ee9cf15c-053b-4ceb-96a9-99bd37706514.json` and
`1b652952-e519-4e54-b10d-d45897198109.json` record Room creation HTTP 503 and
`room:join` INTERNAL_ERROR respectively. The latter is non-retryable under the
public contract; the driver's retry guard now honors that flag. The cause is
now established by Phase 17CP: allowlisted private counters in
`17ceb9d3-6b00-47e9-9ed9-c9b9e717c1ab.json` record four statement-time
`PG_40001` conflicts classified as transaction conflicts, followed by one
commit-time `PG_40001` classified as `DATABASE_OPERATION_FAILED`. The pinned
Prisma adapter exposes its commit error directly, whereas statement execution
maps the same conflict kind to `P2034`. The database boundary now normalizes the
exact adapter conflict kind, preserving Serializable isolation, Room's existing
five attempts, quotas and the non-retryable public INTERNAL_ERROR contract.
The independent stress repeat `bd4d4c3f-b9cf-45c9-8509-ba217430ce7e.json`
then stopped at `room:join` after 21.463 seconds: 30 correctly classified Room
transaction conflicts, zero generic Room database failures and no limiter denial.
The retained immediate retry loop exhausted its bound under contention. Room
now adds only bounded jitter after rollback between those same five attempts:
10–20, 20–40, 40–80 and 80–160 ms (at most 300 ms scheduled total). No public
retry flag, quota, isolation level or transaction-held delay is introduced.
Real PostgreSQL commit-barrier and repeated create/join receipt regressions
cover this path. Final repeats below record remaining capacity failures. Failed
cleanup flags remain false; exact owned resources were audited and temporary
credential directories removed afterward, separately from the run result.

With both repairs, normal artifact `4b2c5684-d9cd-48c0-9aa2-80a281bdefcb.json`
admits 1,000 clients/200 Matches, then stops after 251.351 seconds during normal
gameplay with `CAPACITY_WAIT_FAILED`. Aggregate warmup/partial-load counters are
9,381 offered, 5,930 accepted and 3,450 missed; only 2,490 accepted receipts reach
terminal reconciliation before interruption. Completed warmup observes the full
population, 1,943/3,000 accepted offers and REST/ack/dispatch-proxy p95 upper
bounds of 50/200/10,000 ms. Those are warmup observations, not normal SLO
acceptance or isolated committed fanout measurements. Cleanup is recorded false;
exact owned resources/processes were audited absent and its credential directory
was removed afterward.

Independent stress artifact `73d1b429-0844-4a18-8304-d466042a6e8b.json` reaches
2,000 clients and completes 400 admissions (the driver advances to warmup), then
stops there after 170.647 seconds with `CAPACITY_WAIT_FAILED`: 1,120 offered,
453 accepted and 666 missed at the configured 100 commands/sec. No receipts reach
terminal reconciliation. It records 216 known Room conflicts, 34 Match conflicts,
283 generic Match failures and two generic Users failures; no Room generic
failure, Room acknowledgement failure or limiter denial is recorded. Cleanup
passes. Both repeats have one offer outside their accepted/missed counts.
Neither completes a full workload window, reconnect validation or the two-hour
soak; zero-loss/correctness/recovery/stability acceptance cannot be claimed.
Gameplay waits, the dispatch proxy and these distinct database-under-load
failures require focused investigation; their root cause is not established by
this Room repair. Phase 17C remains Blocked and staging remains deferred.

The latest smoke artifact
`.capacity-results/5040650a-a421-44ea-8baa-3782d6553ce0.json` passed in 108.260
seconds with 89 accepted commands/receipts, three reconciled results, 18/18
reconnects, one real idle-turn recovery and successful owned cleanup. The strict
observed-population gate was added and unit-tested afterward; full acceptance
has not been rerun. None of these artifacts completes 17C or approves release.

## Earlier smoke and connection evidence

The earlier version-1 real-service smoke completed with 60 accepted game commands and 60 durable
receipts, two reconciled results/statistics applications, 20 duplicate intent
checks, 16 successful reconnects and zero reported errors. Both data-service
restarts preserved all current accepted receipts (44 checks in total). Its steady
ten-second load and ten-second soak accepted all 20 offered intents each. The
intentional Worker outage missed two of four offered slots, exposing temporary
fanout delay instead of counting those slots as throughput. This is tooling
evidence, not a completed Phase 17C or two-hour soak. Updated final smoke evidence
is recorded in the implementation plan after verification.

The retained pre-change connection probe at
`.capacity-results/3d65fb05-d47c-4e6a-9be2-2a4bf5e7bf64.json` held all 2,000
authenticated clients for two 30-second periods and restored **2,000/2,000**
connections in one simultaneous wave, with reconnect p95 upper bound **1,000 ms**
and no connection errors. It completed in **93.522 seconds** and cleaned all owned
resources. Its source/diff/scenario hashes matched the preserved candidate before
the normal/stress changes. It is historical idle-socket evidence, not a rerun,
normal gameplay SLO evidence or a completed two-hour soak.
