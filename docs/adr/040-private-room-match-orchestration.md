# ADR-040 — Private-room Match creation and recoverable orchestration

- Status: Accepted — focused prerequisite authorized by the project owner
- Owner: HamBazi project owner / implementation maintainer
- Date: 2026-10-03
- Supersedes: none; completes ADR-019's deferred Match integration

## Context

Phase 17B requires the invited-player path to reach a durable game and result.
Rooms already authorizes the host, freezes the full roster and persists its start
receipt, but no workflow creates that roster's Match. Matches already owns a
transactional lifecycle/command writer. The owner separately approved this
prerequisite after the missing integration was reported. Production admission
and Phase 7C remain gated.

## Decision

Matches owns `createPrivateRoomMatchPort`. It consumes the existing Rooms, Users,
Games and Match-processing public ports. Rooms exposes a trusted, validated
frozen-start projection and bounded keyset recovery pages. Neither projection
nor recovery authority is exposed over a player transport. Matches never queries
Rooms tables; Rooms never queries Matches tables.

An authenticated host start preserves the existing strict command and receipt.
Before freezing a new full room, check private-game availability and a trusted
executable descriptor. After the Rooms transaction commits, obtain its frozen
projection, recheck admission/member eligibility, then atomically insert a
`PRIVATE_ROOM` Match, all ordered human seats, version pins and a content-free
v1 creation wakeup. No network I/O occurs in that transaction. The existing
unique `matches.room_id` arbitrates competing writers; bounded serializable/
uniqueness retries find the committed record. Nullable `room_start_version`
records the original frozen revision, without changing old inserts or inventing
legacy provenance.

Use the existing writer to commit `CREATED -> WAITING_FOR_PLAYERS` before trusted
Rooms confirmation. The room then exposes the committed Match ID. Each player
uses the existing authenticated `match:ready` intent. When all seats are READY,
the workflow invokes trusted START and ACTIVATE through the same pinned writer.
No player is marked ready implicitly and no new readiness deadline/ruleset is
chosen. The room's host start authorizes this private startup workflow; it does
not grant operator termination authority.

Lifecycle intent IDs derive from a fixed purpose, Match ID, operation and expected
version. Concurrent attempts at a step share one receipt; a changed expected
version has a different identity. Existing state/version, actor and engine guards
remain authoritative. A recovered Match retains its committed pins and roster;
changed catalog/registry choices cannot replace it. Recovery does not require
fresh admission for an already-created Match. The processing registry must retain
its pinned adapter; missing versions fail closed.

FINISHED or trusted TERMINATED Matches close their bound room through Rooms' public
callback. A new host start reserves enough room revisions for confirmation and
closure. No terminal outcome, result, statistics or receipt is rewritten.

Persisted Room/Match state is the recovery checkpoint. Retrying the original
start/ready/game command first retrieves its owning receipt, then resumes missing
work. If a follow-up fails after that command commits, return a fixed error;
callers must reuse the original command identity, because the outcome is ambiguous.
A reconstructed trusted `resume(roomId)` or bounded `recover(page)` repairs freezes
before creation, unknown commits, WAIT/confirmation/start/activation gaps and
terminal closure without a connected player. Recovery includes STARTING/STARTED
rooms and reports only IDs/fixed error codes. Transient conflicts are bounded;
per-room failures do not stop other entries in a recovery page.

Realtime has an optional `privateRooms` application port. Its existing start,
ready and game-command adapters delegate to it when provided. Default production
composition remains unchanged and disabled. Trusted recovery scheduling/composition
is explicit; there is no public recovery endpoint or new queue. Before live
activation, the approved server composition must run repeated bounded recovery
passes and preserve current drain/admission controls.

## Alternatives

A cross-module SQL transaction would violate ownership. Invented Matches in E2E
fixtures would bypass the missing product behavior. Returning STARTED before a
durable Match could strand invited players. Automatically marking seats ready
would change the existing player intent. Redis checkpoints would not survive
coordination loss. Reopening a frozen room on a transient error could race a
committed but ambiguously acknowledged Match; the retained frozen roster and
recovery are safer.

## Consequences

Private gameplay can run through real public ports in isolated tests, without
activating the catalog. Each owner commits separately; recovery rather than a
cross-owner transaction repairs intermediate durable states. Recovery pages
revisit waiting/active STARTED rooms, so callers must use the continuation and
restart from the first page after a completed pass. Numeric scheduling/capacity
targets remain deployment decisions. Persistent unsupported/corrupt legacy
provenance requires a separately reviewed recovery decision; it is never guessed.

The additive migration has a release overlap with old writers. Application
rollback retains it, pins, receipts and frozen rooms; never rewind them. An old
release cannot finish this new workflow, so re-enable a compatible recovery
composition before restoring private admission. No session/refresh, hosting,
retention, legal, takeover-reclaim or operator identity decision is resolved.
