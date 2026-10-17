# Scheduled staging containment on 2026-10-13

Status: restored after explicit owner approval; normal expiry enforcement remains
enabled through 2026-10-14 19:11:46 UTC / 22:41:46 Tehran.

The owner reported another HTTP 503 outage and requested restoration. The previous
explicit approval ended at **2026-10-13 13:18:23 UTC / 16:48:23 Tehran**. The
original incident instruction requires reporting the exact checks and proposed
expiry before approval of a required renewal.

## Confirmed cause and checks

The enabled advisory-expiry timer triggered at `2026-10-13T13:18:23Z`.
The journal records canonical maintenance at `2026-10-13T13:18:24.148Z`, then
successful stops of API, Worker, Bot and Web. The service result is success;
each container exited zero without OOM. Sampled allowlisted logs show the stop
events and no warning/error records. This is intentional containment at the
previously approved deadline.

Checks on the existing staging VPS at approximately 20:04–20:07 UTC confirm:

- Docker daemon is `342f251a-9e56-4353-af12-a32429b7a2e7` on the existing
  `185.110.191.104` target. Production was not accessed.
- Nginx passes configuration validation. Its active routes exactly match
  canonical maintenance. Direct HTTPS to all three staging hosts returns 503
  with successful certificate verification.
- Application image IDs/pins, UID 1000, original Compose/preparation hashes,
  all four role-file hashes and containment-service hash remain unchanged.
  Application containers have no published ports.
- Owner and tester admission hashes are unchanged; exactly one owner and one
  different numeric tester remain admitted through read-only mounts.
- PostgreSQL/Redis/ingress remain running. PostgreSQL accepts the read-only
  counts query; Redis passes an authenticated, certificate-verified TLS PING.
  The firewall service remains active.
- Current durable counts are **2 users, 2 registered users, 48 matches,
  0 active matches, 15 migrations**. The additional existing match relative
  to yesterday's final snapshot is preserved. No reset, migration or backfill ran.
- Telegram's expected webhook is unchanged. Pending updates are zero; its
  retained last 503 error is from `2026-10-12T19:10:40Z`. There is no new queued
  delivery-error evidence for today's outage, since no update is pending.
  No webhook reset/polling, message send or backlog deletion occurred.

## Fresh renewal evidence

The existing hash-verified Trivy binary downloaded genuine official advisories
into a separate cache and scanned the same eight exact images:
API, Bot, Worker, Web, ingress, ACME, PostgreSQL and Redis.

- `UpdatedAt=2026-10-13T19:11:46.909502157Z`
- `DownloadedAt=2026-10-13T20:05:54.79257155Z`
- All eight pass the unchanged normal 24-hour policy, with zero High, Critical
  and Unknown findings. Applications/data each have one permitted Moderate
  finding; ingress and ACME have none.
- Evidence expires at `2026-10-14T19:11:46.909Z`. Proposed installed containment
  expiry is conservatively rounded down to **2026-10-14 19:11:46 UTC /
  22:41:46 Tehran**.
- No timestamp rewrite, freshness exception, suppression or threshold change
  occurred. The dedicated cache was removed after preserving its metadata and
  scan summaries; existing evidence and caches remain intact.

Private evidence directory:
`/opt/hambazi-staging/private/execution-20261008/outage-renewal-20261013-2005/`.

`runtime-images.scan.json` SHA-256:
`52e234dbdfeb242b457981f9672233e4e0af7dac174658f36ad7a235e2d1497a`.
`preflight.json` records current controls, platform identities and durable counts.

## Exact recovery proposed for approval

1. Recheck target, image/report hashes, normal freshness and preserved admission,
   role/Compose/preparation/service controls at execution time. Bind the fresh
   scan to the unchanged mixed-source runtime: API/Bot/Worker `1bfc42e`,
   approved Web `685d9f6`. Preserve all original preparations and data.
2. Change only the existing timer drop-in date to **2026-10-14 19:11:46 UTC**.
   Keep the same containment service, enabled persistent timer, one-second
   accuracy and zero randomized delay. Verify the actual next trigger.
