# ADR-021 — Durable matchmaking arbitration

- Status: Accepted by project owner; Phase 9A implementation details recorded
- Owner: HamBazi project owner / implementation maintainer
- Date: 2026-09-27
- Supersedes: none

## Context

Architecture section 9.3 requires ephemeral Redis queues/reservations, durable
Matches and exactly one cancellation/match winner. A lost Redis reservation or
uncertain database response cannot prove that an in-flight match creation failed.
The owner approved the Phase 9 proposal recorded in the implementation plan.

## Decision

Redis owns FIFO queues and atomic selection. Matches owns minimal durable ticket
admission and reservation receipts behind a public application port. PostgreSQL
serializable transactions arbitrate cancellation, expiry, new generations and
creation; no network dependency is called inside them. Matchmaking cannot query
Matches storage. API has column-scoped writes; Worker has no admission grants.

Registration binds a user-scoped command ID to game/mode/capacity. An immutable
server deadline and nullable unique active key allow at most one searching or
reserved ticket per user/game/mode across capacities. Same-command retries return
the original ticket; changed intent conflicts. Terminal tickets never reopen.
New commands may search again after a terminal disposition. Queue ordering is not
stored here. No credential, queue payload or hidden game state is retained.

Reservation commands bind an immutable UUID and digest to a canonical ticket-ID-ordered list of
ticket IDs and expected generations. They atomically fence the entire group,
advance generations and set a bounded deadline no later than any ticket deadline.
Expired reservations can be superseded with new identities/generations. Release
checks the reservation identity and never touches a newer claimant. Released or
expired reservation IDs cannot be reused. Cancellation remains possible during a
reservation: whichever serializable decision wins determines the outcome. If one
member cancels, the group cannot commit; unaffected members are explicitly released
or reclaimed after expiry. A release is an irreversible durable abort of that
reservation, including when its previous commit response was uncertain.

Creation atomically writes a CREATED Match with pinned engine/state/ruleset
versions, HUMAN/disconnected seats, all ticket assignments and one version-1
`matchmaking.found` outbox intent. The pre-game snapshot remains null and counters
start at zero. No engine is invoked. Creation retries use the reservation's
committed match identity; no second match or outbox effect can occur. Cancel after
commit returns MATCHED. DB unavailability returns a sanitized retryable error;
callers must reconcile, not infer rollback. Credentials never enter the outbox.

Current Users eligibility is checked before player operations. Games admission
is checked through its public port before new registration and new creation;
registration receipts remain recoverable during maintenance. A required trusted
descriptor resolver supplies executable versions; clients cannot supply them. Production Games remains
non-playable under ADR-018. There is no new production composition or activation;
tests use isolated eligible catalog/descriptor fixtures. Final maintenance and
eligibility ordering is still a pre-activation integration gate with Phase 7C.

All application inputs are strict version-1 schemas. Resource guards bound one
group to 64 tickets and identifiers to 64 characters; these are defensive limits,
not a declaration of game capacities or modes. Actual capacity must be permitted
by Games. Ticket and reservation durations are explicit positive configuration
(maximum 2,147,483 seconds for safe arithmetic), with no production defaults.
Minimal receipts remain for idempotency; no automatic deletion policy is added.

Phase 9A implements the durable boundary. Phase 9B connects Redis, distributed
rate limits, short-lived admission credentials and recovery orchestration. Socket
transport remains 12A; dispatch remains 11B; gameplay remains 10/11. Neither 9A nor
9B may invent a playable Coup descriptor or bypass Phase 7C.

## Alternatives

Redis-only arbitration cannot fence a late DB commit after Redis loss. A database
transaction containing Redis calls violates the no-network-I/O rule and still
cannot make two stores atomic. Rejecting all cancellation immediately at claim
would change the approved cancellation policy. Full durable queue ordering is
unnecessary; only admission decisions need PostgreSQL authority.

## Consequences

Registration and cancellation require PostgreSQL availability and add small
metadata writes. Serializability/uniqueness conflicts use bounded retries. There
is no successful cancellation acknowledgement based only on Redis state. Lost
responses are recoverable through stable identities and durable receipts. Release
and recovery callers must preserve generation/identity fencing. This does not
choose launch capacity, hosting, chat retention, session strategy or game rules.
