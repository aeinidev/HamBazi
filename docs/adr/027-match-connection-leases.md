# ADR-027 — Multiple connections, durable grace and irreversible takeover

- Status: Accepted; owner approved the policy on 2026-09-29. Implementation is staged as 13A/13B.
- Owner: HamBazi project owner and implementation maintainer.
- Date: 2026-09-29.
- Supersedes: none; extends ADR-022/023/026.

## Context

Architecture section 12 requires epoch/version-fenced timeout jobs, best-effort
cancellation and spectator-only return after takeover. Existing realtime delivery
supports several sockets for one user, but did not define aggregate liveness or
node-crash detection. The owner explicitly approved keeping a seat connected
while any authenticated Match-subscribed socket is healthy, starting grace only
after the last valid socket is gone, and using leases for crashed nodes.

## Decision

Keep minimal Matches-owned durable connection leases, separate from Redis's
socket presence and lobby projections. A lease stores a server-generated opaque
connection UUID, Match/member identity, session expiry, lease expiry and closure
marker. It stores no token, raw Socket ID, handshake, game payload or session
credential. Server composition authenticates every connect/renew and supplies the
validated user identity and session expiry. These are trusted application ports,
not public client DTOs. Session reauthentication uses a fresh connection identity.

All lease/seat operations acquire the same PostgreSQL Match lock as gameplay.
Any unclosed, unexpired lease keeps a seat connected. Each newly admitted socket
advances the seat epoch. Closing one socket does not disconnect another. A closed
or expired connection identity cannot reopen: retain its minimal tombstone for
idempotency, without introducing an automatic deletion/retention policy. Duplicate
connect does not renew a lease; heartbeat does. Renewal is capped by session expiry
and does not advance Match version or engine deadlines.

Pin an explicit version-1 lease/grace/maximum-simultaneous-connections policy on
first use for the Match. Durations are positive integer milliseconds bounded to
one day; maximum simultaneous leases is explicitly supplied within 1–32. These
are resource guards, not production defaults or capacity targets. Existing
Matches remain opt-in; no legacy row is backfilled or silently activated.

Last explicit disconnect starts grace at its actual lease end. Without a callback,
reconciliation uses the last lease expiry, not recovery time. A never-connected
active seat uses activation time. A persisted grace deadline survives intervening
commands and configuration changes. A reconnect that commits before takeover
clears grace and advances epoch, even if the wall-clock deadline has elapsed.
Takeover and reconnect therefore have one durable winner under the Match lock.

Timeout jobs carry schema version, Match/player identity, expected connection
epoch, expected Match version and the original grace deadline. Every field and
current liveness is rechecked under the lock. Early/stale/duplicate jobs are
no-ops. A changed Match version requires reconciliation and a freshly guarded job;
it does not extend grace. Job removal is best effort and is not an authority.

Connection transitions and takeover atomically append restricted audit events,
advance stateVersion/seq, insert a minimal receipt/checkpoint and insert the
existing state-free MATCH_CHANGED_V1 outbox wakeup. Lease renewal alone does not
produce gameplay conflicts. Internal transition IDs are generated on the server;
lease identity and timeout guards deduplicate logical operations. Events never
include connection IDs or credentials. No Redis, Socket or queue I/O occurs under
the database lock. No new public wire contract is introduced by 13A.

Takeover sets agentType=BOT, REPLACED_BY_BOT and replacedAt together. It does not
alter the pinned engine snapshot or its deadlines. Existing command authorization
rejects the replaced human, and existing resync projects SpectatorView. There is
no reclaim. OD-004 remains open only for a future change to this baseline.

## Alternatives

Newest-connection-only liveness could replace a user despite another healthy
socket. Redis-only authority cannot reconstruct a lost queue/presence decision.
Process-local timers cannot detect a dead process reliably. Cancelling a BullMQ
job alone cannot prevent an already running timeout. Resetting grace on queue
recovery rewards outages and can leave a Match stuck indefinitely.

## Consequences

Durable heartbeats add database writes and Match-lock contention; capacity and
reconnect-storm validation remain release gates. Connection tombstones add storage
until an explicitly approved retention policy exists. Transport must promptly
close a lease on revocation/expiry and stop renewing on failed authentication;
lease expiry bounds loss of a callback. Socket.IO liveness detection plus the
configured lease duration bounds node-crash detection, followed by grace.

13A delivers the transactional foundation, versioned timeout contract and
PostgreSQL race/privacy tests. 13B adds opt-in Presence/gateway subscriptions and
heartbeats, resync, BullMQ delay/retry/cancellation, bounded recovery scanning and
PlayerView-only bot/timer execution. Production configuration, activation, Phase
7C, OD-008, staging E2E and launch readiness remain gated.

## Phase 13B implementation (2026-09-30)

The approved policy is wired through Presence and authenticated Engine.IO pongs
(or the existing authenticated presence ping), with sequence-acknowledged snapshot
resync on subscription. Gateway drain includes lease cleanup; abrupt node loss
uses the unchanged lease-expiry rule. All heartbeat/lease/grace settings remain
explicit. The existing Redis adapter retains ephemeral socket routing.

A separate version-1 BullMQ queue is rebuilt by a bounded paginated PostgreSQL
scan, avoiding a second competing consumer on the realtime outbox queue. Jobs are
deduplicated by guarded descriptor, use bounded attempts/backoff, sanitize failure
diagnostics and carry optional correlation. Cancellation is a best-effort injected
optimization; durable guards remain mandatory. Completed/exhausted jobs can be
reconstructed by the next scan. No durable queue receipt or new migration is needed.

Generic trusted automation enters the existing Match writer; the pinned Coup
adapter alone owns timer/bot decisions. Bots see PlayerView, expired timers take
precedence, and late bot jobs are no-ops. Engine deadlines and replay semantics
remain unchanged. Recovery scan latency and durable heartbeat load are explicit
operational trade-offs requiring capacity validation before activation. The
implementation supplies opt-in factories and Worker composition; it does not
select production settings or lift the Phase 7C gate.
