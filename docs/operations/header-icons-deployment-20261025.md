# Main lobby header icons — 2026-10-25

Published at <https://staging.hambazi.top/> on `2026-10-25T08:36:03.901485+00:00`.
The settings and notification buttons in the main lobby now show their icons
without a border, background or box shadow. Existing hit areas, accessibility
labels, keyboard focus and button behavior are preserved. No server contract,
assets, migration or native presentation behavior changed.

## Release identity

- Source snapshot: `c5229ead1631333015dc6e9e96aa8c0d30adbd6b`.
- Source archive SHA-256: `b0de5dd016dc215b4ddfbcfe7e2aefb865ed15854fb45724ef3e43806eac48a8`.
- Build input SHA-256: `3e1da9c675c0f176f3be6f6c7b58270d3474698291c6660fabf9cae76b36f4c5`.
- Web image: `hambazi-header-icons/web:20261025-3e1da9c675c0f176@sha256:98f2488faf1b369604529d514b51d53617f59330e407ccc32313f2f213c33998`.
- Parent: `hambazi-desktop-window/web:20261025-4a2155e1de61e253@sha256:a2035ab3341cdaa6bd6953fc4ba305d8b167705a15d429ac11ffea6db1f94dc6`.
- Observed security deadline: `2026-10-26T07:10:41Z`; renewal may advance it.

## Verification

Formatting, frozen offline installation and isolated uncached production build
passed. Exact production-candidate and deployed HTTPS checks passed in Chromium
and WebKit. Both header buttons have zero border, transparent background, no
background image or shadow and retain at least 44px hit areas. Icons decode and
screenshots were inspected. Settings navigation remains usable.
The existing Vite bundle-size advisory remains.

Regression checks covered browser welcome, no guest authentication, extended
loading at three sizes, reduced motion, header absence during launch, eight game
cards and future covers, fixed chrome and internal catalog scrolling, fitted
settings/profile/Coup entry/Kahroba lobbies, authenticated WSS, desktop windowed
presentation and the 430px portrait frame. No fatal page errors or credential
storage were observed. No live room, match, message or profile was mutated.
Native Telegram acceptance is not claimed.

Public payload secret scanning found zero secrets. Browser policy, Web server,
ingress and lockfile are unchanged. Readiness, no-store HTML, immutable images,
Brotli assets and ETag/304 checks passed. Fresh scans passed for all six exact
role pins and the previous Web rollback image under the existing policy.

## Activation

Zero nonterminal matches were verified before and after maintenance drain.
A private PostgreSQL custom backup and archive listing were verified; no restore
rehearsal is claimed. Only Web was recreated. Backend containers restarted with
the same image/container identities. Data services, durable volume, admission,
secrets, TLS, ingress and non-image Compose settings were preserved. No migration
was required. Private readiness, actual security binding and both security timers
passed after activation.

Current pins: [deployment.json](../../infra/docker/server/deployment.json) and
[compose.yaml](../../infra/docker/server/compose.yaml).
Private evidence: `/opt/hambazi/releases/header-icons-20261025` and
`/home/mehdi/.cache/hambazi-header-icons-20261025`.

A concurrent local commit advanced checkout HEAD during deployment. Its application sources were verified identical to the deployed snapshot; the checkout and index were preserved. Private evidence records both HEAD values.
