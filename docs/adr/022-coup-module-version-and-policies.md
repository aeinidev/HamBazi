# ADR-022 — Complete offline Coup module version and policies

- Status: Accepted for offline implementation under Phase 10D authorization
- Owner: HamBazi implementation maintainer; project owner retains activation decisions
- Date: 2026-09-28
- Supersedes: none

## Context

Architecture sections 7.2, 11.7, 12 and 24.4 require a complete pure game module,
persisted deadlines, fair bots and pinned replay semantics. Phase 10C has an
untimed claims engine; adding Exchange and deadline enforcement changes its
state and behavior. The owner authorized Phase 10D. ADR-018 still forbids live
activation before the secured configuration and integration gates.

## Decision

Introduce `coup-v1`, state schema 4, provisional complete ruleset v1 and
command/event schema 3 as an additive offline engine. Preserve the core-v1 and
claims-v1 implementations for their existing versions. Keep the new reducer
independent of those historical reducers so deadline/Exchange changes cannot
silently affect their replay. A small amount of duplicated Coup rule code is
intentional version isolation, not a template for generic platform duplication.

Require explicit action, response and decision timeout durations in the pinned
rules snapshot. Each must be a positive integer number of milliseconds, bounded
to one day as an input/resource guard. There are no production duration defaults.
At the deadline, ordinary player commands are expired; trusted timeout execution
rechecks the persisted deadline and revision using injected time. One command
resolves per timeout event. Passes retain the original response deadline; later
phases receive a new deadline from the accepted event's timestamp. A caller must
reschedule against the latest revision after every committed command.

The versioned fallback policy passes challenge/block windows, proves an owned
matching card or concedes, selects the first live card for a loss, retains the
original live hand on Exchange, and takes Income unless mandatory Coup applies.
Mandatory Coup targets the first other living seat. Bot policy v1 uses only the
human PlayerView, adding truthful blocks/Tax and affordable Coup preference.
These are deterministic provisional offline policies, not difficulty promises.

Exchange draws two from the already shuffled deck, requires the actor to keep
exactly their current live-card count, and shuffles returned cards with the deck.
Only the actor sees the selection pool. Events store necessary private shuffle
outcomes for replay without seeds or RNG material. Player/spectator projections
and frontend presentation are strict allowlists; internal replay events are not
frontend events. Phase 14B will implement the renderer identified by the adapter
contract; this phase does not create UI or assets.

Snapshot loading validates schema and semantic invariants. Current snapshots and
events use identity migration/upcasting with validation. Earlier versions must
continue on their retained engines; cross-version upgrades fail with
`INCOMPATIBLE_GAME_VERSION`. There is no honest way to synthesize historical
command timestamps, deadlines, or new rules from an untimed snapshot. A future
explicit migration can be added with its own compatibility evidence.

Reconnect never changes engine deadlines. Preserve the architecture's no-reclaim
MVP baseline: a committed replaced human gets SpectatorView. Connection epochs,
grace periods, queue jobs and takeover transactions remain Phase 13; this module
neither establishes identity nor changes seat ownership.

## Alternatives

Mutating claims-v1 would violate version pinning. Automatically upgrading old
states would fabricate deadlines or change active behavior. Sharing a generalized
reducer with historical versions would couple future fixes to their compatibility
surface. Client-owned rule checks or bot access to internal state violate the
server-authority and information-flow boundaries.

## Consequences

New matches can use the complete engine once future registry/admission integration
and activation gates are satisfied. Retained versions add maintenance cost;
frozen replay fixtures and a differential claims-rule test cover that cost.
Stale timeout requests are no-ops, but database single-writer/idempotency and
queue reliability still require Phases 11A/13. The production CSPRNG adapter must
be supplied by the application layer. Numeric production settings, OD-004 changes,
OD-008 legal clearance, live activation and launch readiness are not resolved here.
