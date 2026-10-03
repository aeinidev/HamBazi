# Private room foundation

See [ADR-019](../adr/019-private-room-foundation.md) for the approved transport
interpretation and persistence semantics. `apps/api/src/rooms/index.ts` is the
public surface. Domain code has no I/O; repositories access only Rooms delegates.
Auth is injected by composition; Users and Games are accessed through public ports.

## HTTP and application use

Configure all three values to register room routes: `ROOM_TTL_SECONDS`,
`ROOM_READ_LIMIT`, `ROOM_CREATE_LIMIT`. No values are implied by their absence;
without the group, existing API startup continues without room routes. These
settings do not activate any game. The deployed Games port still denies creation.

POST `/v1/rooms` accepts only `schemaVersion: 1`, UUID `commandId`, `gameId`, and
integer `capacity`. It returns 201 with `ok`, schema version, command ID, room ID
and applied revision. Retrying normalized identical input returns the original
acknowledgement. Changed input/operation with the same actor/command returns
`ROOM_CONFLICT` (409). Use a new command for a new intent.

GET `/v1/rooms/:id` returns a current member's safe snapshot, including revision,
status, host, capacity, expiry in Unix milliseconds, optional started-match ID and
member IDs/seats/join order. Invite code and arbitrary database fields are excluded from this snapshot. Nonmembers receive NOT_FOUND. Clients must render snapshot data
as data and must not infer authority from UUIDs or membership cached in the UI.

Join/leave/start ports receive a server-established actor and version-1 command
with UUID commandId/roomId and expectedVersion. Refresh the snapshot after a
conflict. Old successful join retries after leave return the old acknowledgement
without rejoining. Join additionally requires a canonical inviteCode, verified inside its transaction; there is deliberately no REST join-by-ID endpoint. Phase
12A will bind authorized intents to Socket and define its versioned event catalog.

Only the full room host can request STARTING. Rooms creates no Match itself.
The owner-approved [private Match workflow](private-room-matches.md) now durably
creates the frozen roster's Match through Matches, calls confirmStarted with the
STARTING revision and committed Match ID, and recovers failed/ambiguous workflows.
The trusted callback and match-bound close/expiry ports are not client endpoints.
A STARTING roster cannot be modified by ordinary join/leave. No timer, ruleset or
executable engine version is invented by Rooms.
The new trusted start projection/recovery page has no player endpoint; host start
reserves the two revisions needed for Match confirmation and terminal closure.

## Operations and compatibility

Apply the additive migration and updated grants before enabling the routes.
Old room rows receive schema version 1, revision 0 and member join revision 0;
legacy equal-time membership uses a deterministic UUID tie-break. Invalid stored
aggregates/schema versions fail closed without exposing database diagnostics.
Receipts persist only request digests and minimal acknowledgements. No cleanup
policy is implicit; do not delete receipts while retained room intents can retry.

Run database migration redeploy/drift and restart verification through the existing
isolated `pnpm test:auth-http:local` harness. It includes Rooms concurrency, expiry,
rollback and receipt/grant tests and checks room/member/receipt persistence across
PostgreSQL restart. Tests use synthetic eligible-game ports and do not activate the
real catalog. `pnpm --filter @hambazi/api contract:generate` and `contract:check`
include the new Rooms OpenAPI and baseline. Unit/domain and HTTP tests run through
the API's existing test script.

Redis failure denies room HTTP routes with 503; it never removes room state.
A limiter denial returns 429 with Retry-After. Database failure is sanitized and
fails closed. Receipt acknowledgement is issued only after commit. Waiting/full
expiry is checked at use time, so a lost/delayed future expiry job cannot allow
late admission/start. The explicit expiry port can materialize unused-room expiry;
periodic scheduling/event publication remain future integrations.

Rollback by disabling the opt-in group or returning to the previous application
release; keep the expanded schema and receipts. Do not revert the migration or
activate Games through SQL. Phase 7C controls and complete gameplay readiness
remain mandatory before live admission. No deployment was performed for 8A.

## Invitations and Telegram handoff (8B)

[ADR-020](../adr/020-room-invitations.md) records invitation semantics. Add all of
`ROOM_BOT_USERNAME`, `ROOM_APP_NAME`, `ROOM_INVITE_LIMIT` to the existing Rooms
configuration to enable invite operations. The limit is an explicit integer
1–600 requests per active user per 60 seconds, shared by share/resolve/join across
instances. No default target or rate is provided. Partial/invalid settings fail
startup. Without this group, invite operations return sanitized unavailability.

The authenticated host reads GET `/v1/rooms/:id/invite` to obtain `roomId`,
`expiresAt`, `startParam`, and `deepLink` under the version-1 `invite` response.
Only WAITING/FULL rooms are shareable. Already-issued links survive host transfer.
Do not log, persist in browser storage, or put returned invitation material into
analytics. Existing API logging omits request URLs/bodies and response bodies.

The shared `@hambazi/contracts` helpers `buildRoomDeepLink` and
`parseRoomStartParam` are transport adapters usable by Bot/Mini App callers. The
link is `https://t.me/<bot>/<app>?startapp=room_<opaqueCode>`. The operator must
register that named Mini App; the server does not silently change the Bot menu.
Keep launch context in memory. If account creation is required, use the existing
verified Mini App onboarding route and its returned `startParam`, then issue a
session. Existing users issue their session directly. Do not trust any launch
user ID or treat a verified signature as room authorization.

POST `/v1/room-invites/resolve` with `{schemaVersion:1,startParam}` and a bearer
session returns a limited current preview. It creates no membership/reservation
and may show FULL. Unknown/expired/closed/starting/started codes return NOT_FOUND.
An invalid canonical encoding returns INVALID_INPUT. Preview omits roster, host,
invite code and executable game claims. The production catalog remains disabled.

The later Socket adapter calls `join(authenticatedUserId, {schemaVersion:1,
commandId,roomId,expectedVersion,inviteCode})`; parse the retained startParam to
obtain the code. UUID alone is insufficient. Retrying the same code/intent returns
the committed acknowledgement without a second membership. Re-resolve after a
version conflict; expiry/capacity/Games checks remain authoritative at admission.
Socket wiring and UI are still future phases. The isolated integration harness
covers signed Telegram payload → account → session → preview → durable join.
It makes no live Telegram requests. No schema migration is added in 8B; rollback
keeps existing room records/receipts and must not expose the old raw join port.
