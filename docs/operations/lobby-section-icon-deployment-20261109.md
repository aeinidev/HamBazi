# Lobby section icon deployment — 2026-11-09

Published at <https://staging.hambazi.top/> at `2026-11-09T12:27:27.026734+00:00`.
The heading below the banner reuses the bottom navigation's games icon at 32×32px.
The existing atlas, decorative accessibility semantics and all navigation remain.

- Source snapshot: `6bfa80d13899ae41387095178e349d5b9cfc888b`.
- Source archive SHA-256: `2df90c5d30f47f6809bc291b63ecc4b1ad64ade352020be95ef0d5263bc49764`.
- Build input SHA-256: `e83ab2bb5cc338a414c3bd037f6f4de209643f7d065658afc8f002a911b9e21e`.
- Web image: `hambazi-section-icon/web:20261109-e83ab2bb5cc338a4@sha256:185263e45c72992b3639948d48d54d72ee9f8152bb99660f0fc47525addf9822`.
- Exact active parent: `hambazi-candidate/web:c7add7bf7b32e77b153abc6ebb411d4954e4a668-5161e94f91139e1a@sha256:a9a375113e3db3d745c6ef00a42ef695d2bea0678f2fa65954dd1060053aa2a6`.

Web source, contracts and lockfile were checked against the deployed Phase 3
revision before building; the Web change consists only of the icon substitution
and its scoped dimensions. No Phase 4 backend/Admin code or database migration
was published. The working branch and staging index were preserved.

Frozen offline installation, production build, typecheck, scoped lint and
formatting passed. Chromium and WebKit each verified the exact candidate and
live HTTPS at 320, 390 and 1280px: the heading and dock share the same decoded
atlas cell, the heading is 32px and smaller than the dock, with no horizontal
overflow, fatal errors or credential storage. Live HTML/bundle identities,
no-store HTML and Brotli delivery passed. Screenshots were inspected.

Public payload scanning found zero secrets. Fresh scans of all six exact current
role pins and rollback Web passed the unchanged security policy. The isolated
candidate image passed nonroot/read-only readiness and static delivery probes.

Zero nonterminal matches were verified before and after the existing maintenance
drain. Only Web was recreated; the other application containers restarted with
the same IDs/images. Data services, volumes, admission, ingress and Admin controls
were preserved. There were no database writes/migrations or new backup archives.
Private readiness and the rebound core verifier passed; both security timers are
active. Observed deadline: `2026-11-10T06:57:06Z` (later renewal may advance it).
No rollback was needed.

Native Telegram device acceptance and a full gameplay suite were not performed
for this decorative change. Private evidence is under
`/opt/hambazi/releases/section-icon-20261109` and
`/home/mehdi/.cache/hambazi-section-icon-20261109`; screenshots are in ignored
`test-results/section-icon-20261109`. Historical backend entries in tracked
manifests predate Phase 3; the actual private Compose was used and preserved.
