# Staging containment at the scheduled deadline

Status: restored after explicit owner approval; expiry enforcement remains enabled.
Observed on 2026-10-12 at approximately 19:03–19:07 UTC (22:33–22:37 Tehran).

The outage is intentional scheduled containment. The enabled persistent
`hambazi-staging-advisory-expiry.timer` triggered at **07:05:14 UTC / 10:35:14
Tehran**. Its journal records `staging.maintenance.applied` at
`2026-10-12T07:05:15.171Z`, followed by successful stops of API, Worker, Bot and
Web. The service result is `success`, exit status zero. All four containers
exited zero within that second, without OOM; sampled allowlisted logs contain
no warning/error records and record the API/Bot/Worker stop events.

## Confirmed checks

- SSH target is the existing staging VPS `185.110.191.104`, Docker daemon
  `342f251a-9e56-4353-af12-a32429b7a2e7`. Production was not accessed.
- Nginx configuration validation passes. Active routes and canonical maintenance
  routes both hash to
  `c3de14340245b7be3a0ad8863486eace1d0778f5124b1076a4ba1bacea1240ba`.
  A direct, proxy-free HTTPS request to the pinned VPS returns Nginx 503 with
  valid certificate verification and the expected security headers.
- API/Bot/Worker remain pinned to `1bfc42e`; Web remains pinned to `685d9f6`.
  All four have UID `1000:1000` and no published ports. Their prepared Compose
  and preparation hashes match the current binding; Compose validates.
- PostgreSQL and Redis remain running with their existing data mounts and no
  published ports. PostgreSQL accepts connections. Redis passes authenticated
  TLS PING with certificate verification.
- Data counts match the previous final evidence: 2 users, 2 registered users,
  47 matches, 0 active matches, 15 applied migrations. Match version groups are
  unchanged; the extra match relative to the deployment's 46-match preflight
  is the already documented approved gameplay smoke. No migration/backfill ran.
- Owner and tester admission hashes match the binding: exactly one owner and
  one separate numeric tester, mode 0600, regular files, paired read-only mounts.
  All four approved role-file hashes match. The firewall service is active.
- Containment service hash remains
  `ef990122e8d007966cd3fcb24811098cb46e8aee4673ad25a96b1edab884cdc6`;
  timer drop-in hash remains
  `7872f253ad15217442962595a7d3defa43c2bd18ef89ab31ccede4f39480cd1d`.
  The timer is enabled and active, with the recorded last trigger and no future
  occurrence of its elapsed one-shot date.
- Telegram `getWebhookInfo` succeeds: expected HTTPS staging webhook and target
  IP, `allowed_updates=[message]`, four pending updates, latest error
  `Wrong response from the webhook: 503 Service Temporarily Unavailable` at
  `2026-10-12T19:03:46Z`. Token stayed private; no polling, webhook reset, message
  send or backlog deletion occurred.
- The separate certificate renewal ran at 03:10 UTC and succeeded, scanning
  only ingress and ACME. It does not renew the full staging image set or the
  containment timer. The three-host certificate expires 2027-01-06 06:11:04 UTC.

## Prepared security renewal

The previous runtime scan expired at `2026-10-12T13:06:05.155544Z`; the earlier
installed containment deadline was deliberately preserved during the visual
deployment. Neither permits reopening now.

Fresh official advisories were downloaded into a separate cache, using the
existing hash-verified Trivy binary and unchanged policy:

- `UpdatedAt=2026-10-12T13:18:23.1639207Z`
- `DownloadedAt=2026-10-12T19:05:02.564899693Z`
- All eight exact installed/selected images pass: API, Bot, Worker, Web,
  ingress, ACME, PostgreSQL and Redis. High/Critical/Unknown counts are zero.
  Each application/data image retains one permitted Moderate finding;
  ingress and ACME have none. No suppression, severity change, advisory-age
  exception or rewritten timestamp was used.

Private evidence:
`/opt/hambazi-staging/private/execution-20261008/outage-renewal-20261012-1905/runtime-images.scan.json`

SHA-256:
`5119079a54fe7500acea6dc4987f8ef24da87652762edcc40fdc9fb4b3afb72f`

Its normal evidence expiry is `2026-10-13T13:18:23.163Z`. Proposed installed
containment expiry is conservatively rounded down to **2026-10-13 13:18:23 UTC /
16:48:23 Tehran**. The dedicated scanner cache was removed after preserving
metadata/results; existing caches and evidence were retained. Free disk is 3.6 GB.

## Exact bounded recovery proposed for approval

Approval is required because the owner's incident request explicitly requires
reporting checks and proposed expiry before renewal. This is a fresh normal
24-hour renewal, not extension of expired evidence or the old ADR-053 exception.

1. Recheck target/daemon identity, all eight exact image IDs, normal advisory
   freshness and passing scan report. Recheck admission, role-file, Compose,
   containment-service and restricted-route hashes against the current binding;
   record current counts/version groups and data-service health.
2. Bind the fresh eight-image evidence to the existing mixed-source runtime:
   retained API/Bot/Worker `1bfc42e`, approved Web `685d9f6`. Preserve original
   preparation records and previous releases; do not perform a uniform-source
   four-role candidate deployment.
