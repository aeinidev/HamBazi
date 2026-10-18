# Restricted staging outage after upstream Trivy database build failure

Status: service restored after explicit owner acceptance of a finite 48-hour
advisory-age exception. Normal automatic-renewal policy remains unchanged.

## Confirmed cause

The normal automatic-renewal timer remains enabled and runs hourly. Its journal
records successful renewals on October 14–16, eventually reaching
`2026-10-17T01:13:54Z`. Subsequent downloads repeatedly returned the same official
advisory timestamp, `2026-10-16T01:13:54.947090392Z`, so the job correctly left
the existing deadline unchanged rather than extending stale evidence.

At **2026-10-17 01:13:54 UTC / 04:43:54 Tehran**, the containment timer fired.
The journal records canonical maintenance at `2026-10-17T01:13:55.136Z`, followed
by successful graceful stops of all four applications. Their exit codes are zero
and there is no OOM. Subsequent hourly checks reject the stopped runtime and
maintenance routes, as designed; this is not evidence that an active release
changed or that the automation was disabled.

Independent fresh-cache downloads from official GHCR and Docker Hub return the
same old advisory timestamp. Their actual download times are
`2026-10-17T12:56:20.023817944Z` and `2026-10-17T12:57:08.738952669Z` respectively.
The normal 24-hour freshness check fails both. A third diagnostic GHCR retrieval
at `2026-10-17T12:58:23.850287256Z` confirms the same update timestamp.

The [official upstream DB build](https://github.com/aquasecurity/trivy-db/actions/runs/39031246212)
created at `2026-10-17T12:06:47Z` completed with failure at 12:55:42 UTC in its
database-build step. The preceding 06:07/00:13 and October 16 18:06 builds also
failed. This confirms an upstream database-build outage rather than merely a
stale local cache. No cache timestamp was rewritten and no alternate unofficial
advisory source was used.

## Preservation and health checks

- The target is the existing VPS `185.110.191.104`, Docker daemon
  `342f251a-9e56-4353-af12-a32429b7a2e7`.
- All seven runtime container IDs and image pins match the automatic-renewal
  binding. PostgreSQL, Redis and ingress remain running. The four apps are
  intentionally stopped. No container was restarted or recreated.
- Every bound admission, role, preparation, Compose, service and implementation
  hash matches. The sole changed bound file is the ingress routes file, which
  now exactly matches canonical maintenance as the expiry service intended.
- Nginx configuration passes validation. Direct public HTTPS returns 503 with
  successful certificate verification. The firewall service is active.
- Durable counts remain 2 users, 2 registered users, 48 matches, no active matches
  and 15 migrations. No reset, migration, backfill or game creation ran.
- The expected Telegram webhook is unchanged. One pending update and a latest
  503 delivery error at `2026-10-17T12:58:03Z` confirm the user-visible effect.
  No polling, reset, fabricated update, message send or backlog deletion ran.

## Prepared bounded recovery

The existing hash-verified scanner ran diagnostic scans against the latest
available official database for all eight exact images. This is explicitly
**not a normal freshness pass** and does not authorize starting service.
High/Critical/Unknown finding gates remain unchanged. Private diagnostic evidence,
actual registry metadata and attempted-normal-gate failures are preserved under:

`/opt/hambazi-staging/private/execution-20261008/outage-restored-20261017-1255/`.

[ADR-070](../../adr/070-bounded-staging-advisory-outage-exception.md)
records the explicitly accepted, staging-only maximum advisory age of 48 hours with
hard expiry **2026-10-18 01:13:54 UTC / 04:43:54 Tehran**. It preserves the
existing owner plus one tester, production HOLD, exact images, data and unchanged
containment service. It does not alter the global 24-hour gate or authorize
perpetual exception renewal.

After acceptance, recheck actual age, all findings and bound controls; record a
separate explicit exception binding; replace only the timer date and synchronize
the auto-renewal state to it. Start only the same four app containers under
maintenance, check LIVE/READY/health, then validate and atomically restore the
same reviewed restricted routes. Verify public Web, owner/tester Auth/WSS,
Telegram backlog/error progress and data/control preservation. Leave automatic
renewal using its original normal freshness gate. If fresh advisories recover it
may renew normally; otherwise containment must fire at the exception deadline.

The initial investigation did not alter expiry or start applications. The owner
then explicitly accepted this exact temporary exception, its risk and deadline.

## Recovery and actual verification

The accepted private `exception-approval.json` binds the same daemon, exact eight
image pins, owner plus one tester, actual unchanged advisory timestamps, 48-hour
maximum and finite hard expiry. The normal gate is explicitly recorded as failed;
this recovery is not represented as a normal freshness pass.

Restricted traffic reopened at **2026-10-17 13:01:55.668 UTC / 16:31:55.668
Tehran**. Only the existing expiry date changed and the automatic-renewal state
was synchronized to that date under its existing exclusive lock. Its actual next
trigger is **2026-10-18 01:13:54 UTC / 04:43:54 Tehran**, enabled/persistent with
one-second accuracy and zero randomized delay. The containment service, normal
24-hour policy, automation source and hourly timer were not changed.

API, Worker, Bot and Web started in that order under maintenance. They retain
their exact container IDs/images and pass Docker health plus private LIVE/READY 200. Ingress, PostgreSQL and Redis IDs/start times are unchanged. The exact
reviewed routes were separately validated, atomically installed and reloaded.

Passed post-recovery checks:

- Direct public Mini App HTTPS 200, JavaScript/CSS/font delivery and hidden-route
  checks. Twelve served assets match the existing Web image bytes, including the
  official pinned Telegram SDK and home images; CSP, no-store and TLS remain.
- Thirty-one actual public-port-443 Auth/WSS checks for the existing owner and
  tester, including idempotent sessions, profile reads, authenticated sockets,
  unadmitted/anonymous/foreign-origin denial and logout revocation. Both synthetic
  smoke sessions were logged out. No game/account was created or reset.
- Existing profiles/registration metadata and every match ID/version pin remain
  unchanged across the smoke. Final counts remain 2 users, 2 registered users,
  48 matches, no active matches and 15 applied migrations.
- Telegram pending updates decreased 1 to 0 through its unchanged webhook.
  The retained 503 error is from `2026-10-17T13:01:18Z`, before reopening; no
  later delivery error is observed. Missing webhook secret is denied 401.
- All control/implementation hashes match the original automatic-renewal policy.
  The read-only automatic-runtime check now passes and its hourly timer remains
  enabled. It still requires genuine normal-fresh advisories before extending
  this finite date. It does not repeat or extend the 48-hour exception.

Private final/startup/route/auth/asset/Telegram evidence is in the directory above.
No application code or dependency change was deployed, so source-code suites were
not rerun. Native Telegram device presentation remains unobserved; actual Web,
Auth/WSS, readiness and Telegram backlog recovery are verified. Production HOLD,
durable data and the two-human admission restriction remain intact.
