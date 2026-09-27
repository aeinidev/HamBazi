# ADR-019 — Private room foundation and transport boundary

- Status: Accepted transport interpretation; implementation details recorded
- Owner: HamBazi project owner / implementation maintainer
- Date: 2026-09-22
- Supersedes: architecture section 15.1's REST join/leave/start route listing

## Context

Phase 8A implements durable Rooms before invites, Socket and Matches. Architecture
sections 8 and 10.2 and AGENTS.md assign membership to Socket; section 15.1 listed
REST membership routes. The owner explicitly approved REST create/read in 8A,
join/leave/start application ports, and Socket wiring in Phase 12A. This resolves
the recorded conflict without advancing another phase. ADR-018 keeps live game
admission disabled until secured operator controls and game readiness exist.

## Decision

Expose only POST /v1/rooms and member-only GET /v1/rooms/:id over REST. Application
ports implement create/read/join/leave/start, expiry, and trusted start-confirmation
and close callbacks. No Socket, invite resolution or Match creation is introduced.
The future invite adapter must authorize admission before calling join; a room UUID
is not an invitation capability. No client transport exposes join in this phase.

Rooms owns its aggregate, repository and command receipts. Serializable PostgreSQL
transactions, bounded five-attempt serialization/uniqueness retries and room
revision comparisons protect the roster and state. Mutation and acknowledgement
receipt commit together. Receipts use unique (actor_user_id, command_id), a canonical
versioned request digest, room ID and applied revision. Reusing a command for a
different operation/input conflicts. A committed retry returns its original minimal
acknowledgement, even after later state changes; it never repeats membership effects.
Current ACTIVE-user checks still precede retries. New admission checks Games through
its public port; leave remains available in maintenance before start/expiry.

Capacity comes from the Games port. The creator occupies seat zero. Joins allocate
the lowest free seat; accepted transitions advance revision. Join by a current
member has no state effect. Host transfer uses monotonic join revision, then legacy
join time and UUID for deterministic ties; recycled seats do not confer seniority.
The last departure closes the room and preserves its historical host identifier.

Waiting/full rooms expire exactly at their persisted deadline. Reads/commands
materialize overdue expiry, and an idempotent expiry port supports a future worker.
No new queue is required for admission correctness. Expiry never affects STARTING,
STARTED or terminal rooms. The full host can request STARTING only after member and
Games eligibility checks. The roster then freezes. A trusted future Match workflow
confirms STARTED after durable Match commit and closes it using the same match ID.
These callbacks have no public transport. There is no fake Match, engine call,
network call inside a room transaction, or room-to-Matches dependency. Recovery of
a stuck STARTING workflow belongs to Match integration, before live activation.

Opt in to runtime routes with all of ROOM_TTL_SECONDS, ROOM_READ_LIMIT and
ROOM_CREATE_LIMIT. There are no default policy values. Lifetime is a positive
integer capped for millisecond arithmetic; read/create budgets are explicit within
1–600/1–60 per user per 60 seconds. These are configuration validation ceilings,
not capacity commitments. Both budgets fail closed on Redis outage with sanitized
503, and exhaustion returns 429/Retry-After. Authenticated membership and durable
storage checks are always required. Existing approved profile/catalog fail-open
policies are unchanged. Omitting the complete group preserves previous startup;
a partial/invalid group fails startup safely.

The migration adds room schema/revision and optional started-match identity,
member join revision, and a Rooms-only receipt table. Defaults preserve old rows;
no old data is removed or rewritten. API can read/insert receipts but cannot
update/delete them. Worker cannot read receipts. No receipt cleanup or room
archival policy is chosen here; receipts remain with durable room records until a
separately reviewed compatible archival policy exists. The required existing
invite_code column receives opaque CSPRNG bytes at create but is never returned
or logged. Resolution, sharing and onboarding handoff remain Phase 8B.

## Alternatives

REST membership mutations were not selected by the owner. Bringing Socket or a
Match implementation forward would expand scope. Redis room truth would lose
durable data. Unversioned membership updates would admit stale delayed commands;
seat order alone would transfer host incorrectly after seat reuse. Returning live
snapshots for retry acknowledgements would not preserve the original result.

## Consequences

The offline lifecycle can be tested with isolated eligible-game fixtures while
runtime admission remains disabled. Existing Games configuration cannot turn Coup
on. Eligibility calls occur outside room transactions; final maintenance/activation
ordering must be integrated with Phase 7C before activation. Match start confirmation
is a trusted server callback, not independent proof of a committed Match. The
future Match workflow must supply that proof and recovery behavior. There is no
UI, invite access, event delivery or playable game in 8A. No hosting, retention for
chat, launch capacity, session or Coup ruleset decision is resolved.
