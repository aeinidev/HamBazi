# Staging restoration after ingress libexpat vulnerability

Status: restored with passing normal fresh evidence; automatic renewal verified.
The previous advisory-age exception expired and was not extended.

## Cause

The finite ADR-070 exception expired at **2026-10-18 01:13:54 UTC / 04:43:54
Tehran**. The unchanged containment service applied canonical maintenance at
`2026-10-18T01:13:55.126Z` and stopped the four apps with exit zero, no OOM.
PostgreSQL, Redis and ingress remained running. Application/admission/control
hashes and all container IDs matched their previous binding; counts remained
2 users, 2 registered users, 48 matches, no active matches and 15 migrations.

Upstream advisory generation recovered: official builds on October 17 at 18:05
and October 18 at 00:15 succeeded. The fresh database updated at
`2026-10-18T00:43:37.96251718Z` reveals **High CVE-2026-77214** in ingress
`libexpat 2.8.5-r0`. The other seven selected images have no blocking findings.
The hourly job continued running and correctly refused renewal. No vulnerability
was suppressed and no age/severity gate was relaxed.

## Remediation

The exact existing ingress image was used as immutable base for a clean
ingress-only candidate, installing only the signed official Alpine package
`libexpat 2.9.0-r0`. The APK's SHA-256 is
`32b127f31e0a919110a18a7f0bb3780d8fb66ba4d8d61b2d301d633f0e319d0e`.
The build had no network access during package installation and did not enable
untrusted packages. Nginx's executable SHA-256 is unchanged.

Clean source commit: `45aa21af1f40f5e9cb249019f459536c23fbc6c6`, retained on local
branch `codex/staging-ingress-expat-20261018`. No application source from that
checkout was built or deployed. The owner workspace's other work was not committed.

Patched image:
`hambazi-staging/ingress:45aa21af1f40f5e9cb249019f459536c23fbc6c6-107ce6400d29a5bf@sha256:cebdcaa285b8c50f82c125b90321e0d4ac0d2edfe01be138e5498f340e90b4cb`.

The established builder now accepts an explicit component subset while retaining
its original two-component default. Component inventory provenance is additive
per image, allowing the unchanged ACME artifact to retain its original commit.
The TLS renewal checker verifies each image's correct source and build-input
labels. Its new installed adapter changes only the scanner import location.
The TLS service changes only that script path; certificate issuance/renewal was
not executed. The old runner and containment service remain byte-identical.

See [ADR-071](../../adr/071-ingress-only-expat-security-remediation.md) for scope,
private-base reproducibility and the restriction on using the old vulnerable
image for any public rollback.

## Deployment and preservation

All eight selected images, including the patched ingress, passed fresh normal
scans with zero High/Critical/Unknown findings. Ingress and ACME also have zero
Moderate findings; the six retained app/data images retain one permitted Moderate
finding each. Existing thresholds, timestamps, 24-hour policy and admission stay.

Only ingress was recreated under maintenance. The overlay changes exactly its
image; every other Compose field was compared for equality. Runtime ports,
networks/static IPs, mounts, arguments, environment, UID, logging and hardening
match the previous ingress. A private, port-free candidate configuration test
passed before deployment. The actual original containment runner was then
successfully exercised against the new ingress while already in maintenance.

API/Worker/Bot/Web retain their exact IDs/images and were started in that order
under maintenance, reaching Docker healthy and private LIVE/READY 200. Data
service IDs/start times are unchanged. The hourly policy was rebound only to the
new ingress image/ID, preserving every other policy field. The expiry service
and hourly schedule remain enabled; no new exception was installed.

Restricted routes reopened at **2026-10-18 07:05:13.835 UTC / 10:35:13.835
Tehran** after separate Nginx validation and atomic replacement. Actual installed
normal expiry is **2026-10-19 00:43:37 UTC / 04:13:37 Tehran**. Subsequent hourly
runs may advance this only with genuinely newer passing normal evidence.

## Verification

- Public Web HTTPS 200, JS/CSS/font delivery and restricted-route checks pass.
  Twelve served assets match the unchanged Web image, including the pinned SDK
  and home images. CSP, no-store and certificate verification remain intact.
- Thirty-one actual public-port-443 Auth/WSS checks pass for owner and tester:
  idempotent issuance, profile read, authenticated socket, unadmitted/anonymous/
  foreign-origin denial, hidden routes and logout revocation. Synthetic launch
  credentials stayed in memory and both smoke sessions were logged out.
- Existing profiles and all match IDs/version pins remain unchanged. Final
  counts are **2 users, 2 registered users, 48 matches, 0 active matches,
  15 migrations**. No game/account creation, reset, migration or backfill ran.
- Telegram backlog is zero with no new error after reopening. Its retained 503
  error is from `2026-10-18T07:04:38Z`, before routes reopened. Missing webhook
  secret is denied 401. No polling/reset, fabricated update or backlog drop ran.
- Actual automatic renewal was executed through its installed systemd service
  at 07:06 UTC and completed with exit zero at 07:06:55. Its eight exact-image
  scans pass with the patched ingress. It reports `unchanged` because the
  genuine metadata still supports the same installed normal deadline.
- The 16 actual infra suites pass: **139 passed, 2 existing skips**. Targeted
  ESLint and architecture checks pass. The initial broad discovery also included
  an ignored historical candidate copy and a parallel-load timeout; the bounded
  root-infra rerun excludes `test-results/**`, limits workers and passes.
  No app build or full root suite is claimed for this ingress-only repair.

Private evidence directory:
`/opt/hambazi-staging/private/execution-20261008/outage-renewal-20261018-0655/`.
It retains the failed old-image scan, clean manifest, image smoke, passing
replacement scan, prior configurations, provenance/adapter checks, rollout and
all recovery reports. Old images/evidence are retained; no prune ran. Production
was not accessed and remains HOLD. Owner plus one tester admission remains.
Native Telegram device presentation has not been directly observed.
