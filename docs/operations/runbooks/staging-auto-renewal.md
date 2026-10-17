# Restricted staging automatic security renewal

The owner's 2026-10-13 instruction authorizes normal renewal until personally
revoked. [ADR-069](../../adr/069-restricted-staging-automatic-security-renewal.md)
records the exact scope. Production remains HOLD and admission remains the same
owner plus one ordinary numeric tester.

`hambazi-staging-auto-renewal.timer` runs hourly at minute zero UTC with a
persistent timer, separate from `hambazi-staging-renewal.timer` (TLS only).
The new job verifies the existing target/daemon, exact eight images and container
IDs, private ports, health, two-human read-only admission, role/route/preparation/
containment-service hashes, firewall and installed expiry. It downloads official
advisories to an isolated cache and applies the unchanged normal scanner gates.
It rechecks authority and controls after scanning and immediately before commit.
Only genuinely newer passing evidence advances the hard expiry. Both metadata
timestamps must be fresh; downloading old advisories again never extends them.

The job never starts/recreates containers or reopens ingress. Failed download,
finding, unhealthy service, manual maintenance, changed deployment or revocation
leaves containment in place. It refuses renewal within 15 minutes of expiry to
avoid racing the containment service. Persistent prepared proof supports recovery
from interruption between a proven timer change and saving its state.

Installed private directory:
`/opt/hambazi-staging/private/execution-20261008/automatic-renewal-20261013/`.
`policy.json` binds the reviewed runtime, controls and implementation hashes;
root-owned mode-0600 `control.json` is the revocable authority; `state.json`
records the installed date/hash. `last-run.json` and the newest 168 private scan
reports retain safe evidence. Attempt-specific scanner caches/raw reports are
removed after each run; no application data or existing evidence is deleted.

Read-only checks on the staging host:

```sh
systemctl status hambazi-staging-auto-renewal.timer
systemctl show hambazi-staging-advisory-expiry.timer -p NextElapseUSecRealtime -p ActiveState -p UnitFileState
journalctl -u hambazi-staging-auto-renewal.service --no-pager -n 20
/usr/local/bin/node /opt/hambazi-staging/private/execution-20261008/automatic-renewal-20261013/staging-auto-renewal.mjs --check
```

## Revocation when the owner asks to stop renewal

First atomically set `enabled=false` in the existing private `control.json`,
preserving its policy hash and mode 0600. Then run:

```sh
systemctl disable --now hambazi-staging-auto-renewal.timer
systemctl stop hambazi-staging-auto-renewal.service
```

The control is rechecked before committing; `KillMode=control-group` stops the
scanner too. Confirm the hourly timer is disabled/inactive and the unchanged
containment timer remains enabled with its actual finite next expiry. Stopping
renewal leaves service running only through its latest valid evidence window.
An explicit request to stop staging immediately additionally uses the established
canonical maintenance and graceful app-stop procedure, preserving data services.

A changed release, manual maintenance, failed scan or expiry closure must not be
bypassed by changing this policy ad hoc. Review the new exact binding/security
evidence before resuming or rebinding. Native acceptance and production readiness
are not conferred by a successful renewal.

## Activation verification

The hourly timer was enabled on 2026-10-13 UTC (2026-10-14 Tehran at final
activation). Its verified first next run is **2026-10-13 21:00 UTC /
2026-10-14 00:30 Tehran**. The service completed actual normal eight-image scans
under its installed systemd sandbox with exit zero. Results were `unchanged`:
official advisory metadata still points to `2026-10-13T19:11:46.909502157Z`, so
the existing expiry remains **2026-10-14 19:11:46 UTC / 22:41:46 Tehran**.
Newer successful official evidence will advance it automatically; an old advisory
database downloaded again does not extend it.

A live revoked-control check denied execution and left the expiry unchanged.
All seven existing containers retain their IDs/images; all four apps remain
healthy. Counts remain 2 users, 2 registered users, 48 matches, no active matches
and 15 migrations. Public Web remains HTTPS 200; production was not accessed.

Infra tests pass (137 passed, 2 existing skips), targeted ESLint and architecture
checks pass. No application source/build/contract change was deployed. Activation
and revocation evidence, exact policy/implementation hashes, report references
and current state are in the installed private directory. The current staging
binding records this authorization; after scheduled renewals consult `state.json`
and the actual expiry timer for the current date rather than a Git snapshot.
Future scheduled runs remain future behavior; real systemd service execution and
the installed enabled/persistent schedule have been verified.
