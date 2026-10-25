# Coming-soon UNO and Battleship release — 2026-10-24

Published at <https://staging.hambazi.top/> on `2026-10-24T09:45:48.140001+00:00`.
UNO and Battleship are display-only disabled cards with Persian titles and
coming-soon badges. They appear after the six existing games. Both use original
AI-generated artwork, with content-hashed 1200×660 and 600×330 WebP variants.
The compact files are 42,996 and 44,898 bytes. No playable route, engine, manifest,
backend catalog registration, rule, API contract or migration was introduced.
Only the main-lobby runtime component and four public cover files changed since
the preceding source release; tests and artwork-generation metadata accompany them.

## Release identity

- Source snapshot: `38404ee2a83377704400a5d4b0ab7e4b81ed738d`.
- Source archive SHA-256: `8e7fec8c5682c6caf3ea01585b2ed84d3673f1338de77273fb6883ada4624208`.
- Build input SHA-256: `d702b2bf41b4f2585c4538419df5c57f258c2bf1257a083102b45ac3f467f1c1`.
- Web image: `hambazi-future-games/web:20261024-d702b2bf41b4f258@sha256:e367b11d64a433107e111932a92f99b9148073768a09db10f12fadcf95b06af4`.
- Parent: `hambazi-home-list/web:20261024-c3e6cabe6c75b356@sha256:86a2e87cfcf309ea14cd0049c66b0007642007c00ffad84998540811ebd04b3f`.
- Observed security deadline: `2026-10-25T07:11:13Z`; automatic renewal may advance it.

## Verification and activation

The scoped Web build, TypeScript and ESLint checks passed during implementation;
10 browser tests passed in Chromium and WebKit for the eight-card catalog,
coming-soon gating, image decode, fixed heading, document lock and internal scroll.
A frozen offline installation and fresh production build from an isolated source
snapshot passed. The public payload secret scan found zero secrets. Existing Vite
bundle-size advisory remains. The exact candidate image passed static cache and
private readiness smoke checks. Fresh scans passed for all six role pins and the
previous Web rollback image under the existing finite-expiry security policy.

Exact production-candidate and deployed HTTPS verification passed in Chromium and
WebKit at 320×568, 390×844 and 1280×720. Both new cards remain disabled and labelled
coming soon, their covers decode, and the inner list reaches them while the page
chrome remains stationary. Existing profile/settings/Kahroba lobby fits,
authenticated WSS, root lock, directional touch cancellation, HTML no-store,
immutable Brotli assets, ETag/304, unauthenticated profile 401, clean launch URLs
and credential-storage checks passed with no fatal errors. No live room, match,
message or profile was mutated by these checks. Native Telegram acceptance is
not claimed by headless checks.

Zero nonterminal matches were verified before and after maintenance drain.
A private PostgreSQL custom backup and archive listing were verified; no restore
rehearsal is claimed. Only Web was recreated. API/Bot/Worker containers were
restarted after draining; their identities and image pins remain unchanged.
PostgreSQL/Redis containers, durable data volume, secrets, admission, TLS,
ingress and non-image Compose settings were preserved. Private readiness,
security identity binding and both security timers passed after activation.

Current image pins are in [deployment.json](../../infra/docker/server/deployment.json)
and [compose.yaml](../../infra/docker/server/compose.yaml).
Private evidence: `/opt/hambazi/releases/future-games-20261024` and
`/home/mehdi/.cache/hambazi-future-games-20261024`.
Artwork prompts and paths: [future-game-covers.json](../design/future-game-covers.json).
