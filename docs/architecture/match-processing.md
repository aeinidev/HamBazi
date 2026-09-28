# Match processing — Phase 11A

`createMatchProcessingPort(database, {clock, games}, users)` is the Matches public
application factory. It operates on durable CREATED Matches/seats already owned
by Matches; Phase 9 admission remains the creation path. The configured HTTP
runtime does not automatically wire or expose this factory. Production catalog
and Phase 7C activation gates remain unchanged.

[ADR-023](../adr/023-match-atomic-processing.md) records implementation semantics.

## Application contract

Player `ready(identity, input)` and `command(identity, input)` require a current
session-derived identity from trusted composition. Users eligibility is checked
before the transaction. The input is strict v1 `{schemaVersion, matchId, actionId,
expectedVersion}`; game commands additionally carry `command`. Client identity,
agent/source and arbitrary extra envelope fields are rejected. The pinned engine
validates command shape and rules under the lock. A committed replaced/BOT seat
cannot issue human commands or retrieve human receipts through this port.

Trusted `lifecycle(input)` adds `operation: WAIT | START | ACTIVATE | TERMINATE`.
It is not a client authority or an admin endpoint. Callers must not route arbitrary
player payloads to it. Existing room start authorization does not implicitly grant
an operator termination capability.

| Operation | Transition / guard                                                         |
| --------- | -------------------------------------------------------------------------- |
| WAIT      | CREATED → WAITING_FOR_PLAYERS                                              |
| ready     | Unready assigned human seat; WAITING_FOR_PLAYERS → READY when all ready    |
| START     | READY → STARTING; complete ready roster and supported pinned engine        |
| ACTIVATE  | STARTING → ACTIVE; initialize state and initial replay event once          |
| command   | ACTIVE; validate/execute/reduce; FINISHED only on a standard engine result |
| TERMINATE | Any nonterminal status → TERMINATED                                        |

Every accepted operation increments stateVersion once, including each ready seat.
A repeated ready with the same actionId returns its receipt; a new ID cannot mark
an already-ready seat again. The roster must have at least two contiguous unique
seats; initialization applies game-specific capacity checks. There is no roster
mutation, disconnect/epoch update, ready reversal, automatic start scheduler or
new readiness timeout in this phase.

Success is `{ok:true,value:{schemaVersion:1,matchId,actionId,stateVersion,
lastEventSeq,status}}`. Retry returns the exact original acknowledgement.
No snapshot, private event or historical PlayerView is returned. Errors are fixed
`INVALID_INPUT`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
`GAME_STATE_CONFLICT`, `INCOMPATIBLE_GAME_VERSION` or `INTERNAL_ERROR` envelopes.
Public Socket contract/catalog generation and resync transport belong to Phase 12.
The shared incompatibility error is additive; existing REST schemas are unchanged.

## Atomic storage and replay

`lockMatch` is available only in the Matches database scope, accepts a UUID and
performs fixed parameterized SQL only in a transaction. There is no raw-SQL API.
Load membership and cached receipt after locking; reject changed actor/intent,
then validate expectedVersion before execution. Read Committed permits a waiter
to observe the completed writer's receipt. The callback performs only PostgreSQL
operations and synchronous domain/engine work. Existing database pool/transaction
limits apply; at most three transaction-conflict attempts are made.

The transaction inserts ordered game_events, updates matches and any readiness
marker, inserts the receipt and inserts one pending outbox row. Any failure rolls
all writes back. A cache hit performs no writes or new random draws. No log/trace
contains requests, cards, RNG material, state or database diagnostics.

Internal event families are `MATCH_LIFECYCLE_V1`, `MATCH_PLAYER_READY_V1`,
`MATCH_INITIALIZED_V1` (schema 1) and `GAME_ENGINE_EVENT` (pinned engine event
schema, wrapping its type/payload). The initialization event stores a restricted
snapshot; restore it with the pinned adapter, then apply ordered engine events.
Lifecycle/readiness metadata does not enter the engine reducer. Retain engines
for active stored versions; unsupported versions fail rather than silently upgrade.

Outbox `MATCH_CHANGED_V1` schema 1 contains only `{schemaVersion, matchId,
stateVersion, lastEventSeq, status}`. Treat it as a wake-up/reference, never as a
raw gameplay broadcast or full finish-result contract. Phase 11B supplies dispatch,
result inputs and correlation propagation; 12B supplies authorized projections.

`createCoupMatchGame(explicitRules)` is an opt-in composition adapter. It validates
rules, uses `node:crypto.randomInt`, validates restored snapshots against the
persisted roster, and executes using stored rules. No production rule/timer values
are selected. Current support is complete `coup-v1` / state 4; retained historical
pure engines remain available in their package, but are not implicitly registered
for Match command execution.

## Migration, failure and rollback

Apply `202609290001_match_processing` using the existing migration-owner workflow
before deploying the new adapter. It adds nullable ready_at/request_digest and
allows null receipt actors for trusted lifecycle events; old rows/inserts remain
valid. Existing API grants cover these tables; no grant expansion is necessary.
Legacy digest-less receipts are immutable and intentionally fail changed/new
processor retries closed. They cannot repeat an effect. No cleanup policy changes.

Roll back application wiring while retaining the expanded schema and pinned
engines. Never rewind Match versions, rewrite history, delete receipts or drop
columns as an application rollback. A persisted STARTING Match can retry activation
with the original action identity/version after recovery. An unavailable database
returns a safe failure; callers retry the same identity after recovery. Redis loss
has no effect on this writer. No dispatcher runs or externally publishes here.

## Verification

API unit suites cover lifecycle edges, strict identity envelopes, safe errors and
CSPRNG adapter restoration/persisted-rule behavior. The isolated PostgreSQL harness
adds `match-processing.test.ts`: two-client duplicate/conflicting commands,
readiness/activation/termination races, fault injection at each write stage,
unknown versions/corrupt state, authorization, closed database and full persisted
Coup replay. Restart comparison includes snapshots, seats, receipts, game events
and outbox. Earlier admission and database integration suites remain regressions.
Use the repository `test:auth-http:local` harness with documented native PostgreSQL
paths; never point it at application data. Staging gameplay E2E remains unavailable
until transport/UI and a staging environment exist.
