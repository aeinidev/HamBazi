# ADR-093 — Admin games, rooms and Match management

- **Status:** Accepted for the approved local Phase 4 rebuild; deployment requires separate authorization.
- **Context:** Phase 1–3 resource rows and operations are frozen. Phase 4 needs bounded search, resource details, durable roster/history metadata and evidence-based diagnostics without disclosing game secrets or bypassing existing writers.
- **Decision:** Add independent strict version-1 schemas in `packages/validation/src/admin-game-management.ts` and new read paths. Preserve the old `adminRowSchema`/`adminPageSchema`, operations, compatibility checker and frozen baseline. The permission enum extension below is the explicit exception for management DTOs under ADR-079/085; it is not a claim that every historical management schema stays byte-for-byte identical.
- **Owner:** HamBazi project owner
- **Date:** 2026-11-04
- **References:** ADR-079, ADR-085, ADR-090; `docs/superpowers/specs/2026-11-04-admin-phase4-design.md`.

## Contracts and ownership

New GET paths are `/v1/admin/{games,rooms,matches}/search`, `/{resource}/{id}/details`, `/rooms/{id}/players`, `/matches/{id}/players`, `/matches/{id}/history`, and `/{rooms,matches}/{id}/diagnostics`. All use full Admin authentication. Owning Games/Rooms/Matches public application ports implement the reads; Admin only dispatches and enforces authorization. OpenAPI additions do not activate HTTP routes by themselves. Private ingress must allow the new GET paths before deployment.

Queries reject unknown keys and client environment/scope input. Limits are HTTP strings parsed to integers 1–50. Games accept bounded ID/slug/title search, admission `status`, game ID and slug cursor. Room/Match `search` is an exact UUID or game ID (no partial UUID or wildcard); their cursors are UUIDs. Their `createdFrom`/`createdTo` are UTC ISO timestamps with an inclusive chronological range. Only Match accepts a UUID `playerId`. Filtering and the authorized game scope, including denies, must run before stable ascending-ID pagination; no heavy total counts. History uses an exclusive positive integer event-sequence cursor, encoded as a decimal HTTP string, and the same limit bound.

Pages use `{schemaVersion:1, asOf, items, nextCursor}`; detail snapshots use `{schemaVersion:1, asOf, item}`. Row metadata comes from the new resource schemas. Game release status and administrative admission status are separate. Details include stored capabilities/capacity, configuration schema version and administrative version, never configuration JSON. `installedVersions` is null unless installed versions can be proven through a public registry; an empty verified registry can return an empty array. Match `pins` are mandatory values from that Match, never substituted from the current runtime. Match `roomId` is nullable, including personal matches. `matchType` is bounded opaque stored metadata (1–64 characters), not a command discriminator: historical `STANDARD` and `PRIVATE` values remain visible exactly as persisted alongside current producer types. A closed enum would make otherwise valid historical pages unavailable; reads neither relabel nor filter away those records. Detail and roster observations are committed owner-controlled read snapshots with an `asOf`; they are not a guarantee about a later command.

Room roster items are only `{userId, seat, joinedAt}`: the RoomMember model has no readiness, agent or connection evidence. Match roster is a strict `kind`-discriminated union. `REGISTERED_PLAYER` adds durable `agentType`, `connectionStatus`, `connectionEpoch`, nullable `readyAt`, `disconnectedAt`, `disconnectDeadlineAt` and `replacedAt` to the stored player fields. A null ready timestamp is pending/unknown readiness, never healthy/ready by inference. `SERVER_BOT` exposes only `{kind, actorId, userId:null, seat, agentType:"BOT"}` from MatchBotSeat; that server actor has no User, join timestamp, readiness or connection metadata. Do not copy the human owner's fields through the engine's personal-roster helper. Rosters and registered result players have at most 64 entries; owners must detect overflow and fail closed rather than silently truncate. Public user/profile links require `users.view` independently and only apply to registered Users.

