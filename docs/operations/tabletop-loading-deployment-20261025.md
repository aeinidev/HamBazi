# Fantasy tabletop loading artwork — 2026-10-25

Published at <https://staging.hambazi.top/> on `2026-10-24T22:38:49.950707+00:00`.
The pre-JavaScript HTML and React loader now use matching fantasy tabletop artwork
with chess/ludo pieces, cards and dice. Two content-hashed responsive WebP assets
(96,098 and 197,234 bytes) use high fetch priority. Persian text remains HTML.
The minimum launch duration remains 3000 ms with authentication/profile readiness
gates and retry. The loader departs over 360 ms before mounting the lobby; the
lobby fades in over 480 ms. Reduced motion disables the decorative and transition
animations. No header is mounted during loading or departure.

## Release identity

- Source snapshot: `a99613be32013b0e96778812714a739269852ded`.
- Source archive SHA-256: `cfbd83bc5fc76ef4fd1903a73a0ccdd190283853ce724b0af8ace163da389e57`.
- Build input SHA-256: `2dea1cb8a1f9d79c7435fd566bb9f704731264a4ab7a3e5dee74be90cb45c555`.
- Web image: `hambazi-tabletop-loading/web:20261025-2dea1cb8a1f9d79c@sha256:378507d282160d47ad5cc64035ed2bf9385ca9b6d10d64b30d8d7abe1c6ca8a8`.
- Parent: `hambazi-crystal-loading/web:20261025-5a107914519fdbc9@sha256:71b18cbc1449b70a73d490c5644dcd271fc6673ebd50c917b0427c57d4ebaf72`.
- Observed security deadline: `2026-10-25T19:09:13Z`; renewal may advance it.

## Verification

Ten implementation browser tests passed in Chromium/WebKit, covering pre-JavaScript
loading, image decoding, responsive geometry, readiness, reduced motion and the
minimum launch timing. Scoped TypeScript, ESLint, formatting, frozen offline
installation and an isolated uncached production build passed. The existing Vite
bundle-size advisory remains.

Exact production-candidate and deployed HTTPS checks passed in both browsers,
covering 320×568, 390×844 and horizontal loading, image decoding and immutable image delivery, reduced motion, the departure
interval, eight game cards, UNO/Battleship covers, fixed chrome, inner game-list
scrolling, fitted settings/profile/Kahroba lobbies and authenticated WSS. Deployed
timing: chromium: loader 3733 ms, departure 365 ms; webkit: loader 3829 ms, departure 367 ms. No fatal page errors or credential storage were observed. No
live room, match, message or profile was mutated. Native Telegram acceptance is
not claimed.

An initial repeated-login verification received HTTP 429 from the existing auth
rate limiter. Verification was repeated after cooldown without changing server
limits. Public payload secret scanning found zero secrets. Browser policy, Web server,
ingress and lockfile remain unchanged. The image passed readiness, no-store HTML,
immutable Brotli assets and ETag/304 smoke checks. Fresh scans passed for the six
active role pins and the previous Web rollback image under the existing policy.

## Activation

Zero nonterminal matches were verified before and after maintenance drain. A
private PostgreSQL custom backup and its archive listing were verified; no restore
rehearsal is claimed. Only Web was recreated. Backend containers restarted with
the same image/container identities. Data services, durable volume, admission,
secrets, TLS, ingress and non-image Compose settings were preserved. No migration
was required. Private readiness, actual security binding and both security timers
passed after activation.

Current pins: [deployment.json](../../infra/docker/server/deployment.json) and
[compose.yaml](../../infra/docker/server/compose.yaml).
Private evidence: `/opt/hambazi/releases/tabletop-loading-20261025` and
`/home/mehdi/.cache/hambazi-tabletop-loading-20261025`.
See [art provenance and prompt](../design/tabletop-loading-art.md).
