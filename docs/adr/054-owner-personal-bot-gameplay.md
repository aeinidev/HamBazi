# ADR-054 — Owner personal gameplay with server bot seats

- Status: Accepted for this temporary personal staging
- Owner: Sole staging owner/operator
- Date: 2026-10-08

## Context

The owner explicitly authorized complete owner-only gameplay against server bots,
normal engine validation and PlayerView isolation, without fake Telegram users
or external AI. Current production composition has no game transport. Existing
BOT MatchPlayers represent takeover of a real User and cannot admit an independent
opponent. Ordinary catalog activation requires the separate 7C Admin controls.

## Decision

Add an expansion-only `match_bot_seats` relation owned by Matches. Start one real
owner and one independent server actor, in `PERSONAL_BOTS_V1`, using the existing
pinned Coup adapter and CSPRNG. The `owner-bots-v1` API/Worker opt-in is validated
in paired prepared roles; API requires the existing fail-closed owner policy and
exact staging browser origin. Ordinary catalog, Admin, Room, matchmaking, chat
and Telegram settings stay disabled. This implements a distinct personal test
use case, not an Admin route or permission to activate the public catalog.

The start lane is transaction-locked, deterministic by owner/commandId, and permits
one active personal Match per owner. The common writer uses the same row lock,
expectedVersion, actionId receipt, atomic state/events/outbox and pinned descriptors.
Normal writer/read/automation ports reject personal Matches. Bots see their own
validated PlayerView through the existing bot policy; no User/Telegram identity
is inserted. All moves go through the existing engine. Worker uses the existing
version-guarded delayed BullMQ automation and recovery loop, without human-seat
replacement. Current personal durations are 30s action, 15s response, 20s decision,
persisted in the snapshot. Abandoned active tests terminate after two hours;
owner can terminate their own active test. Terminal durable evidence is preserved.

A new `/personal-v1` namespace uses `/v1/personal/socket.io` with WSS only, existing
Redis IP/subject quotas, strict inputs, bounded pending work, origin/secure proxy
validation, server-derived session identity, and reauthentication for every intent.
No actor identity in a payload is accepted. Access tokens remain memory-only.
Full authorized owner snapshots are acknowledged and polled at two seconds;
monotonic client sequence checks and reconnect snapshot recovery apply. No internal
engine events or bot view is broadcast. Graceful stop denies new work and drains
accepted work. Logs retain existing allowlists.

Personal winners/results remain in durable engine snapshots and append-only events;
no competitive GameResult, leaderboard or statistics event is emitted. Personal
outbox wake-ups have a distinct versioned type and are retained pending; their
background fanout is deferred. This finite disposable test profile has no claim
of ordinary multiplayer delivery, public launch, or full Phase 18B3 acceptance.

## Alternatives

Fake Telegram accounts violate identity requirements. Reusing a replaced human
seat misrepresents membership. Public catalog activation without Admin MFA/RBAC/
network restrictions/audit would bypass 7C. External AI is unnecessary.

## Consequences

The owner can test Coup end-to-end without another human. One bot is the initial
bounded implementation. Hidden state is durable only in authorized Matches storage,
never telemetry. The additive migration leaves old data and handlers intact.
A new compatible scanned previous release is still needed for version rollback
acceptance; containment is not rollback. Full Room/Main invitation, Telegram Web
frame support, competitive stats, chat, full multiplayer/reconnect/takeover and
production load/soak/SLO remain outside this personal acceptance.
