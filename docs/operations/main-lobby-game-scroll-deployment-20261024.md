# Main lobby game-list deployment — 2026-10-24

**Published** at <https://staging.hambazi.top/> on `2026-10-24T09:04:39.839977+00:00`.
The header, banner, section heading and bottom navigation remain stationary;
only the two-column catalog scrolls as more games are added. Three rows use the
available list height with a 72px card minimum. Telegram safe areas can reduce
the visible list to one row. The named focusable region supports keyboard scrolling
and contains directional touch movement at its edges. Existing accessibility
fallbacks for outside notices and keyboard/zoom states remain available.
See [the design](../design/main-lobby-game-scroll.md).

## Resolved publication blocker

The earlier candidate stopped before cutover because fresh scans identified
`CVE-2023-54404` (HIGH) in `zod` 4.6.2 in API/Bot/Worker. This release updates all
nine repository pins and the lockfile to 4.6.6, without unrelated dependency changes.
The official npm tarball's SHA-512 integrity and registry ECDSA signature were
verified before use. Its SHA-256 is `312553620ac82cbb25d505100fbb41c1e219b3cd6979cf93c3a1b4dd5b79e039`.

Backend derivative images use the exact previous role pins as parents. The patch
updates only Zod, its symlinks and dependency manifests/lockfiles; image-build
checks verify every other regular file unchanged. Per-image records include
unchanged application/runtime file counts and aggregate hashes. Application
runtime code, configuration, database migrations and Kahroba rules are unchanged.
The Web candidate is rebuilt with the same security patch and the approved lobby.
No vulnerability was ignored and the existing security policy was not relaxed.

## Release identity

- Source snapshot: `72a942e7bde1979c0b0f04dfc5915c2861325b35`.
- Source archive SHA-256: `90ab2d70069e53ba4777222190f7ef1a023c7ca655d412c6adca34be71c1682c`.
- Web build input SHA-256: `c3e6cabe6c75b35618ce18a4a83de93f5eda565e4e47a37992d57fc7a513cb11`.
- Observed security deadline: `2026-10-25T07:11:13Z`; renewal may advance it.

- web: `hambazi-home-list/web:20261024-c3e6cabe6c75b356@sha256:86a2e87cfcf309ea14cd0049c66b0007642007c00ffad84998540811ebd04b3f`
- api: `hambazi-security/api:20261024-zod466-026b1f826a9c@sha256:0c500843ddda1359451e410db6e93df8cee7c99aa359afb8aac495e6deeb558a`
- bot: `hambazi-security/bot:20261024-zod466-026b1f826a9c@sha256:a92fcbfdeec4e754d90bdf75f9884e6916bdba147520650a1d271fbec92263cc`
- worker: `hambazi-security/worker:20261024-zod466-026b1f826a9c@sha256:5ae0219afa0a9912729990789f9fb2739d6e883e6b37b9f1e06036730d7dd783`

## Validation

1773 service/config/validation/engine unit tests, 124 Web unit tests, 41 Bot
integration tests, affected workspace typechecks, production builds, architecture,
formatting and API/event compatibility checks passed. Integration evidence from
the disposable PostgreSQL/Redis harness is recorded in the private verification
file. All 17 API integration suites passed (246 tests) using a 30-second local
I/O test budget with unchanged assertions, after initial five-second timeouts.
The complete real runtime harness passed 10 API/browser lifecycle tests and three
Worker recovery/result tests. A larger shared-inventory run later did not complete
the Worker Redis-recovery publication poll within its existing 10-second window;
this same Worker suite passed in the separate runtime harness. The final focused
Kahroba inventory also passed (17 database, 11 API and three Worker tests) using
a correctly seeded fresh database with unchanged assertions. A fresh Worker-only
probe without API game seeding refused its room fixture and is not counted as
coverage. Bare API/Worker integration invocations also first refused to run without
the required isolated environment. No shared or server database was used for tests.
The Web's previously passed 124 Midnight and 104 Kahroba browser cases and final
24-case layout/touch follow-up remain the layout baseline.

The exact new production candidate and postdeployment HTTPS checks passed in
Chromium and WebKit at 320×568, 390×844 and 1280×720. Eighteen temporary DOM-only
cards retain the root lock and stationary chrome while the list reaches its last
row. Authenticated WSS, short page fits, HTML no-store, immutable Brotli assets,
ETag/304, unauthenticated profile 401, clean launch URLs, no credential storage
and zero fatal errors passed. No live room, match, message or profile was mutated.
Native Telegram/iOS rubber-band pixels are not claimed by headless checks.

The 51-file public payload has zero secret findings. Image readiness/static-cache
probes passed. Fresh official advisory scans passed for all six candidate role
pins. The rollback combination uses the same patched backend roles with the
previous Web image and also passed; vulnerable backend parents are not a rollback
option. The normal finite expiry and automatic renewal remain enforced.

## Activation and preservation

Zero nonterminal matches were verified before cutover and after maintenance drain.
A private PostgreSQL custom archive and archive listing were verified; no restore
rehearsal is claimed. Worker/API/Bot/Web were recreated in readiness order.
PostgreSQL/Redis image/container identities, durable volume, admission, credentials,
TLS, ingress and all non-image Compose settings were preserved. No migration was
required. Strict readiness, actual container/file security binding and both timers
passed after activation. A currently qualified rollback remains available.

Current pins are in [deployment.json](../../infra/docker/server/deployment.json)
and [compose.yaml](../../infra/docker/server/compose.yaml). Private evidence is in
`/opt/hambazi/releases/home-game-list-publish-20261024` and
`/home/mehdi/.cache/hambazi-home-game-list-publish-20261024`. The previous blocked
candidate evidence remains under the earlier `home-game-list-20261024` directories.
