# Replacement staging deployment — 2026-10-20

The local HamBazi application is running on **89.46.217.9** at
<https://staging.hambazi.top/>. API, Bot, Worker and Web pass private LIVE/READY
checks. PostgreSQL and Redis are private and running. Admission is limited to the
two owner-supplied Telegram identities. Public release remains HOLD.

The initial deployment could not reach Telegram directly. On 2026-10-21 the
owner-published Cloudflare gateway and a new Bot image passed actual outbound SDK
qualification. Incoming forwarding and an owner-authored `/start` reply subsequently passed,
including a durable `DONE` receipt.
See the [current gateway record](cloudflare-telegram-gateway.md) for the later
Bot-only cutover. Complete native two-player gameplay remains unaccepted.

## Source and data

The original local HEAD was `70515e433d7da350a6c4d8746041134a68831f3f`.
Snapshot `e86843ee62fd65ff080da0383c78c662763689f7` includes the existing local
changes without committing or discarding the owner's working tree. Four images
were built with the repository release tooling, frozen lockfile and pinned feed,
transferred, and checked against their exact image IDs on the destination.
The [public binding](../../infra/docker/server/deployment.json) records hashes.
Operations files added during migration are separate from the deployed image
source; they do not change those image labels.

The previous server 185.110.191.104 is unavailable. Local backup records referred
to that server; a restorable live database dump was not found. Local development
volumes were preserved and were not treated as old production backups. **Previous
users, games, sessions and statistics have not been recovered.** PostgreSQL was
initialized empty, all 15 migrations completed, and disabled Kahroba catalog
metadata was inserted for the restricted runtime. No historical accounts or
matches were synthesized. Later aggregate inspection found two new users/two
sessions and no matches; these are new-server records, not restored history.

Missing recovery material is an actual old-server database backup (and any
separately stored live files), or renewed access to a surviving source. Existing
local application settings were sufficient to bootstrap the new restricted
installation. API/Worker/database/Redis credentials, signing material and internal
TLS were generated anew. The existing development Telegram bot credential was
available locally and was retained in private configuration.

## Destination and exposure

- Ubuntu 24.04.5; Docker 29.1.3; Compose 2.40.3; nginx 1.24.0; Certbot 2.9.0.
- All three staging A records point to 89.46.217.9. A verified Let's Encrypt
  certificate covers Web/API/Bot; initial expiry is 2027-01-18 13:02:03 UTC.
  Certbot renewal and its nginx validation/reload hook are enabled.
- The host firewall allows TCP 22/80/443 only. No application, PostgreSQL or Redis
  port is published by Docker. Data traffic uses a private internal network and
  verified TLS; Bot has a separate outbound network.
- Application containers use UID 1000, read-only roots, dropped capabilities,
  no-new-privileges, graceful stop budgets and rotated logs. API and Worker have
  separate database/Redis credentials. Data and service CAs are distinct.
- nginx exposes the scoped authenticated application routes. Admin, internal,
  health, metrics, ordinary room/catalog and secret-file probes are rejected.
  Bot upstream TLS verifies its DNS SAN and trusted CA.
- Kahroba is enabled only in the existing restricted runtime. Coup remains disabled
  according to the local source configuration. This is not public game activation.

The Telegram webhook was set to the same HTTPS URL with explicit destination
89.46.217.9 and a new secret. Pending updates were retained, not dropped. The
existing Web App menu points to <https://staging.hambazi.top/>. These settings were
verified through the local machine's working Telegram route; no operator message
was sent. Destination DNS returned a filtering address for `api.telegram.org`,
and a direct TLS connection to an independently resolved real address also timed
out. This establishes an egress failure, not which party caused it. A working
outbound route/proxy is still missing; no proxy credential or reachable route was
provided.

## Verification

