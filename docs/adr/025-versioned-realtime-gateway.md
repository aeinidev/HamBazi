# ADR-025 — Versioned authenticated realtime adapter

- **Status:** Accepted for Phase 12A adapter boundary; live game activation remains gated.
- **Owner:** HamBazi technical owner.
- **Date:** 2026-09-29.
- **Supersedes:** None.

## Context

The architecture requires Socket.IO in the API process, a durable session-derived
identity, versioned events, stable acknowledgements and module-owned authority.
Rooms, Matchmaking and Matches have application ports. Their production gameplay
composition is intentionally disabled pending game activation and later delivery
phases. The gateway must not turn an outbox or internal game event into a public
event without recipient-specific projection.

## Decision

The v1 transport uses path `/v1/socket.io` and namespace `/v1`. Handshake auth is
the strict `{schemaVersion:1,accessToken}` object; bearer material is never sent
in a URL. The gateway uses Auth's public durable `authenticate` port at handshake
and before every acknowledged intent. It binds user/session identity in process
memory and disconnects at absolute expiry. Redis-backed rate control is a
required injected hook for connection and event admission; unavailable control
fails closed. The caller must supply an allowed-origin list. Socket.IO limits a
decoded packet to 16 KiB and the gateway rejects unsupported shapes and event
names.

Every accepted client operation has a callback acknowledgement. It forwards
validated intent and the authenticated user or original credential to the
owning application port; the gateway owns no room, queue or game rule. Match
commands retain `schemaVersion`, `actionId`, `matchId`, `expectedVersion` and
`command`. Match/room subscriptions require fresh membership reads. The
Matches-owned read port returns only `PLAYER` or `SPECTATOR`, with bot-replaced
humans downgraded. Subscriptions grant no state or future delivery entitlement
by themselves: 12B must check authorization again at fanout.

Only client-to-server intent and acknowledgement schemas are frozen in the v1
event catalog now. The documented server-to-player names are reserved; 12B/13/15
must add concrete recipient-safe schemas before emitting them. `presence:ping`
only confirms a live authenticated transport; it does not persist presence.
No chat send listener exists until Chat owns validation, persistence and abuse
controls. A match-found admission credential is revealed only in the requesting
socket's acknowledged response, never in a room broadcast or outbox payload.

## Alternatives

- A separate realtime process would add a deployment and ownership boundary
  without measured need.
- Trusting user IDs or retaining handshake authentication for the entire socket
  would allow stale or forged authority.
- Relaying internal Match events directly would expose hidden state.

## Consequences

The gateway is an opt-in adapter factory attached to the existing Node HTTP
server. The production API composition does not enable it while executable
game/admission configuration and a distributed rate implementation are absent.
This preserves the disabled catalog and avoids selecting unapproved budgets or
game durations. Phase 12B owns fanout, safe projections, ordering, Redis adapter
and draining. Phase 13 owns durable presence/reconnect. Phase 15 owns chat.
Sessions revoked after a completed authentication check cannot undo an already
in-flight application operation; future emitted deliveries require their own
fresh authorization. Multi-node polling needs sticky sessions, and no claim of
production proxy compatibility is made before staging checks.
