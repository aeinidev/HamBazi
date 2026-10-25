# Desktop window presentation — 2026-10-25

Published at <https://staging.hambazi.top/> on `2026-10-25T08:21:09.205245+00:00`.
Automatic native expansion/fullscreen/swipe control now applies only to mobile
Telegram platforms. Non-mobile clients keep their normal window and request exit
once when already fullscreen and supported. Wide desktop browser windows use a
centered 430px content frame for loading, welcome, pages, navigation and backdrops.
Native outer window dimensions remain controlled by Telegram. Mobile presentation
and the existing three-second loading/readiness/transition gates are preserved.
No server contract or migration changed.

## Release identity

- Source snapshot: `836a231559c596ee5c58c568200688692248132f`.
- Source archive SHA-256: `03e9f2d91eb85f65b5c121634c3e7919d5eda3b6e228d950363dbb344fc30474`.
- Build input SHA-256: `4a2155e1de61e2533fa5e1609c29daec44825368e96318898b4033e7c1d2bca4`.
- Web image: `hambazi-desktop-window/web:20261025-4a2155e1de61e253@sha256:a2035ab3341cdaa6bd6953fc4ba305d8b167705a15d429ac11ffea6db1f94dc6`.
- Parent: `hambazi-extended-loading/web:20261025-f3ce3a1b0dd8eec3@sha256:00586adaa8a812e2e190a6c321f4a5fc4ae8f80165519705fb9adc273f5886c1`.
- Observed security deadline: `2026-10-26T07:10:41Z`; renewal may advance it.

## Verification

Scoped TypeScript, ESLint, formatting, frozen offline installation and isolated
uncached production build passed. 44 related unit tests passed; 12 browser tests
passed in Chromium/WebKit covering desktop/macOS presentation, 430px frame,
viewport resize, fixed controls, catalog scrolling, settings/profile, welcome
and mobile capability versions. The three existing owner-staging static-render
unit failures reproduce in the previous isolated release; see the design note.
The existing Vite bundle-size advisory remains.

Exact production candidate and deployed HTTPS checks passed in both browsers:
authenticated desktop launch sends no expansion/fullscreen request, loading and
home use the 430px frame and the dock remains inside it. The desktop welcome page
fits, including its bot link, with no guest authentication attempt.
Mobile launch regression covers extended loading at three sizes, reduced motion,
header absence, eight game cards, future covers, fixed chrome and internal catalog
scrolling, fitted settings/profile/Coup entry/Kahroba lobbies and authenticated WSS.
Deployed timing: chromium: desktop loader 3935 ms, departure 367 ms; webkit: desktop loader 3736 ms, departure 368 ms.

No fatal page errors or credential storage were observed. No live room, match,
message or profile was mutated. Browser tests use the real pinned SDK; native
Telegram desktop/mobile client acceptance is not claimed.

Public payload secret scanning found zero secrets. Browser policy, Web server,
ingress and lockfile are unchanged. Readiness, no-store HTML, immutable image and
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
Private evidence: `/opt/hambazi/releases/desktop-window-20261025` and
`/home/mehdi/.cache/hambazi-desktop-window-20261025`.
Design: [desktop window behavior and known test failures](../design/desktop-window.md).
