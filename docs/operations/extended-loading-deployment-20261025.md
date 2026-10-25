# Extended fantasy loading — 2026-10-25

Published at <https://staging.hambazi.top/> on `2026-10-25T08:02:37.724542+00:00`.
The fantasy tabletop illustration now extends upward with palace and sky to the
top edge of the loading screen. The eyebrow copy was removed from both the static
HTML and React loader. The title and progress remain readable below the fading
image. Existing minimum three-second duration, readiness gates and transitions
remain in place. The Telegram welcome page uses its original image.
No server contract or migration changed.

## Release identity

- Source snapshot: `594d1c95960b8d4434e053c843813019790c6dbb`.
- Source archive SHA-256: `5cdbb651f653cc04b2472a1933c445647d0e7b76deb67749154fd0d67d0b9561`.
- Build input SHA-256: `f3ce3a1b0dd8eec377fa842c25931039c50bd43293e14e8992c7e8c251401e52`.
- Web image: `hambazi-extended-loading/web:20261025-f3ce3a1b0dd8eec3@sha256:00586adaa8a812e2e190a6c321f4a5fc4ae8f80165519705fb9adc273f5886c1`.
- Parent: `hambazi-telegram-welcome/web:20261025-47c05a76f95e4bcd@sha256:caabd2ae0b03cd7b5034a8aedf79d8368435cbba85ab08a17418d68d1a7899a3`.
- Observed security deadline: `2026-10-26T07:10:41Z`; renewal may advance it.

## Verification

Scoped TypeScript, ESLint, formatting, frozen offline installation and isolated
uncached production build passed. Four implementation browser tests passed in
Chromium/WebKit for readiness, minimum duration, transition and fixed dock.
The existing Vite bundle-size advisory remains.

Exact production candidate and deployed HTTPS checks passed in both browsers:
new extended artwork decoded at 320×568, 390×844 and 844×320; scene starts at the
top edge, eyebrow is absent, header remains hidden during loading, reduced motion
works and content fits above the footer. New immutable image delivery was checked.
Deployed timing: chromium: loader 3681 ms, departure 363 ms; webkit: loader 5266 ms, departure 369 ms.

Regression checks covered browser welcome and bot link, no guest auth requests,
eight game cards and future covers, fixed chrome, internal catalog scrolling,
settings/profile/Coup entry/Kahroba lobbies and authenticated WSS.
No fatal page errors or credential storage were observed. No live room, match,
message or profile was mutated. Native Telegram acceptance is not claimed.

Public payload secret scanning found zero secrets. Browser policy, Web server,
ingress and lockfile are unchanged. Image readiness, no-store HTML, immutable
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
Private evidence: `/opt/hambazi/releases/extended-loading-20261025` and
`/home/mehdi/.cache/hambazi-extended-loading-20261025`.
Artwork: [provenance and prompt](../design/tabletop-loading-art.md).
