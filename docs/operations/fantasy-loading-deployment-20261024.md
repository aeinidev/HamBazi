# Fantasy launch screen release — 2026-10-24

Published at <https://staging.hambazi.top/> on `2026-10-24T11:34:51.671727+00:00`.
The shared launch loader now has inline SVG cards, a gem and a die, a cyan/gold
orbit, a star field and indeterminate progress. Its responsive layout includes
short landscape screens, Telegram safe areas and reduced-motion styling.
No image download, dependency, artificial loading duration or gameplay change
was added. Authentication/profile readiness still controls immediate removal.
Only loading.tsx and launch.css changed in runtime source since the previous Web.

## Release identity

- Source snapshot: `cbe7a444ed09c593224e47bbe165c00285a38d3e`.
- Source archive SHA-256: `22b518ce04d65a973efb57b946d7ee59a3e291a5842b12a2afc88186f4aa7f74`.
- Build input SHA-256: `0cd00a0ec0b6e0dce8cd4af14e017d7d077e22a9b562b2d486df9604ad1a4e76`.
- Web image: `hambazi-fantasy-loading/web:20261024-0cd00a0ec0b6e0dc@sha256:aaa806738dd9ca89592a15cfbd85b2012b2bc1cf0c3a17a6ab419ed278189eeb`.
- Parent: `hambazi-future-games/web:20261024-d702b2bf41b4f258@sha256:e367b11d64a433107e111932a92f99b9148073768a09db10f12fadcf95b06af4`.
- Observed security deadline: `2026-10-25T07:11:13Z`; automatic renewal may advance it.

## Verification

Scoped Web build, TypeScript, ESLint and six Chromium/WebKit browser tests passed
in implementation. These cover auth/profile transitions, failure/retry,
320×568, 390×844, 844×320, content/footer separation and reduced motion.
A frozen offline installation and fresh isolated production build passed.
The public payload scan found zero secrets. Existing Vite bundle-size advisory
remains. Browser policy, Web server, lockfile and ingress hashes match the previous
release. The candidate image passed readiness/static-cache smoke checks. Fresh
scans passed for all six role pins and the prior Web rollback image under the
existing finite-expiry policy.

Exact production-candidate and deployed HTTPS tests passed in Chromium and WebKit.
A held authentication request exposes the actual loader for responsive geometry,
screenshots and reduced-motion checks, then releases into the normal lobby.
Regression checks cover eight game cards, disabled UNO/Battleship covers,
fixed chrome and inner scrolling, profile/settings/Kahroba lobbies,
authenticated WSS, HTML no-store, immutable Brotli assets, ETag/304,
unauthenticated profile 401, clean launch URLs and no credential storage.
No live room, match, message or profile was mutated; no fatal page errors occurred.
Native Telegram acceptance is not claimed by headless checks.

## Activation

Zero nonterminal matches were checked before and after maintenance drain.
A private PostgreSQL custom backup and archive listing were verified; no restore
rehearsal is claimed. Only Web was recreated. Backend containers were drained and
restarted with the same identities and pins. Data services, durable volume,
credentials, admission, TLS, ingress and non-image Compose settings remain.
Private readiness, actual security identity binding and both security timers
passed after activation. No migration was needed.

Current pins: [deployment.json](../../infra/docker/server/deployment.json) and
[compose.yaml](../../infra/docker/server/compose.yaml).
Private evidence: `/opt/hambazi/releases/fantasy-loading-20261024` and
`/home/mehdi/.cache/hambazi-fantasy-loading-20261024`.
See [the design](../design/fantasy-loading.md).
