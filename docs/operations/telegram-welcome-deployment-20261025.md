# Fantasy Telegram welcome page — 2026-10-25

Published at <https://staging.hambazi.top/> on `2026-10-25T07:47:33.922716+00:00`.
Browser entry without Telegram launch data now displays a responsive fantasy
welcome page, reusing the optimized tabletop artwork. Persian guidance explains
how to open the existing bot and press Open; the CTA targets
`https://t.me/Hambazidev_bot` with `noopener noreferrer`. Expired sessions receive
renewal guidance. Registration, authenticated entry, error/retry and the existing
minimum launch duration remain unchanged. No server contract or migration changed.

## Release identity

- Source snapshot: `7e0e0ce8fd05ab0ebf7e6a58eeb9294112cb0cac`.
- Source archive SHA-256: `b5e92f644134ecceb06eaf237f3e59d0c8ad1cb87114f084936e7e9d0d1703be`.
- Build input SHA-256: `47c05a76f95e4bcdc20ed1c6624d8d8e56dcb37b5794ce574ee8e1e9015e68ab`.
- Web image: `hambazi-telegram-welcome/web:20261025-47c05a76f95e4bcd@sha256:caabd2ae0b03cd7b5034a8aedf79d8368435cbba85ab08a17418d68d1a7899a3`.
- Parent: `hambazi-tabletop-loading/web:20261025-2dea1cb8a1f9d79c@sha256:378507d282160d47ad5cc64035ed2bf9385ca9b6d10d64b30d8d7abe1c6ca8a8`.
- Observed security deadline: `2026-10-26T07:10:41Z`; renewal may advance it.

## Verification

Eight implementation browser tests passed in Chromium/WebKit, covering browser
entry, no attempted guest authentication, image decoding, viewport fitting,
keyboard focus and accessibility, plus auth/profile error retry and minimum
loading timing. Scoped TypeScript, ESLint, formatting, frozen offline installation
and an isolated uncached production build passed. The existing Vite bundle-size
advisory remains.

Exact production-candidate and deployed HTTPS checks passed in both browsers.
The welcome page and bot link fit 320×568, 390×844, 844×320 and 1280×720 without
page scrolling. No guest auth request was sent. Authenticated regression checks
cover the loader, reduced motion, eight game cards, UNO/Battleship covers, fixed
chrome, inner catalog scrolling, fitted settings/profile/Kahroba lobbies and WSS.
Deployed timing: chromium: loader 3802 ms, departure 365 ms; webkit: loader 3765 ms, departure 367 ms. No fatal page errors or credential storage were observed.
No live room, match, message or profile was mutated; no message was sent to the
bot. Native Telegram acceptance is not claimed.

Public payload secret scanning found zero secrets. Browser policy, Web server,
ingress and lockfile are unchanged. The image passed readiness, no-store HTML,
immutable Brotli assets and ETag/304 smoke checks. Fresh scans passed for the six
role pins and the previous Web rollback image under the existing policy.

## Activation

The first maintenance attempt rejected a nonzero API shutdown exit and restored
the previous application pins. Security binding and readiness were reverified.
A subsequent bounded attempt drained all applications cleanly and completed
activation. No shutdown/security check was bypassed or weakened; the initial
failure and rollback evidence remain in the private release directory.

Zero nonterminal matches were verified before and after maintenance drain. A
private PostgreSQL custom backup and its archive listing were verified; no restore
rehearsal is claimed. Only Web was recreated. Backend containers restarted with
the same image/container identities. Data services, durable volume, admission,
secrets, TLS, ingress and non-image Compose settings were preserved. No migration
was required. Private readiness, actual security binding and both security timers
passed after activation.

Current pins: [deployment.json](../../infra/docker/server/deployment.json) and
[compose.yaml](../../infra/docker/server/compose.yaml).
Private evidence: `/opt/hambazi/releases/telegram-welcome-20261025` and
`/home/mehdi/.cache/hambazi-telegram-welcome-20261025`.
Artwork: [provenance and prompt](../design/tabletop-loading-art.md).