3. Under canonical maintenance, start only the four existing application
   containers in dependency order. Verify private LIVE/READY 200 and Docker
   health before reopening. Do not restart ingress, PostgreSQL or Redis.
4. Validate and atomically restore the same reviewed restricted ingress routes,
   SHA-256 `c36b33c836b38a9b62f38541f0f8755649d036e55105bfcfe5f5de1a07c96600`,
   then reload Nginx. Preserve owner plus one tester admission and production HOLD.
5. Verify Mini App delivery/assets, owner/tester auth and WSS, denied unadmitted
   access, private readiness, safe logs, unchanged existing data and Telegram
   webhook status. Revoke synthetic smoke sessions. Do not fabricate Telegram
   updates, send test messages, create a game or reset/drop the webhook backlog.
6. On failed checks, retain/reapply maintenance and gracefully stop only the
   restarted apps, preserving the data services and expiry enforcement.

No timer date, active route or application state changed during the initial
renewal preparation. The owner then explicitly approved the exact proposed
deadline and recovery scope.

## Approved recovery and verification

Restricted traffic reopened at **2026-10-13 20:10:06.463 UTC / 23:40:06.463
Tehran** after the approved renewal. Only the existing timer drop-in date changed.
Its actual next trigger is **Wednesday 2026-10-14 19:11:46 UTC / 22:41:46
Tehran**. The timer remains active/enabled, persistent, with one-second accuracy,
zero randomized delay and the unchanged containment service.

All four existing application containers retain their exact IDs/images and pass
Docker health and private LIVE/READY 200. They started in the order API, Worker,
Bot, Web under maintenance. The reviewed restricted routes were separately
validated, atomically installed, validated again and reloaded. Ingress,
PostgreSQL and Redis IDs/start times are unchanged.

Verification passed:

- Public Mini App HTTPS 200, JavaScript/CSS/font loading and hidden-route checks.
  Twelve served assets match the Web image's exact packaged SHA-256 bytes,
  including HTML, bundle, CSS, font, pinned official Telegram SDK and home art.
  TLS validation, CSP and no-store remain intact.
- Thirty-one protocol checks through the public VPS address and port 443:
  owner/tester session issuance, idempotent retry, profile read and authenticated
  WSS connection; denial of signed unadmitted identity, anonymous access,
  foreign-origin sockets and revoked sessions; hidden Admin/catalog/private
  health routes. Synthetic signed launches stayed in memory and both smoke
  sessions were logged out.
- Existing profiles, registration metadata and all match IDs/version pins remain
  unchanged across the smoke. Final counts are **2 users, 2 registered users,
  48 matches, 0 active matches and 15 applied migrations**. No new match, account,
  migration, reset or backfill was performed by recovery.
- Telegram webhook remains correctly configured with zero pending updates.
  Its latest retained 503 error is `2026-10-13T20:09:24Z`, during startup under
  maintenance and before reopening. No later delivery error is observed.
  Missing webhook secret is denied 401. No webhook reset, backlog deletion,
  fabricated Telegram update or test message send occurred.
- Final safe application log samples contain zero warning/error records;
  owner/tester admission and role/service/Compose/preparation hashes remain
  unchanged. Production was not accessed; production HOLD remains enforced.

The fresh evidence, activation binding, actual timer state, startup/opening,
auth/WSS and asset smoke reports, Telegram readback and final verification are
recorded in the private evidence directory above. Previous preparation and
deployment bindings are preserved. The local current staging binding points to
the renewed evidence; sanitized copies are in the ignored
`test-results/staging-outage-20261013/` directory.

Native Telegram device presentation/new human interaction was not directly
observed. No application code was deployed, so source-code suites were not rerun;
the operational health, preservation, TLS, auth/WSS and ingress checks above were
performed against the actual unchanged runtime. Automatic perpetual renewal is
outside this recovery scope; the approved hard expiry remains enforced.
