# ADR-023 — Match lifecycle and atomic command processing

- Status: Accepted for application implementation under Phase 11A authorization
- Owner: HamBazi implementation maintainer; project owner retains activation decisions
- Date: 2026-09-29
- Supersedes: none

## Context

Architecture sections 10.1, 11.5–11.8 and 14.5 require pinned engines, a short
row-locked transaction and durable cached command acknowledgements. Phase 9
already creates Matches and seats atomically. Phase 10D supplies the complete
pure Coup engine. The authorized phase adds execution to those durable records;
production admission, dispatch, realtime and reconnect remain separately gated.

## Decision

Use one fixed, parameterized `SELECT id FROM matches WHERE id = ... FOR UPDATE`
inside a Matches-owned transaction. The database package exposes `lockMatch` only
to Matches and rejects its use outside a transaction. Arbitrary SQL and Prisma
models remain private. At PostgreSQL's default Read Committed isolation, the
subsequent reads observe the preceding writer's committed receipt/version.
Transaction bounds come from the existing database configuration. Retry only
sanitized transaction conflicts, at most three attempts; other failures roll back
and return a safe error for caller retry with the same action identity.

Every accepted lifecycle, readiness or game operation advances Match stateVersion
once. Each appended lifecycle, readiness, initialization or engine event receives
its own monotonically increasing sequence. Engine revision is separate. Readiness
is a durable, one-way seat marker, not connection/presence state. Trusted WAIT
moves CREATED to WAITING_FOR_PLAYERS. All assigned seats must acknowledge readiness
before READY; trusted START enters STARTING and ACTIVATE initializes the pinned
engine and enters ACTIVE atomically. FINISHED is engine-result-driven; trusted
TERMINATE can close a nonterminal Match. Neither terminal state permits new writes
through these ports. The separated STARTING step is recoverable by stable retry.
No readiness timeout or production duration is selected here.

Bind `(match_id, action_id)` receipts to actor, expectedVersion and a canonical
SHA-256 digest of operation/intent. Retry lookup precedes current lifecycle/version
checks but follows current human-seat authorization. Matching retries return the
original minimal acknowledgement even after newer commands or completion. Changed
intent or actor conflicts; a new actionId with stale expectedVersion conflicts.
Legacy receipts without a digest fail closed instead of guessing intent. Rejected
commands have no receipt/effect. Receipts have no new expiry/retention policy.

Trusted lifecycle receipts use a nullable actor; player receipts require the
authenticated human member. This additive schema change leaves existing actor
values and old insert shapes valid. Readiness and digest columns are nullable for
previous-release overlap. No production migration is performed in this phase.

The generic service accepts synchronous game adapters, resolved by game ID and the
three immutable pinned versions. Concrete Coup wiring lives only in composition.
It uses Node CSPRNG random integers and explicit caller-supplied validated rules;
initialization snapshots those rules and command execution always uses the stored
copy. Configuration replacement cannot alter an active game's rules. Unsupported
versions or invalid snapshots fail closed; no automatic migration or activation.

Persist one restricted initialization snapshot event so replay does not require
retaining an independent random seed or regenerating the shuffle. Subsequent
internal engine events remain restricted Match-service audit data. Snapshot,
events, readiness/lifecycle changes, minimal receipt and `MATCH_CHANGED_V1` outbox
wake-up commit together. The wake-up contains only Match ID, status and counters,
not state, commands, credentials or cards. No publishing, queue, Users or config
network call occurs inside the transaction. Users eligibility is checked first;
as with existing application ports, trusted transport composition establishes the
session identity, and revocation is not retroactive to an admitted in-flight call.

## Alternatives

Serializable optimistic retries alone do not implement the specified row-lock
protocol. A Redis lock would add an ephemeral authority and cross-store failure
modes. Returning stored PlayerViews would preserve unnecessary private historical
data in receipts. Mutating a pinned engine or regenerating initialization with
fresh randomness would invalidate replay. Persisting only a snapshot would omit
the required atomic audit and outbox handoff.

## Consequences

A lost response can be recovered without re-execution. Private engine data never
leaves these ports: clients receive only acknowledgements and stable errors;
resynchronization remains Phase 12B. Callers must retry/resync on conflicts.
All future Match/seat writers, including takeover, must acquire the same row lock.
The outbox is durable but undispatched until 11B. Standard result projection,
trace propagation/dispatch protocols and consumer deduplication stay there.
Admin termination exposure still requires separate RBAC/MFA/network/audit controls.
No UI, Socket, private-room-to-Match orchestration, matcher scheduler, timeout job,
retention choice, OD-004 change, OD-008 resolution or catalog activation is added.