History permits only metadata (`id`, `seq`, `schemaVersion`, `type`, nullable `actorUserId`, `createdAt`) for the explicit lifecycle/initialization/finish/disconnect/reconnect/bot-takeover event allowlist. `results` contains registered player `userId`, nullable placement and nullable winner from durable public result truth. No event payload, raw event, replay, hidden state, card/role, RNG, chat or credentials may be selected into this interface, even after finish. No readiness or result is inferred from engine state. Reader-role SQL grants must expose only the precise metadata columns needed and must deny state/payload/invite-code reads and writes. The Matches owner uses a fixed database storage helper (`readAdminMatches`) for metadata filtering with a parameterized `EXISTS` over its own MatchPlayer records, following `readPrivateRoomMatch`. This preserves the no-Prisma-relation-traversal boundary without unbounded player-ID collection; scope/date/player filters precede the exclusive ID cursor and bounded 51-row storage result. DTO validation, authorization and public projections remain with the owning reader and Admin application ports.

Diagnostics have strict `{schemaVersion:1, asOf, id, gameId, state, reason}`. States are `NO_SIGNAL`, `SUSPECTED`, `UNKNOWN`, never a claim of certain health. A WAITING/FULL Room past its stored expiry is `SUSPECTED/ROOM_EXPIRED`; an eligible live Match past a durable reconnect deadline is `SUSPECTED/RECONNECT_OVERDUE`. Missing durable deadline evidence is `UNKNOWN/NO_DURABLE_DEADLINE`; unexpired deadlines, terminal resources and inapplicable phases use the corresponding explicit reason. No global timeout threshold, Redis health inference, repair or automatic mutation is introduced.

## Permissions and compatible rollback floor

The only new registry keys are:

- `rooms.players.view`
- `rooms.diagnostics.view`
- `matches.players.view`
- `matches.history.view`
- `matches.diagnostics.view`

Existing permission values remain accepted. OWNER receives registered entitlements through the existing entitlement layer. Role templates and existing ordinary roles receive **no automatic new grants**. Search/details require the base `games.view`, `rooms.view` or `matches.view`. Players/history/diagnostics additionally require their explicit permission. The Backend must intersect base-resource and extra-permission game scopes and subtract denies before reading; independent any-game checks are insufficient. Sessions and current permissions are rechecked on every request; default deny and environment isolation remain authoritative.

Roll out the new vocabulary/parser to both Backend and UI before persisting new-key grants or exposing permission editing. Old UI/Backend parsers can reject management DTOs containing unfamiliar keys. More importantly, durable `ROLE_SAVE` and `ADMIN_ACCESS` actions, operation receipts and history can retain the new keys after current grants are revoked. **Revocation does not permit rollback to an old parser.** Once any new-key action has been persisted, the rollback floor is a Task-1-compatible vocabulary/action/history parser, including in the rollback binary and UI. Preserve it even when Phase 4 routes or grants are disabled. Do not delete/rewind Audit or historical operations, down-migrate data, or restore a backup over a live database to evade this floor. Reverting grants is allowed only with a compatible binary; deployment and rollback qualification must explicitly verify historical new-key actions still parse.

## Existing commands

`GAME_AVAILABILITY`, `ROOM_CLOSE` and `MATCH_TERMINATE` reuse the existing request → reauthenticate/approve → explicit execute → receipt/Audit/UNKNOWN reconciliation flow. No second mutation endpoint or writer is added. Publication restrictions, WAITING/FULL-only close, version/lock checks, terminal-state rejection, idempotency, Audit-before-effect and outcome reconciliation remain unchanged. No editing ruleset/engine/result/seat, force repair, invented winner or Undo.

## Alternatives

Extending frozen generic rows, reading foreign module tables in Admin, granting whole-table reader access, reusing `manage` permission for confidential subviews, inventing connectivity/readiness or adding a new service/queue/database were rejected. Existing public ports plus narrow new projections satisfy the approved scope.

## Consequences

New read ports, narrow reader grants, route policies, ingress paths and typed UI consumers must follow this contract in later Phase 4 tasks. Response and nested schemas are strict and bounded; unknown fields fail rather than being silently retained. Additive paths still pass compatibility against the unchanged Phase 1 baseline, but that baseline does not cover every later management enum; the explicit permission exception and historical-parser floor therefore need their own validation. The current task establishes contracts only, with synthetic local tests; it grants no deployment authorization or production readiness.
