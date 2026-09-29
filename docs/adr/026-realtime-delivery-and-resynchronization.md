# ADR-026 — Recipient-safe realtime delivery and resynchronization

- **Status:** Accepted for the authorized Phase 12B implementation boundary; live activation remains gated.
- **Owner:** HamBazi technical owner.
- **Date:** 2026-09-29.
- **Supersedes:** None; extends ADR-025 additively.

## Context

Persisted engine events contain private replay material. Socket.IO/Redis Pub/Sub
is ephemeral, while PostgreSQL owns Match state and the monotonic event ledger.
At-least-once delivery must survive duplicates, disconnected recipients and missed
wakeups without broadcasting an internal event or a player's hand to other nodes.

## Decision

Matches exposes authenticated-composition-only snapshot and catch-up ports. A
short transaction uses the existing Match writer lock to read a consistent
roster, current role, pinned game descriptor, state checkpoint and event tail.
Only trusted game adapters construct views; Coup validates its PlayerView or
SpectatorView schema. A replaced human receives the spectator projection.
No socket or Redis I/O occurs inside this transaction.

Public `MATCH_INVALIDATED_V1` events retain durable event IDs and sequence numbers
but contain an empty payload and no internal event type. Their state versions are
resolved from durable command receipts. They are invalidations, not executable
engine deltas. Catch-up returns at most 100 contiguous invalidations together
with the latest authorized snapshot. A larger, unavailable or future cursor
falls back to the snapshot. No retention decision is introduced. This bounds
work per read and avoids exposing hidden history; detailed public animations
would require a separately reviewed additive projection contract.

The API consumes only the existing `match-changed-v1` BullMQ queue. Its input is
the validated committed outbox envelope. Publication sends state-free wakeups
through the Socket.IO sharded Redis adapter; each node reauthenticates its local sockets
and obtains their own Match projections. Views and credentials never travel
through cross-node fanout. Local socket work is serialized. A snapshot callback
acknowledges its `lastEventSeq`; only then does the server advance that socket's
cursor. Missing or invalid acknowledgements close the transport and fail the job
for retry. Duplicate jobs may repeat snapshots; client version/sequence handling
makes them harmless. Network delivery cannot be atomically receipted in SQL, so
this consumer intentionally has no database deduplication receipt.

Redis loss latches a node unhealthy, stops admission, closes local transports,
and requires a process restart to restore subscriptions. This avoids depending
on silent subscription recovery. Clients reconnect and subscribe/resync from
PostgreSQL. Publication has a 30-second upper deadline in addition to the supplied
adapter and recipient acknowledgement deadlines. Exhausted queue jobs remain
failed for operator recovery; client catch-up does not depend on queue retention.
Multi-node polling still requires sticky sessions. Redis channels use the existing
private `hambazi:*` ACL boundary and a supplied deployment namespace. Static
sharded subscriptions (Redis 7+, already satisfied by the pinned Redis 8 image)
avoid broad pattern subscriptions and keep channel count fixed per namespace.
The adapter owns its cluster acknowledgement timeout; the supplied Redis timeout
bounds connection setup and ackTimeoutMs bounds each client acknowledgement.

Drain stops admission and waits for already running local operations before
closing transports. Composition stops the consumer, drains the gateway, then
closes its Redis clients and application/database resources. Readiness must
include the gateway's `ready()` when this optional subsystem is activated.
Factories remain opt-in; no production rate budget, game rules, scheduler,
readiness wiring or catalog activation is selected by this phase.

## Alternatives

Raw engine event broadcast violates the hidden-information boundary. Replaying
all historical states for public deltas adds unnecessary read cost and historical
privacy policy. Redis-only recovery loses durable progress. Exactly-once socket
delivery cannot be guaranteed across a failed acknowledgement.

## Consequences

Clients render only snapshots, deduplicate invalidations, detect gaps and request
catch-up. They resync on every new connection and after uncertain delivery. The
shared sequence utility never replaces a newer snapshot with an older/equal one.
A new utility instance is required for a new authenticated identity/Match.

The read lock briefly contends with the writer. Large histories use a snapshot
fallback, and per-socket projections favor isolation over throughput. Production
capacity/load, reconnect storms, proxy/Telegram compatibility and live gameplay
E2E remain later gates. Phase 13 still owns presence epochs, grace timers and
Bot takeover; no such state transitions are introduced here.