3. Replace only the existing timer's date with the proposed deadline, keeping
   the same service, enabled persistent timer, one-second accuracy and zero
   random delay. Verify the actual next trigger and service hash before startup.
4. Under canonical maintenance, start only the four existing reviewed app
   containers, checking LIVE/READY and Docker health in dependency order.
   Do not restart ingress, PostgreSQL or Redis. Do not migrate, recreate volumes,
   reset accounts, prune images, change game pins or run certificate issuance.
5. Validate and restore only the existing restricted routes, SHA-256
   `c36b33c836b38a9b62f38541f0f8755649d036e55105bfcfe5f5de1a07c96600`,
   through the established validated atomic route replacement and Nginx reload.
   Preserve TLS/WSS headers, membership/admission, rate limits and hidden routes.
6. Verify public Web delivery and protected API/WebSocket admission boundaries,
   all private readiness probes, safe logs, unchanged controls/counts/version
   groups, and Telegram backlog/error progression. Do not reset the webhook or
   discard pending updates. Report genuine native Telegram verification as
   unobserved unless an admitted user confirms it.
7. On failed startup/readiness/security checks retain/reapply canonical
   maintenance and gracefully stop only apps started by this recovery, keeping
   PostgreSQL/Redis/data intact. Keep the new expiry enforcement enabled.

No application was started, route reopened or timer changed during the initial
investigation/preparation. The owner subsequently explicitly approved this exact
normal renewal and deadline before recovery execution.

## Approved recovery and final verification

Restricted traffic reopened at **2026-10-12 19:11:40.508 UTC / 22:41:40.508
Tehran**. The preflight rechecked the exact eight-image scan SHA-256, actual NIC
and Docker daemon, image IDs, normal freshness, role/admission/Compose/preparation
hashes, maintenance routes and containment service. A new activation binding
records the existing mixed-source runtime without rewriting its original
preparations or the previous deployment evidence.

Only the date in the existing timer drop-in changed. The actual installed next
trigger is **Tuesday 2026-10-13 13:18:23 UTC / 16:48:23 Tehran**. The timer is
enabled and active, `Persistent=yes`, `AccuracyUSec=1s`,
`RandomizedDelayUSec=0`, and still invokes the unchanged containment service.
The conservative deadline is inside the fresh scan's normal 24-hour limit.

API, Worker, Bot and Web were started in that order under maintenance. All four
retain their exact container IDs and image IDs, report Docker `healthy`, and pass
private LIVE/READY with HTTP 200. Ingress, PostgreSQL and Redis IDs and start times
are unchanged. The exact previously reviewed restricted routes were staged,
validated with a separate Nginx configuration, atomically installed, validated
again and reloaded. No admission, credential, application, database, migration,
DNS, Telegram setting or certificate change was performed.

Passed recovery checks:

- Direct public HTTPS: Web 200, JavaScript/CSS/font 200, anonymous profile 401,
  and Admin/private health/ordinary catalog routes remain hidden. TLS verification,
  restrictive CSP, no-store and security headers pass.
- Twelve served assets match the unchanged Web image's SHA-256 bytes: HTML,
  JavaScript, CSS, font, official pinned Telegram SDK and all seven home images.
- Thirty-one authenticated protocol checks pass using fresh synthetic signed
  launches for the existing owner and tester. Both can obtain an idempotent
  registered session, read their existing profile and connect via authenticated
  WSS. Signed unadmitted identity, unauthenticated profile/socket, foreign-origin
  sockets and logged-out sessions are denied. Protected routes remain restricted.
  Both smoke sessions were logged out; no new match or account was created.
- Existing account names/registration timestamps and every match ID/version pin
  remain unchanged across the smoke. Counts remain **2 users, 2 registered users,
  47 matches, 0 active matches and 15 applied migrations**.
- Telegram pending updates decreased **4 → 0** through the unchanged webhook.
  Bot logs record completed handlers/webhooks. The retained latest 503 error is
  from `2026-10-12T19:10:40Z`, before reopening; it is historical, not a current
  failure. No webhook polling/reset, fabricated update, test message send or
  backlog deletion occurred. A webhook request without its secret is denied 401.
- Final readiness and allowlisted log samples pass for every application; zero
  warning/error records were observed. Admission and all four role files still
  match the approved hashes. Production HOLD and owner plus one tester admission
  remain enforced.

Current binding:
[staging-test-user-current.json](../../../infra/docker/staging/staging-test-user-current.json).
Private recovery evidence and its new `current-binding.json` are under
`/opt/hambazi-staging/private/execution-20261008/outage-renewal-20261012-1905/`.
The previous deployment binding remains preserved. Local sanitized copies are in
the ignored `test-results/staging-outage-20261012/` directory.

The verification establishes server-side Web/Auth/WSS and actual webhook backlog
recovery. Native Telegram device presentation and a new human interaction have
not been directly observed. No source-code change was deployed; the prior code
suite was not rerun. Future timer execution remains future behavior; its actual
installed configuration and the previous successful containment are verified.
