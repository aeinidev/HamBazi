# Original page layout restoration — 2026-10-24

At the owner's request, the compact/full-viewport changes have been removed from
all remaining pages. Settings/profile return to their original form layout;
Coup entry/tutorial use their original proportions and continuous reading;
Kahroba lobby, create/search/room screens and dialogs use their previous styles.
The table again displays nobles, market, bank, purchase assistant and personal
resources together. Collection and reservation options are continuous lists.

The current fantasy main lobby is preserved. Hash-named WebP images, responsive
image sources, Brotli/gzip, static caching and ETag/304 validation are retained.
The shared viewport stylesheet, page deck and market/resources tabs are removed.
No backend behavior, rules, contracts, migrations or application dependencies change.

## Release identity

- Activated at `2026-10-23T23:54:03.513359+00:00` on **89.46.217.9**.
- Web origin: <https://staging.hambazi.top/>.
- Source snapshot: `3a603ca57139ad882ae09bb0452c624b8eb89007`.
- Source archive SHA-256: `3623fd7d2e51b93ca8dc6249fd19b905376b507bdc5222941e1d71bab88962f9`.
- Build input SHA-256: `f2ed61e29c211b850cc2d64cdc4fefd670d5e0c2471a7fe6c603e7e8bd19f486`.
- Web image: `hambazi-restored/web:20261024-f2ed61e29c211b85@sha256:ba81a154a087973a8ea91e7494a7129c4c99ab50cebb86fd12c9995278ebd77e`.
- Parent: the preceding qualified fantasy main-lobby Web image.
- Observed security deadline: `2026-10-24T19:15:43Z`; later renewal may advance it.

The immutable source snapshot preserves unrelated existing working changes without
moving the working branch or staging index. An offline frozen install and uncached
production build passed. The isolated candidate contains 51 public files and has
zero public-payload secret findings. The exact candidate image passed a nonroot,
read-only, network-isolated readiness/static-delivery probe. Fresh scans passed for
all six active image pins and the previous Web rollback image under the existing
policy. Actual image/container/file binding passed after activation.

## Activation and verification

Zero nonterminal matches were observed before cutover and after the maintenance
drain. A private custom PostgreSQL backup was created and its archive listing
verified; no restore rehearsal or offsite backup is claimed. Web and PostgreSQL were recreated. PostgreSQL retains its exact binary version,
configuration and named data volume; its only changed package is brotli-libs
1.2.0-r1 → 1.2.1-r0, installed from signed official Alpine repositories to resolve
CVE-2026-111497. The initial fresh scan rejected the old PostgreSQL package; no
policy exception or threshold change was used. The patched image is
`hambazi-security/postgres-staging:20261024-brotli@sha256:646e47d029792855c984a6c1123a97843ee7456e0df5579683b99cba111641aa`. The safe Web rollback keeps this patched
PostgreSQL image.
API, Worker and Bot were drained and restarted using their existing exact
containers. Redis, durable records, admission, TLS and ingress remain.
The existing renewal and independent expiry timers remain active.

The initial activation remained in maintenance because a strict mount-list check
mistook changed inspection order for changed storage. Mounts were revalidated by
destination against the unchanged private Compose specification, including the
original named volume and read-only binds. Durable users/matches/migration row
counts were compared to the actual pre-cutover backup before resuming. The mount
check now normalizes ordering; no storage or admission control was bypassed.

- Web typecheck, scoped lint, formatting and architecture checks passed.
- All 124 Web unit tests and 32 packaging tests passed.
- All 100 Midnight and 90 Kahroba browser cases passed in Chromium and WebKit,
  covering small/large screens, native insets, scrolling, forms, dialogs, legal
  actions, reconnect, accessibility and decoding optimized images.
- Restored Coup tutorial, Kahroba match and personal shell components exactly
  match the pre-compact source. Existing main-lobby art and delivery changes remain.
- Authenticated production-candidate and postdeployment HTTPS checks passed in
  both browsers. They compare main-lobby geometry to the live baseline, verify
  vertically arranged settings fields, navigate the existing Coup tutorial or
  availability route, and open Kahroba lobby, help/settings dialogs and create
  form without submitting it. The local suite verifies continuous tutorial text.
- Actual HTTPS verifies no-store HTML, Brotli/immutable JS/CSS, ETag/304, protected
  profile 401, authenticated WSS, cleaned launch URLs, memory-only credentials
  and zero fatal errors. No rooms, games or chat messages are created by these checks.

Native Telegram device acceptance, live multiplayer play-to-finish and load/soak
checks remain separate. Local browser fixtures cover the restored game table;
no live game was started for deployment verification. Rollback material remains
available; rollback was not required.

Current pins and per-role source bindings are in
[deployment.json](../../infra/docker/server/deployment.json) and
[compose.yaml](../../infra/docker/server/compose.yaml). Private server evidence is
under `/opt/hambazi/releases/layout-restore-20261024`; local release evidence is
under `/home/mehdi/.cache/hambazi-layout-restore-20261024`.
