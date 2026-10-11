# ADR-063: Responsive home presentation and available game entry

- Status: Accepted behavior and visuals; owner approved the current implementation and restricted staging deployment on 2026-10-11. Production release remains on hold
- Owner: HamBazi project owner
- Date: 2026-10-11
- Supersedes: ADR-060's three-tile personal lobby presentation only

## Context

The approved reference adds a banner, six game cards, identity header and bottom navigation to the Mini App home. The admitted `owner-auth` scope already has a working personal Coup entry. The ordinary Games catalog remains read-only and projects Coup as non-playable under ADR-018. Future game engines and the Friends/Leaderboard home features do not exist in the admitted personal scope.

## Decision

Render the reference as live RTL React controls with separate self-hosted artwork. The personal home presentation configuration contains Coup as its sole active route and five visually present, disabled future cards. Its Coup route continues to the existing personal entry and server-authoritative `personal:start` flow; no generic catalog capability or production status changes. Direct future-game paths render an unavailable screen. The existing Games catalog exposes no future slug, and its room and matchmaking admission checks reject unavailable games. The personal start contract has no client-selected game ID.

Home and Profile use `/games` and `/profile`. The personal Profile route reuses the existing profile editor; the Settings icon retains `/settings`. The notification control, banner CTA, all-games control, Friends and Leaderboard are disabled with explicit “به‌زودی” labels. Bottom navigation is fixed with enough scroll padding for the final card, including Telegram safe areas.

The owner requested replacement of all seven illustrations using the supplied `Luxury Kahroba Gemstones Game Tile.png` as the authoritative visual reference. The six separate posters and four-player banner are reconstructed in the reference's bright style; old poster files are removed from the static inventory. Asset filenames include their content hashes. No interface text or controls are baked into the art. Persian game titles, arrows, badges, identity, CTA and navigation remain live UI. The supplied phone frame and screenshot are not shipped as a page image.

A navy/cyan/purple HTML/CSS loading shell is present before the application bundle and Telegram SDK finish. The same shell covers initial automatic authentication and the first authenticated profile request, with no artificial minimum duration. Errors leave the shell and expose the existing retry/reopen paths. The personal home is rendered only after its authenticated profile is available. Home/loading use a self-hosted, version-pinned Vazirmatn font; the existing Coup UI retains its supplied display font. Telegram's pre-page placeholder, native sheet controls and system chrome are outside React; optional BotFather splash customization is not changed in this revision.

## Alternatives

- Activating the ordinary catalog: would bypass ADR-018's readiness and operator controls.
- Registering future games as playable: no executable engine or game module exists.
- Reusing the entire reference screenshot: would make identity, labels, availability and navigation static.
- Making disabled navigation links: would suggest a working feature and permit unsupported direct entry.

## Consequences

No database migration, engine registration, match change, API schema change, or deployment setting change. The personal Coup flow remains the only playable card. The ordinary catalog remains non-playable until its separate activation decision. Real Telegram `photo_url` host coverage remains unverified: official Mini App documentation defines an optional photo URL but no guaranteed hostname or path, and this repository has only synthetic photo fixtures. ADR-062's narrow `t.me/i/userpic/` policy therefore keeps the fallback for other signed photo URLs until native evidence supports a revision.
