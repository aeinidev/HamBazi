# ADR-063: Responsive home presentation and available game entry

- Status: Accepted; deployment to the existing admitted personal staging authorized on 2026-10-11; production release remains on hold
- Owner: HamBazi project owner
- Date: 2026-10-11
- Supersedes: ADR-060's three-tile personal lobby presentation only

## Context

The approved reference adds a banner, six game cards, identity header and bottom navigation to the Mini App home. The admitted `owner-auth` scope already has a working personal Coup entry. The ordinary Games catalog remains read-only and projects Coup as non-playable under ADR-018. Future game engines and the Friends/Leaderboard home features do not exist in the admitted personal scope.

## Decision

Render the reference as live RTL React controls with separate self-hosted artwork. The personal home presentation configuration contains Coup as its sole active route and five visually present, disabled future cards. Its Coup route continues to the existing personal entry and server-authoritative `personal:start` flow; no generic catalog capability or production status changes. Direct future-game paths render an unavailable screen. The existing Games catalog exposes no future slug, and its room and matchmaking admission checks reject unavailable games. The personal start contract has no client-selected game ID.

Home and Profile use `/games` and `/profile`. The personal Profile route reuses the existing profile editor; the Settings icon retains `/settings`. The notification control, banner CTA, all-games control, Friends and Leaderboard are disabled with explicit “به‌زودی” labels. Bottom navigation is fixed with enough scroll padding for the final card, including Telegram safe areas.

The generated banner, Kahroba, Chess and Domino art contains no UI text or controls. Existing Coup, Hokm and Ludo art remains in use. The supplied phone frame and screenshot are not shipped as a page image.

## Alternatives

- Activating the ordinary catalog: would bypass ADR-018's readiness and operator controls.
- Registering future games as playable: no executable engine or game module exists.
- Reusing the entire reference screenshot: would make identity, labels, availability and navigation static.
- Making disabled navigation links: would suggest a working feature and permit unsupported direct entry.

## Consequences

No database migration, engine registration, match change, API schema change, or deployment setting change. The personal Coup flow remains the only playable card. The ordinary catalog remains non-playable until its separate activation decision. Real Telegram `photo_url` host coverage remains unverified: official Mini App documentation defines an optional photo URL but no guaranteed hostname or path, and this repository has only synthetic photo fixtures. ADR-062's narrow `t.me/i/userpic/` policy therefore keeps the fallback for other signed photo URLs until native evidence supports a revision.
