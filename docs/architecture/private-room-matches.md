# Private-room Match orchestration

[ADR-040](../adr/040-private-room-match-orchestration.md) records the owner-approved
Phase 17BP prerequisite. `createPrivateRoomMatchPort` is exported from the Matches
public surface. All behavior remains opt-in; the production Games registry and
API runtime are unchanged.

## Composition

Create Rooms, the validated game adapters and the existing Match-processing port
with explicit clock/rules/configuration. Pass those ports, the public Users/Games
ports and a trusted private descriptor resolver to:

```ts
createPrivateRoomMatchPort(
  database,
  { clock },
  {
    rooms,
    processing,
    users,
    games,
    descriptor,
  },
);
```

`descriptor({gameId,capacity})` selects executable engine/state/ruleset pins from
the server registry, never from the player command or a Room payload. Keep every
adapter needed by durable pinned Matches registered with the processing port.
Pass the returned port as `privateRooms` in `RealtimeDependencies`; keep ordinary
Rooms reads/membership and Match-processing dependencies. Gateway code delegates
start/ready/game commands and owns no workflow rule. It retains existing schemas,
session reauthentication, distributed admission, bounded work and drain behavior.

The host's existing `room:start` freezes the full roster, creates one durable
private Match, commits WAIT and confirms the room. Member-only Room reads expose
`startedMatchId`, so the current Mini App's Open match link works. Each assigned
human still sends `match:ready` using its latest snapshot version. The final ready
receipt is returned unchanged (READY), while the current snapshot/outbox may
already reflect subsequent START/ACTIVATE (ACTIVE). The existing client resync
handles this. Engine commands and finish/results use the original atomic writer.

## Ownership, compatibility and safety

Rooms' trusted `startSnapshot(roomId)` includes only the frozen game/capacity,
original start revision, status, optional committed Match ID and ordered opaque
seat IDs. It omits the invitation, host, timestamps and game state. Its schema
rejects incomplete/duplicate/noncontiguous rosters. `listStartWork` accepts strict
v1 pages with optional `afterRoomId` and explicit `limit` in 1–50. Neither method
has a REST/Socket route.

Matches' repository accesses only Matches-owned tables. Creation atomically writes
the Match, complete roster and existing v1 state-free wakeup; unique room identity
and bounded serializable retries deduplicate it. The original room start revision
is pinned in nullable `matches.room_start_version`. Apply the additive
`202610030001_private_match_start` migration before enabling this composition.
Existing inserts/rows remain valid; no legacy row is backfilled. Current table
grants need no expansion. New starts reserve confirmation/closure revisions.

Creation checks current active users/private admission. Once creation commits,
recovery uses original pins/roster even during maintenance; unsupported adapters
or conflicting persisted provenance fail safely. Internal intent IDs and receipt
digests are deterministic, without RNG material or credentials. Creation exports
only the existing content-free Match wakeup and approved correlation. No hidden
state, roster or invitation enters outbox delivery payloads or telemetry.

## Recovery and failure behavior

`resume(roomId)` and `recover({schemaVersion:1,limit,afterRoomId?})` are **trusted
server ports only**. A recovery page returns bounded per-room ID/success/fixed-code
results and `nextRoomId`. Follow continuations to the end, then start a new pass.
It scans STARTING and STARTED rooms, including waiting/active Matches that can later
finish. No automatic scheduler, policy interval or administrative route is chosen
here. A live composition must invoke repeated passes with its approved bounded
scheduling and lifecycle/drain controls; Phase 17B can compose this in its isolated
real-gameplay fixture.

- Freeze committed, creation absent: retry the original host intent or run recovery.
- Creation committed but response lost: unique room identity finds the original
  Match, roster and pins; it never creates/replaces another one.
- WAIT/confirmation/READY/START/ACTIVATE interrupted: persisted status identifies
  the next step; the existing writer fences/deduplicates its intent.
- FINISHED/TERMINATED committed, close failed: recovery closes only the bound room.
  Worker/bot finishes that bypass the wrapper are repaired by the same scan.

A fixed follow-up error may arrive after the original command committed. Retry
with the same command/action ID; do not invent a new intent after an ambiguous
outcome. Successful retries preserve the original owner acknowledgement. Recovery
continues other rooms after a failure and never releases/reopens a frozen roster.
Persistent configuration/provenance failures stay visible as fixed codes; no
timeout/unfreeze, fake result or unsupported legacy backfill is inferred.

Rollback disables new private admission/wiring while retaining the expanded
column, Room/Match truth, original pins and append-only receipts/events. Run a
compatible recovery composition to complete retained workflows before re-enabling
admission. Production operator authority and Phase 7C remain separate gates.

## Verification

The declared API unit script covers trusted projections, revision reservation,
private orchestration and recoverable failures. The existing
`pnpm test:auth-http:local` disposable PostgreSQL/Redis harness includes
`private-room-match.test.ts`: competing starts, atomic rollback at every creation
write, unknown commit, reconstructed recovery/pins, explicit readiness/activation,
real Coup finish/result and room-close repair, bounded scans and real Socket
delegation/recipient-safe resync. Migration redeploy/drift, credential grants and
full durable Room/Match restart comparisons run in that harness. No application
database, public game activation or live Telegram service is used.
