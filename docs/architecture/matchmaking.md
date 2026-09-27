# Matchmaking admission — Phase 9A

The Matches public `createMatchAdmissionPort` is a transport-independent durable
arbitration boundary. Matchmaking is still a scaffold until Phase 9B. No endpoint,
Socket listener, matcher scheduler or admission credential is enabled by 9A.

## Ownership and callers

`register`, `read` and `cancel` take an identity already established by a trusted
session adapter and recheck Users eligibility. Inputs never contain an actor ID.
`reserve`, `inspect`, `release` and `commit` are trusted orchestration methods,
not client operations. Keep them behind Matchmaking/composition. Production
composition is intentionally absent while the Games catalog is non-playable.

The factory requires Users/Games public ports, a trusted executable-descriptor
resolver, an explicit clock, ticket lifetime and reservation lifetime. The server
registry owns supported modes and versions. No production Coup descriptor exists
yet. Isolated tests supply fixtures; they do not update production catalog rows.

## Durable protocol

1. Register a version-1 intent with commandId, gameId, mode and capacity. A unique
   active slot spans capacities within each user/game/mode. Retry with the same
   command; changed intent conflicts. Deadline is fixed on first registration.
   Existing receipts remain recoverable during maintenance after user eligibility
   checks; new admission still requires an eligible catalog and descriptor.
2. Claim selected tickets with a fresh reservation UUID and expected generations.
   All tickets must describe the same full group. The DB reservation deadline is
   capped by ticket expiry. Redis integration must use that deadline, never renew
   an already-issued reservation identity and never regard a Redis claim as proof
   of durable creation.
3. Commit by reservation UUID. Recheck eligibility outside the DB transaction.
   The repository atomically creates the version-pinned CREATED Match, seats,
   terminal ticket assignments and notification intent. Seats are deterministic
   ticket-ID order; Redis queue ordering selects participants in Phase 9B.
4. Cancel and commit race in PostgreSQL. Return CANCELLED only after commit of
   cancellation. If creation wins, cancellation returns MATCHED and matchId.
5. On uncertain responses, inspect/retry the same identity. A durable release
   either returns the committed matchId or aborts the reservation, advances its
   still-owned ticket generations and returns them to SEARCHING (or EXPIRED).
   Old release operations cannot affect a newer reservation. Never compensate by
   deleting a Match or assuming a timeout means rollback.

Terminal records are immutable. Expiry is checked on access and admission; an
expired reservation may be superseded by a new generation, but an expired ticket
needs a fresh command. This phase does not introduce receipt deletion or queue
reconstruction. The durable metadata has schemaVersion 1; unknown schemas fail
closed. Serialization/uniqueness conflicts retry at most five transaction attempts.
DB transactions contain DB operations and local computation only.

## Notification intent

The internal outbox event `matchmaking.found`, schemaVersion 1, contains only
`{ schemaVersion: 1, matchId, reservationId }`. Its UUID is the deduplication key.
Validated optional requestId/traceparent correlation is stored on the outbox row.
It is written with the match, starts PENDING and is not published in this phase.
No token, queue payload, profile or hidden state is present. A future authorized
consumer uses Matches ports to resolve recipients and obtain session-bound,
short-lived admission credentials; it must not query Matches tables directly.
Dispatch is Phase 11B and Socket event delivery is Phase 12. Do not treat the
outbox payload as a client admission token.

## Rollout and verification

Apply the additive `202609270001_match_admission` migration, then the declared
column grants through the existing database migration workflow. It adds two
Matches-owned tables; old readers and existing match rows are unchanged. API may
read/insert metadata and update only disposition fields. Worker has no admission
table access. Intent immutability, increasing generations and irreversible
terminal outcomes have database guards. No destructive rollback is needed: old
app code ignores the new tables; retain them and all committed records.

Use the existing `pnpm test:auth-http:local` isolated harness with documented
PostgreSQL binary/share/library settings. It applies/reapplies migrations, checks
Prisma-visible drift, runs two-client races/failure tests and compares admission,
reservation, match, player and outbox records across a PostgreSQL restart. No live
application database or real Telegram identity is used.

## Remaining gates

9B: Redis Lua queue/claim/cancel coordination, FIFO selection, rate limits,
admission token issuance/validation, DB/Redis compensation and restart-loss tests.
10/11: executable game module, lifecycle/commands and dispatcher. 12: authenticated
Socket wiring. 7C: secured live configuration plus final maintenance/eligibility
ordering. No playable loop, production activation, load/soak or network-partition
readiness is claimed by these local admission tests.
