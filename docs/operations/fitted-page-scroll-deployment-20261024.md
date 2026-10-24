# Fitted-page touch boundary deployment — 2026-10-24

The owner requested that the recently fitted pages stay stationary under touch,
without revealing the surrounding black frame. Additional content must continue
to scroll. The release is live at <https://staging.hambazi.top/> on **89.46.217.9**.

The opt-in hook measures a page and document against the visible viewport before
applying root/body overflow and overscroll suppression. Its non-passive touch-move
fallback cancels vertical elastic movement while permitting directional nested
sheet scrolling. Inputs, native pickers, text selection, taps, horizontal gestures
and multitouch zoom remain available. Content/size/font/image/focus/visual-viewport
updates release the lock if needed; shrinking content can restore it. Sibling
notices are included in change observation. Cleanup restores the normal document
on tutorial/game routes and unmount. Existing dialog-owned body styles are retained.

Only short personal pages and Kahroba lobby/search/waiting components opt in. The
Kahroba table, its CSS, action sheets and dialog sources are byte-identical to the
previous deployment. Layouts, assets, native launch behavior, backend, admission,
rules and contracts are unchanged. See [the design](../design/fitted-page-scroll.md).

## Release identity

- Activated at `2026-10-24T00:37:24.055806+00:00`.
- Source snapshot: `31f66aba648cdfbe35e1f27d02e1adb19332ac6c`.
- Source archive SHA-256: `a058347cb226191d6d12d2070e43886d6fa9d527b23466ba88b748a4e3d5e8c3`.
- Build input SHA-256: `b876378ada9520ed77a5fe49dfe416c6ce055ac2fed50e2bfc15255851fcf1ab`.
- Web image: `hambazi-fixed/web:20261024-b876378ada9520ed@sha256:5b901d0e1a38315907161c6969a4032542c3d67bc85636f0f9208d1fa3692f86`.
- Parent: the qualified content-aware page-layout Web image.
- Observed security deadline: `2026-10-24T19:15:43Z`; future renewal may advance it.

Frozen offline installation and an uncached production build passed. The isolated
source snapshot preserves existing local work without moving the working branch
or staging index. The 51-file public payload has zero secret-scan findings.
The exact image passed an isolated nonroot/read-only readiness and static-cache
probe. Fresh scans passed for all six role pins and the Web rollback image under
the existing policy. No dependency, database migration or infrastructure patch
was introduced. The existing Vite bundle-size advisory remains.

## Verification

- Web typecheck, scoped lint, formatting, architecture and 124 unit tests passed.
- All 116 Midnight and 104 Kahroba browser tests passed in Chromium and WebKit.
  Final focused follow-ups exercise the expanded document-observation boundary.
- Gesture checks verify vertical cancellation on fitted pages, unaffected taps,
  fields/pinch/horizontal movement, natural tutorial/overflow scrolling, content
  growth/removal, smaller keyboard-sized viewports, long-help directional scroll,
  containment at sheet boundaries, dialog cleanup and return to the unchanged game.
- Exact production-candidate and postdeployment HTTPS checks passed in both engines
  at 320×568, 390×844 and 1280×720: 30 short-page/size checks verify fit and touch
  cancellation. Temporary DOM-only extra content releases the lock; removal
  restores it. No room/game/message creation or profile mutation is performed.
- Real HTTPS also verifies authenticated WSS, no-store HTML, Brotli/immutable JS/CSS,
  ETag/304, profile 401 without credentials, clean launch URLs, memory-only
  credentials and zero fatal errors.

Headless browser tests verify cancellation and scroll behavior; they do not
reproduce native iOS rubber-band pixels. Physical Telegram device acceptance is
not claimed. Full live multiplayer play-to-finish and load/soak remain separate.

## Activation

Zero nonterminal matches were verified before cutover and after maintenance drain.
A private PostgreSQL custom backup archive was created and its listing verified;
no restore rehearsal or offsite backup is claimed. Only Web was recreated.
API/Worker/Bot were drained and restarted using their existing exact containers;
PostgreSQL/Redis pins, identities, durable storage, admission, credentials, TLS and
ingress remain. Strict readiness, identity/file binding and both security timers
passed after activation. Rollback evidence remains; rollback was not required.

Current image pins and source identities are in
[deployment.json](../../infra/docker/server/deployment.json) and
[compose.yaml](../../infra/docker/server/compose.yaml). Private release evidence is
under `/opt/hambazi/releases/fixed-scroll-20261024`; local evidence is under
`/home/mehdi/.cache/hambazi-fixed-scroll-20261024`.
