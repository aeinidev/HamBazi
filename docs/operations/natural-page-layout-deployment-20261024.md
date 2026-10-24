# Content-aware page layout deployment — 2026-10-24

The owner requested a complete page review: simple lobbies, settings/profile and
other short pages should fit the available screen; additional content may scroll.
The Kahroba game was explicitly excluded. The result is live at
<https://staging.hambazi.top/> on **89.46.217.9**.

Only four runtime source files differ from the preceding deployed snapshot:
`personal-shell.tsx`, `midnight.css`, `kahroba/components/lobby.tsx` and
`kahroba/components/lobby.css`. Explicit screen attributes scope personal-page
rules. Home artwork shares the remaining height with six original game cards and
the fixed dock. Settings/profile retain all fields and actions; short displays
place appearance/language side by side. Coup entry artwork adjusts its height.
Kahroba's inner lobby consumes the outer shell's remaining height, instead of
adding another viewport; home/create/search decorations adapt and room spacing
is reduced. Capacity/visibility labels stay readable on separate lines.

Continuous tutorials, extra cards, room members, long names, invitation links,
error notices, enlarged text and keyboard states keep natural scrolling. No
content is removed, paginated, globally scaled or clipped to force a fit. Native
safe-area and launch presentation behavior remain. The table, its styles, action
sheets and game rules are byte-identical to the prior release. Image optimization,
compression, caching, security headers and admission remain.
See [the page-by-page review](../design/natural-page-layout.md).

## Identity

- Activated at `2026-10-24T00:22:33.869484+00:00`.
- Source snapshot: `c2d1de6302e98a005116942ee0611faf43c9fba4`.
- Source archive SHA-256: `248be1503143af0b31fc0b0d7627b06fc63a0e4879f909da77cf98a0b5d780e9`.
- Build input SHA-256: `a6482dffd1184b25517544d3e7248b14418e22cd917f8c28d7d59385335419d0`.
- Web image: `hambazi-natural/web:20261024-a6482dffd1184b25@sha256:66b833fc24af2b0e7362182237a1a205642fd88768961509e38b6f986002083a`.
- Parent: the qualified original-layout restoration Web image.
- Observed security deadline: `2026-10-24T19:15:43Z`; future renewal may advance it.

The isolated source snapshot includes existing local changes without moving the
working branch or staging index. Frozen offline installation, uncached production
build and production-boundary validation passed. The public inventory contains
51 files; secret scanning returned zero findings. Fresh exact-image scans passed
for all six candidate/active roles and the Web rollback image. The candidate
passed an isolated nonroot, read-only readiness/static-cache probe. There is no
new runtime package, infrastructure patch, migration, API or engine change.

## Verification

- Web typecheck, scoped lint, formatting, architecture and 124 unit tests passed.
- 112 distinct Midnight browser cases are covered in Chromium/WebKit. The full
  run passed 102; old shell-padding assertions were updated to inspect the actual
  reserved content inset, and a banner edge case was corrected. All 20 affected
  page/native/font cases passed the final focused rerun.
- All 102 Kahroba browser cases passed. Final capacity/visibility text arrangement
  received focused follow-up checks; a small-screen spacing correction passed
  both final 320×568 cases. No table tests were rewritten to accept a new layout.
- Six independent before/after table geometry comparisons (320×568, 390×844 and
  768×1024 in both engines) are identical. Game component, table stylesheet,
  action-sheet and dialog sources also match the previous release byte for byte.
- New page checks include 320×568, 390×844, 768×1024 and 1280×720, native insets,
  extra game cards, full rosters, invite content, text enlargement and keyboard
  access. Controls and artwork bounds are checked in addition to document size.
- Exact production-candidate and postdeployment HTTPS checks passed in both
  browsers: 30 short-page/size checks at 320×568, 390×844 and 1280×720 have zero
  horizontal or vertical overflow. They open settings/profile and Kahroba
  home/create/help/settings; Coup entry is checked when server availability
  permits it. No rooms, games, messages or profile mutations are created.
- Real HTTPS checks confirm authenticated WSS, no-store HTML, Brotli/immutable
  bundles, ETag/304, unauthenticated profile 401, clean launch URLs, memory-only
  credentials and zero fatal browser errors.

## Activation

Zero nonterminal matches were observed before activation and after maintenance
drain. A private custom PostgreSQL backup was created and its archive listing
verified; no restore rehearsal or offsite backup is claimed. Only Web was
recreated. API/Worker/Bot were drained and restarted with their exact existing
containers; PostgreSQL/Redis image/container identities and durable volume remain.
No ingress, credential, admission or database configuration changed. Strict
readiness, exact identity/file binding and both security timers passed after
activation. Rollback material is retained; rollback was not required.

Native Telegram device acceptance, live multiplayer play-to-finish and load/soak
are separate. The existing Vite bundle-size advisory remains; this change adds
only scoped layout CSS and route-state classes.

Current pins and per-role source bindings are in
[deployment.json](../../infra/docker/server/deployment.json) and
[compose.yaml](../../infra/docker/server/compose.yaml). Private release evidence is
under `/opt/hambazi/releases/natural-layout-20261024`; local evidence is under
`/home/mehdi/.cache/hambazi-natural-layout-20261024`.
