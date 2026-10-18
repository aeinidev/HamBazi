# ADR 072: Kahroba lobby explicit host start

- Status: Accepted for isolated implementation; staging deployment pending final owner approval
- Owner: HamBazi owner
- Date: 2026-10-19

## Context

The approved Share-only lobby could not create or start games. The owner explicitly superseded that restriction for Create, invitation Join, Ready and Start, requiring the normal Telegram Mini App flow. Existing private-match orchestration prepares a waiting match and automatically activates after the last ready command.

## Decision

Reuse existing Rooms and Matches ports, MatchPlayer.readyAt, command receipts, version guards and Main Mini App invitations. Add an opt-in `manualStart` orchestration policy. The Kahroba composition enables it; existing game compositions keep the default. The full roster is prepared by the authenticated owner using existing `room:start`. Players then independently mark durable readiness. Readiness stays durably WAITING_FOR_PLAYERS even when every readyAt is set; the member projection exposes canStart. The explicit host command atomically transitions READY → STARTING. Recovery holds the prelaunch state. A room-member read exposes only user IDs and ready booleans; an authenticated host start is bound to that room's match and runs the existing atomic lifecycle START with expectedVersion/actionId. Recovery completes STARTING.

The owner-only create check uses Auth's existing owner identity and Users' public identity port. The tester retains invitation join and readiness. Authentication, two-account admission, engine pins and result contracts do not change. No schema migration, new infrastructure, client-authoritative readiness or hidden-state projection is introduced.

## Alternatives

- Client-only readiness was rejected because reloads/concurrent clients would disagree.
- New RoomMember columns were unnecessary: durable MatchPlayer.readyAt already owns readiness.
- Retaining automatic start would violate the requested final host Start step.

## Consequences

The normal lobby replaces the testing utility as the user path. Waiting matches use the explicit-start policy throughout their lifetime. The persisted WAITING state also prevents the historical f3 API from launching a newly readied lobby during rollback. The compatible existing Worker can retain v1/v2 result and historical outbox semantics. Before deployment, qualify the new recovery pair and refresh actual staging/containment bindings; do not import concurrent owner changes or Coup-disable work. The separate frozen v1/v2 documents stay unchanged; the additive lobby surface has its own versioned contract.
