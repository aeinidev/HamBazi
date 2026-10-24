# Kahroba lobby: sharing-only MVP

Historical acceptance report. Current implementation: [palace lobby](kahroba-palace-lobby.md) and [ADR 075](../adr/075-kahroba-palace-lobby-public-matchmaking.md).

## Scope

The private Kahroba lobby follows the owner-supplied Midnight Neon reference with Persian RTL, the existing Kahroba palace/logo assets, safe-area spacing, room membership, settings, and disabled navigation. Only Share can be enabled. All other buttons have native `disabled` and no action handlers, including room creation, joining, readiness, starting, copy-code, player options and navigation. The only added backend surface is a private member-only public-name projection through the existing Rooms and Users application ports. It is additive in the private v2 runtime contract; frozen v1 and result contracts remain unchanged. No migration, dependency, SDK, admission policy or game-engine behavior changes.

Existing active/finished match routing and game controls remain in their original match screen. The disabled lobby intentionally cannot start or ready a new match in this phase. Public catalog and admission behavior are unchanged.

## Real data and missing prerequisites

The `/restricted/kahroba/room/<UUID>` route uses the existing authenticated `/v1/kahroba/rooms/<UUID>` read, and `/v1/me` for the current profile. Membership, host, capacity, status and room identity come from the API. This is a room UUID, not a short fabricated invitation code. Empty positions derive from real capacity. Other members use the authenticated member-only `/v1/kahroba/rooms/<UUID>/players` public-name projection, bounded to the actual room roster. Their photos are not invented; an existing generic avatar is used when unavailable. The lobby does not invent names, readiness, avatars, occupancy, latency or a room.

The root private lobby renders a complete empty state and reports that a valid existing room is required. It does not silently create a room. Missing/inaccessible/expired rooms, non-hosts, mismatched games and expired sessions disable sharing. The separate authenticated restricted test utility described below provides existing room creation/join/start/ready commands without enabling lobby controls. An already issued deep link remains subject to server admission, expiry and membership rules. Invitation acceptance is explicit in the separate utility; lobby join remains disabled.

## Sharing flow

1. Require a current authenticated session and an unexpired waiting/full Kahroba room with confirmed membership and host identity.
2. On the one enabled Share button, reread the room from the authenticated API, then GET the existing host-only `/v1/kahroba/rooms/<UUID>/invite`.
3. Accept private Main schema v2 and existing named-app v1. Verify canonical opaque start parameter, exact room and expiry, HTTPS Telegram destination and byte-exact code/link agreement. No ROOM_APP_NAME is required for Main links.
4. Resolve the invitation through the existing authenticated `/v1/kahroba/room-invites/resolve` and verify the same unexpired Kahroba room before handing any link to a share channel. Abort on logout, session replacement, unmount or route change. Double taps share one in-flight operation.
5. Use the existing Telegram bridge's `openTelegramLink` to open the HTTPS Telegram share chooser. The owner chooses the second admitted test account. Browser Web Share and clipboard are fallbacks; deliberate chooser cancellation does not copy unexpectedly. If every channel is unavailable, show only the verified selectable link and an honest message.

No credential, Telegram initData, user identifier or session enters the shared URL. Invitations remain memory-only and disappear after session/room reset or expiry. The client does not grant admission or target arbitrary accounts. Exactly the existing admitted accounts remain governed by server policy.

## Targeted verification

Use pinned pnpm 12.4.1, Node 24.20.0 and Playwright 1.63.0. The guarded local preview remains loopback-only, explicitly synthetic and excluded from production builds. `/?lobby=1&room=77777777-7777-4777-8777-777777777777` is a **local test fixture**, never a production room or invitation. `?lobby=1` exercises the missing-room state. Preview controls are not displayed on the lobby.

- `pnpm --filter @hambazi/web typecheck`
- `pnpm --filter @hambazi/web test`
- `pnpm --filter @hambazi/web build`
- `pnpm exec vitest run apps/api/tests/rooms/invites.test.ts apps/api/tests/rooms/application.test.ts`
- `pnpm --filter @hambazi/web test:kahroba lobby.spec.ts --project=chromium`
- Run the same targeted suite with `--project=webkit` in the verified Ubuntu 24 environment and matching WebKit 2359, not incompatible host binaries.

Choose a fresh external `--output` directory and `KAHROBA_LOBBY_EVIDENCE` directory for each browser run so previous reports/screenshots are preserved. Browser tests deny non-loopback HTTP destinations and intercept native sharing; no message is sent to real Telegram accounts. Cases cover 320/375/390/768px, assets/fonts/RTL/safe areas, one enabled control, real membership, missing-room/guest/expiry/authorization failures, malformed/cross-room invitations, resolve failures, double taps, session expiry, clipboard, keyboard and accessibility.

This frontend change requires separate source approval/commit and rebuilt Web artifact qualification before deployment. Earlier clean-image evidence does not certify a modified Web artifact. No deployment, timer renewal or live data mutation is part of this MVP implementation.

## Reference and separate restricted test entry

The owner-supplied `kahroba-lobby-reference.png` is reused byte-for-byte as `lobby-decoration-c33ac6f3c92c.png` (SHA-256 `c33ac6f3c92ce6b3697c456909a2ac7c738cb0d3cbdad00cd0c3898b7dad24ba`). CSS clips only static title/branding rectangles. The illustrative room code, sample roster, readiness and latency in the supplied image never render as application data. Layout geometry is measured against the 941 × 1672 reference. Native controls, real identities, actual capacity, honest membership status, a 44px Share target and safe-area/long-name handling account for necessary dynamic differences. No official Splendor graphics are used.

`https://t.me/Hambazidev_bot?startapp=kahroba_test` selects a separate test utility after normal Telegram verification and server admission. It creates an actual private two-seat room through the existing API. The host opens its lobby and shares its server-issued invitation. The recipient's Main Mini App `room_<opaque>` launch selects the same utility with an explicit join action. To return from the deliberately disabled lobby, reopen the Main Mini App with `startapp=kahroba_test_<actual-room-UUID>`. This navigation parameter grants no membership or authority. Only the existing room, socket, match and admission services authorize operations. The host starts a full room and both users send existing readiness commands there; active matches route to the unchanged gameplay screen.

The utility has no public catalog entry, no admission expansion, no automatic join and no new authentication mechanism. All mutation identities are stable during retries, and expected versions remain server-checked. Share never fabricates a room or invitation.
