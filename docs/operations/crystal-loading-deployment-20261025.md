# Crystal loading and lobby transition — 2026-10-25

Published at <https://staging.hambazi.top/> on `2026-10-24T22:21:50.641742+00:00`.
The pre-JavaScript HTML and React loader now use matching inline crystal artwork,
local typography, restrained cyan/gold accents and a responsive dark background.
The minimum launch duration remains 3000 ms with authentication/profile readiness
gates and retry. The loader departs over 360 ms before mounting the lobby; the
lobby fades in over 480 ms. Reduced motion disables the decorative and transition
animations. No header is mounted during loading or departure.

## Release identity

- Source snapshot: `a3ba873a920846ac30b59e42ff657c6ae85fe0dc`.
- Source archive SHA-256: `4f6bc0b9dc621ae08ba067318f5280d37305ca3e79ef329011d2319b7cab038f`.
- Build input SHA-256: `5a107914519fdbc9e8570a50f04a8667d7df25193075d5a763df840f7b36df41`.
- Web image: `hambazi-crystal-loading/web:20261025-5a107914519fdbc9@sha256:71b18cbc1449b70a73d490c5644dcd271fc6673ebd50c917b0427c57d4ebaf72`.
- Parent: `hambazi-launch-guard/web:20261025-1189c4d5f40cf6df@sha256:fc1e185eb0b6abf86e59816c4b45a28e2853620a50c5e18a4fcd4f7db1db846a`.
- Observed security deadline: `2026-10-25T19:09:13Z`; renewal may advance it.

## Verification

Fourteen implementation browser tests passed in Chromium/WebKit. Release
qualification detected that transforming the shell affected the fixed dock and
fitted-page measurement; the final arrival animates opacity only. Two additional
browser regression checks passed for minimum timing, absent headers, an untransformed
shell, fitted-page locking and a dock fully inside the viewport. Scoped TypeScript,
ESLint, formatting, frozen offline installation and an isolated uncached production
build passed. The existing Vite bundle-size advisory remains.

Exact production-candidate and deployed HTTPS checks passed in both browsers,
covering 320×568, 390×844 and horizontal loading, reduced motion, the departure
interval, eight game cards, UNO/Battleship covers, fixed chrome, inner game-list
scrolling, fitted settings/profile/Kahroba lobbies and authenticated WSS. Deployed
timing: chromium: loader 3766 ms, departure 367 ms; webkit: loader 3935 ms, departure 476 ms. No fatal page errors or credential storage were observed. No
live room, match, message or profile was mutated. Native Telegram acceptance is
not claimed.

Public payload secret scanning found zero secrets. Browser policy, Web server,
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
Private evidence: `/opt/hambazi/releases/crystal-loading-20261025` and
`/home/mehdi/.cache/hambazi-crystal-loading-20261025`.
See [the design](../design/fantasy-loading.md).
