# ADR-020 — Private room invitation boundary

- Status: Implementation decision within authorized Phase 8B
- Owner: HamBazi project owner / implementation maintainer
- Date: 2026-09-27
- Supersedes: ADR-019's deferred invite adapter; preserves its Socket membership boundary

## Context

Architecture section 8 requires opaque invitations, the named Telegram Mini App
link, onboarding continuity, and server-authoritative admission. Phase 8A already
persists 32 CSPRNG bytes per room and its waiting-room deadline. Phase 6B preserves
verified start_param through explicit Mini App account creation. No Socket or
product frontend exists yet; neither is brought forward by Phase 8B.

## Decision

Reuse the stable 256-bit base64url code and room deadline. There is no additional
invite lifetime, rotation, revocation, storage table or retention policy. A code
is a transferable bearer capability, not an identity or a guarantee of a seat.
Only the current active host can retrieve it via GET /v1/rooms/:id/invite.
Host transfer changes retrieval authority; already shared links remain valid.

POST /v1/room-invites/resolve is an authenticated, read-only lookup. It accepts
schemaVersion 1 and canonical room_<code> startParam in the body, avoiding a code
in the API URL. Its preview contains room ID, game ID, capacity, status, revision
and deadline, never roster or identity fields. Unknown, expired, closed or started
invitations return NOT_FOUND; malformed syntax returns INVALID_INPUT. FULL rooms
can be previewed but ordinary capacity/version checks still govern admission.
A preview does not assert game readiness and does not reserve a seat.

Join now requires inviteCode as well as the prior versioned command. The Rooms
repository verifies the room/code pair inside the same serializable transaction
as admission and the receipt. Correct-code committed retries return the original
acknowledgement even after expiry/departure, without recreating membership; an
incorrect code cannot retrieve that acknowledgement. Existing receipt fingerprints
stay compatible, and no code is copied into a receipt. Join has no REST endpoint;
its authenticated Socket adapter remains Phase 12A. Current user and Games
eligibility, room revision, capacity and deadline checks are retained.

Shared transport helpers build and parse only the canonical Telegram named-app
link. Keep launch context in memory through existing account creation/session
issuance, then resolve and send the code with the later authenticated join intent.
Signed start_param is routing context, not membership authorization. Direct Mini
App links avoid the Bot /start onboarding loop; Bot handlers do not acquire room
rules or persist invite context. Full frontend rendering belongs to Phase 14.

Enable invitations with explicit ROOM_BOT_USERNAME, ROOM_APP_NAME and
ROOM_INVITE_LIMIT alongside the existing Rooms group. All three are required
together. The target must identify the operator's registered Mini App; syntax
validation is not Telegram registration verification. No production values are
chosen. The per-user invite budget is shared by sharing, resolution and join,
including malformed authenticated attempts, across API instances. Redis outage
fails closed before lookup/mutation; 429 uses a conservative 60-second retry
window. This extends ADR-019's room limiter behavior without changing other
modules' approved outage policies. Without configuration, invite operations fail
closed and previous room create/read configuration continues to work.

## Alternatives

Public anonymous previews increase enumeration exposure. Putting the capability
in normal room snapshots or API query strings increases disclosure paths.
Checking it only before a transaction would separate admission from authorization.
Adding REST membership mutations conflicts with ADR-019. Separate invitation
records, rotation and a second lifetime are unnecessary for this phase.

## Consequences

No migration, dependency, game activation, live Bot change or deployment is needed.
Invites are sensitive response material: no-store and allowlisted telemetry apply;
proxies must not record bodies. Possession allows eligible admission until room
state/deadline prevents it. Global abuse hardening, live Telegram smoke, secured
activation, realtime transport and complete UI remain their existing gates.
