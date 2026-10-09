# Private manual operator observation

Scope: ADR-051's explicit `private-manual-v1` preparation profile. This procedure
reads already-running reviewed containers after separate activation approval; it
never starts them. The owner is the sole operator/responder under ADR-050.

The current restricted staging binding is
[staging-test-user-current.json](../../../infra/docker/staging/staging-test-user-current.json).
Its prepared directory is `/opt/hambazi-staging/private/prepared-staging-test-user-20261009`.
The original owner remains sole operator; the separate numeric tester is an ordinary
user only. See [retest and revocation](../staging-test-user.md). The new preparation
runner is `runner-81476d2`; the generic containment runner `runner-6e63149` and the
installed normal expiry timer are unchanged. The ADR-056 acceptance command below
is historical and cannot accept this two-human successor. Native owner functional
acceptance and pending Description Picture confirmation retain their original scopes.

Use the existing key-authenticated SSH context. On the VPS, invoke the reviewed
runner checkout's CLI with the actual new prepared directory, a role and one of
`logs`, `live`, `ready`, `metrics`. An optional final argument selects the actual
reviewed Compose project; the default is `hambazi-preparation`. Never invent a
directory/project or use a preparation success record as activation authorization.

```sh
node infra/release/operator.mjs /absolute/private/prepared api live
node infra/release/operator.mjs /absolute/private/prepared api ready
node infra/release/operator.mjs /absolute/private/prepared api metrics
node infra/release/operator.mjs /absolute/private/prepared api logs
```

Replace the directory with the real restricted reference. Web has health checks
but no existing metrics endpoint. Before activation, container inspection must
fail safely; do not start services to make this procedure pass.

The tool verifies the prepared Compose hash, selected exact image, UID 1000,
local logging and absence of public port bindings. Probes use `docker exec` and
the container's loopback-only health listener. Ready may be 503 `NOT_READY` even
while live is 200 `LIVE`; metrics must preserve dependency/collection failures.
Check the observation timestamp and collection/dependency signals rather than
trusting stale gauges. No snapshot or scrape archive is automatically created.

Logs are limited to the last 200 stdout records and projected through existing
event/field allowlists. Unknown raw/crash output is omitted, with a count. Do not
use raw `compose config`, environment inspection or copy role files/DSNs/logs into
chat/tickets. Do not enrich logs with environment variables or sensitive labels.
Runtime safe-logging rules remain mandatory even for events this tool omits.

Docker rotates at `10m` per file, three files per role, with compression. This
size/count bound is not a time-based retention guarantee, audit archive or backup.
Read through Docker rather than editing its internal log files. Removing an owned
container removes that container's local log history; perform such removal only
under its separately authorized cleanup/deployment scope.

Local validation uses `node infra/release/test-definition-local.mjs` with a real
private inventory path and `--operator-monitoring`. It starts only owned local
fixtures, checks safe logs/private loopback metrics during a synthetic dependency
failure, then cleans them. It is not staging activation or a DB/Telegram smoke.

## Personal staging advisory exception expiry

The historical owner-approved ADR-053 exception ended at 2026-10-09 11:08:55
Asia/Tehran and was not extended. Fresh normal eight-image evidence superseded it.
The **currently installed normal containment timer is 2026-10-09 22:35:21
Asia/Tehran (19:05:21 UTC)**; inspect the actual next trigger, not the historical
source-template deadline. The current binding and acceptance gate validate it.
The reviewed [service](../../../infra/docker/staging/advisory-expiry.service) and
[timer](../../../infra/docker/staging/advisory-expiry.timer) enforce containment
at the installed deadline: canonical maintenance routes, then SIGTERM/45-second graceful
application stop. Private PostgreSQL/Redis and durable history are preserved.
This timer does not refresh scans or extend the exception; future execution is
unperformed until its actual deadline. Inspect its enabled state and next trigger
privately with `systemctl status hambazi-staging-advisory-expiry.timer`.

After genuinely fresh official advisories and successful normal 24-hour scans of
all exact active images, validate a new preparation and activation binding before
replacing this containment schedule. Until that evidence exists, keep the timer.
Do not alter advisory timestamps, severity thresholds or the approved deadline.
A currently valid public certificate does not make stale security evidence valid.

## Exact personal-staging acceptance gate

ADR-056 closes the applicable personal 18B3 scope; Phase 19 review holds public
release. The repository owns `infra/release/staging-acceptance.mjs`, with negative
tests. A separately installed, mode-0600 adapter uses the accepted runner's exact
public ports; original source, adapter and input hashes are in `execution-current.json`.
The adapter changes import locations only and does not alter the old runner.

On the target through the existing owner SSH identity, use the actual installed
tool and reviewed closeout binding:

```sh
node /opt/hambazi-staging/private/acceptance-20261009-01/staging-acceptance.mjs /opt/hambazi-staging/private/execution-20261008/evidence/phase18b3-closeout-binding-20261009-02.json
```

This read-only gate checks the actual NIC/daemon, exact current prepared images,
Compose/route hashes, ten private acceptance reports, normal eight-image freshness,
current health/logs/metrics, eight public TLS/route probes, exact single-value Web
headers and installed expiry. It refuses stale evidence; it never starts services,
changes routes, reads role credentials, rotates keys or closes phases itself.
No raw diagnostics/game state are emitted. Successful output always retains
`productionReleaseApproved: false`; owner SSH execution is not hosted CI protection.
