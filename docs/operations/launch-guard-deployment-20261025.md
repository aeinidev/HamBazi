# Launch header and minimum loading duration — 2026-10-25

Published at <https://staging.hambazi.top/> on `2026-10-24T21:50:31.247698+00:00`.
The personal shell no longer mounts its brand/settings header during guest
authentication. Its header appears with the authenticated screen. The launch
loader remains visible for at least 3000 ms from shell mount. Auth/profile
requests run concurrently, with a single timer across both phases. Slower
requests still block entry, and failures retain retry. Unmount clears the timer.
Only personal-shell.tsx and the loading component documentation comment changed
in runtime source since the previous Web release. No dependency, game rule,
server runtime, API contract or migration changed.

## Release identity

- Source snapshot: `155f13b11885e9b1db3a52846a36acb2639deb59`.
- Source archive SHA-256: `f00d3bf17a2552a6d926b7239e3937f16f7b9032687b856414ccbf5943609b4a`.
- Build input SHA-256: `1189c4d5f40cf6df32cd857919232e79a23912c694093c35381825a466555478`.
- Web image: `hambazi-launch-guard/web:20261025-1189c4d5f40cf6df@sha256:fc1e185eb0b6abf86e59816c4b45a28e2853620a50c5e18a4fcd4f7db1db846a`.
- Parent: `hambazi-fantasy-loading/web:20261024-0cd00a0ec0b6e0dc@sha256:aaa806738dd9ca89592a15cfbd85b2012b2bc1cf0c3a17a6ab419ed278189eeb`.
- Observed security deadline: `2026-10-25T19:09:13Z`; renewal may advance it.

## Verification

Scoped build, TypeScript, ESLint and eight Chromium/WebKit browser tests passed
in implementation, covering fast-response minimum loading time, absent headers
during authentication/profile loading, retry, responsive geometry and reduced
motion. Frozen offline installation and an uncached isolated production build
passed. Public payload secret scan found zero secrets. The existing Vite bundle
size advisory remains. Browser policy, Web server, ingress and lockfile hashes
match the prior release. The candidate image passed readiness and static-cache
smoke probes. Fresh scans passed for all six role pins and the prior Web rollback
image under the existing finite-expiry security policy.

Exact production-candidate and deployed HTTPS checks passed in Chromium/WebKit.
Held authentication verifies no header/settings control overlaps the loader at
320×568, 390×844 and 844×320, including reduced motion. A fresh fast login measures
loader visibility for the minimum interval and confirms the header returns with
the ready lobby. Timings are recorded in the private browser reports. Regression
checks cover eight cards, UNO/Battleship covers, fixed chrome and inner catalog
scrolling, fitted profile/settings/Kahroba lobbies, authenticated WSS, no-store
HTML, immutable Brotli assets, ETag/304, unauthenticated profile 401, clean launch
URLs, no credential storage and zero fatal page errors. No live room, match,
message or profile was mutated. Native Telegram acceptance is not claimed.

## Activation

Zero nonterminal matches were checked before and after maintenance drain. A
private PostgreSQL custom backup and archive listing were verified; no restore
rehearsal is claimed. Only Web was recreated. Backend containers were drained and
restarted with their original identities and image pins. Data services, durable
volume, secrets, admission, TLS, ingress and non-image Compose settings remain.
Private readiness, actual security binding and both security timers passed after
activation. No migration was needed.

Current pins: [deployment.json](../../infra/docker/server/deployment.json) and
[compose.yaml](../../infra/docker/server/compose.yaml).
Private evidence: `/opt/hambazi/releases/launch-guard-20261025` and
`/home/mehdi/.cache/hambazi-launch-guard-20261025`.
See [the design](../design/fantasy-loading.md).