| Check                                                       | Result and scope                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen install and `pnpm check` before operations additions | Passed: formatting, lint, boundaries, types, unit/domain tests, build and contract check; environment-dependent skips retained.                                                                                                                                      |
| Six exact deployed images                                   | Fresh scans passed the existing gate: no High/Critical/Unknown; allowed Moderate findings remain. Dependency audit reported no advisories.                                                                                                                           |
| Source/history secrets                                      | Native detections reviewed with the existing exact public-provenance assessor from local revision `b55907a`; no broad ignore added. The main-tree assessor's older context list did not itself pass. Private reports preserve the exact reviewed source/hash.        |
| Packaged Playwright suite                                   | One case passed, one failed: the existing synthetic-launch test expects a visible “Continue with Telegram” button, while the local source bootstraps automatically. Full packaged browser acceptance is **not passed**.                                              |
| Independent built-image privacy probe                       | Both plain/synthetic-launch cases passed: launch data removed from URL, no local/session storage persistence, inline script blocked, app rendered without fatal page errors.                                                                                         |
| Replacement security logic                                  | Nine cases passed, covering severity, stale/future metadata and missing/substituted image reports.                                                                                                                                                                   |
| Actual repository infrastructure directory                  | `pnpm exec vitest run --dir infra --maxWorkers 1`: 18 files, 169 tests passed, two skipped. The broad `pnpm test:infra` invocation also traversed an ignored cached candidate under test-results and had unrelated failures/timeouts; it is not reported as passing. |
| Private services and data                                   | Four LIVE/READY checks passed; data TLS/role isolation and absence of published ports checked. All 15 migrations completed.                                                                                                                                          |
| Graceful application stop/restart                           | Passed under maintenance: all four exited 0, no OOM/forced kill, PostgreSQL volume retained.                                                                                                                                                                         |
| Public HTTPS                                                | 62 checks passed, six exact browser headers, 39 public assets byte-matched to the deployed image. Protected endpoints rejected unauthenticated access.                                                                                                               |
| Public Socket.IO                                            | Unauthenticated Kahroba and personal namespace connections rejected.                                                                                                                                                                                                 |
| Automatic security renewal                                  | Both manual and actual scheduled execution passed on the destination; six bound image reports and strict readiness checked.                                                                                                                                          |

The real protected containment unit was not invoked against the now-active user
sessions just to rehearse it. Its unit syntax was verified, and the application
drain/restart above was tested separately. Host reboot, backup restore/PITR,
Redis/DB outage recovery, load/reconnect storm, two-hour soak and complete native
two-player acceptance were not performed by this migration. Earlier host results
do not substitute for these checks.

## Security evidence and operation

The normal hourly renewal of ADR-069 was rebound to this server's six active
images and host-managed ingress packages. See [ADR-073](../adr/073-replacement-restricted-staging-server.md).
It binds the daemon/container identities, private files, admission, routes,
certificates, controller and static systemd units. Fresh official advisories
must satisfy the existing gate and both genuine metadata timestamps must be
younger than 24 hours. Re-downloading unchanged advisories does not extend expiry.
The scheduled run at 2026-10-20 15:01 UTC succeeded without extension; the installed
deadline at that observation was **2026-10-21 13:14:22 UTC** (16:44:22 Tehran).
This is an observed finite deadline, not a permanent validity assertion; consult
the private state and timers for later renewals.

Failed renewal retains the existing expiry. The independent persistent expiry
timer invokes maintenance and drains applications while preserving PostgreSQL and
Redis. Renewal never starts applications or opens ingress. Old server timer
bindings and the expired advisory outage exception were not copied.

## Files and handoff

- Application source: `/opt/hambazi/source`; source bundle/archive and image manifest
  retained under `/opt/hambazi`.
- Live Compose, role envs, admission files and TLS: `/opt/hambazi/private`.
  Credentials are intentionally absent from Git and this report.
- Private readiness, image, browser, ingress, transfer and Telegram reports:
  `/opt/hambazi/evidence`.
- Native scan tool, bound control, current expiry, six reports and renewal result:
  `/opt/hambazi/security`; controller: `/opt/hambazi/ops/replacement-security.py`.
- Local private source/config/credential/evidence copy:
  `/home/mehdi/.cache/hambazi-migration-20261020`.
- Persistent fresh PostgreSQL volume: `hambazi-server-postgres-20261020`.

Use the [replacement operator instructions](../../infra/docker/server/README.md)
for maintenance, review/rebinding and manual reopening. New-server backups/PITR
and retention remain undecided; preserving the current volume and installation
artifacts is not an offsite database backup.
