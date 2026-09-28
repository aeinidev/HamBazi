# Matchmaking admission and Redis coordination — Phase 9

The Matches public `createMatchAdmissionPort` is a transport-independent durable
arbitration boundary. Phase 9B adds the Matchmaking application/Redis boundary
and session-bound admission credentials described below. No endpoint, Socket
listener, matcher scheduler or production admission is enabled.

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
needs a fresh command. No phase introduces receipt deletion; 9B reconstructs ephemeral queue entries
from stable command retries as described below. The durable metadata has schemaVersion 1; unknown schemas fail
closed. Serialization/uniqueness conflicts retry at most five transaction attempts.
DB transactions contain DB operations and local computation only.

## Notification intent

The internal outbox event `matchmaking.found`, schemaVersion 1, contains only
`{ schemaVersion: 1, matchId, reservationId }`. Its UUID is the deduplication key.
Validated optional requestId/traceparent correlation is stored on the outbox row.
It is written with the match, starts PENDING and is not published in this phase.
No token, queue payload, profile or hidden state is present. A future authorized
consumer uses Matches ports to resolve recipients and the 9B `found` port to obtain
session-bound, short-lived admission credentials; it must not query Matches tables directly.
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

10/11: executable game module, lifecycle/commands and dispatcher. 12: authenticated
Socket wiring. 7C: secured live configuration plus final maintenance/eligibility
ordering. No playable loop, production activation, load/soak or network-partition
readiness is claimed by these local admission tests.

## Phase 9B application boundary

`matchmaking/index.ts` now exports `createMatchmaking`,
`createRedisMatchmakingQueue`, `createAdmissionCredentials` and v1 command/receiver
schemas. `search`, `read`, `cancel`, `found` and `admit` accept a current session
credential through an injected Auth authentication callback. Client input contains
no authoritative user ID, versions or reservation identity. `run` is a trusted
bounded orchestration tick, never a client route. `rateFailures()` exposes only
process-local search/read/cancel degradation counts. No logger receives payloads.

The queue factory requires Redis URL, isolated namespace, reservation milliseconds,
search/read/cancel limits and window milliseconds. All values are validated and
explicit; none are production defaults. Use the existing API ACL and close the
adapter during drain. Operations have deadlines and disabled offline buffering;
timeouts can still have executed, so retries retain stable durable identity.
`run` recovers one expired claim before selecting another group. Call it repeatedly
for registered partitions from the eventual owning runtime/scheduler; no polling
process is started by imports or by this phase. Keep API/Redis clocks synchronized.

Separate Redis keys within one partition hold FIFO scores, minimal ticket metadata,
claim receipts, lease deadlines, ticket deadlines and a sequence counter. Lua
limits each cleanup to 128 expired tickets and each selection to 64 participants.
All partition state expires and can be reconstructed. Duplicate enqueues keep queue
position and reject older generations; late cleanup cannot replace a newer claim
or newer terminal metadata. Release preserves the original surviving positions.
The PostgreSQL active key still enforces uniqueness across capacity partitions.

On an unavailable reserve/release/cleanup, return retryable unavailability and
retain the claim for a later tick. Release is the serialization point for uncertain
creation: it returns a committed matchId or durably aborts the reservation. An
abandoned Redis-only claim is first submitted to the same durable reserve identity
and then released, fencing delayed processors. Never infer rollback from absence
alone. A cancelled member prevents group creation; unaffected members requeue.

On Redis loss, current sessions may still read/cancel tickets or retrieve committed
admission credentials. New search fails closed. After Redis recovery, retry the
original search command to reconstruct SEARCHING entries; if a durable reservation
is still live, wait for its deadline and retry, then release/requeue its current
generation. Expired tickets require a new command. Old FIFO ordering is lost with
Redis; durable assignments are not. No global durable queue scan or receipt deletion
policy is added. A lost queue response may leave usable state; never change command
identity just because the response was lost.

`found` requires a committed ticket plus current HUMAN membership and returns a
redacted admission credential. `admit` validates its purpose/signature, user,
session, ticket, Match and expiry, then rechecks current membership. Times in token
results are Unix seconds; ticket deadlines are Unix milliseconds. The eventual
transport must explicitly reveal the credential and use `foundSchema` for its v1
wire shape; never serialize a raw application result expecting a credential string.
Admission is retryable, session-bound and not single-use. It does not mutate Match
state, reclaim a replaced seat or authorize game commands.

The signing factory requires a dedicated 256–512-bit base64url CSPRNG keyring,
active key ID, issuer, audience, clock and 1–300-second configured lifetime. Retain
old keys for unexpired credentials during ordinary rotation; removing a compromised
key intentionally denies those credentials. Never reuse session/Bot keys. A fresh
session obtains a fresh credential. No token is persisted or put in outbox; the
existing versioned intent remains the post-commit delivery handoff. Trusted
consumers can inspect its reservation through Matches to resolve recipients, then
use each live session's `found` operation. No dispatcher or Socket listener exists.

No database migration/grant or dependency change is needed for 9B. The Redis API
ACL adds only `+time` for server-side lease time; the Worker ACL is unchanged.
Roll out the updated ACL before enabling this adapter. No dangerous command
category or broader key scope is granted. Rolling back disables
the new caller; durable 9A assignments and notification intents remain intact.
Do not delete committed Matches to clear queues. Production assembly remains gated
on executable descriptors and Phase 7C, with ingress budgets, shutdown scheduling,
view projection and transport contract/catalog wiring in their owning phases.
