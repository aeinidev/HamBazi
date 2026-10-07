# Private manual operator observation

Scope: ADR-051's explicit `private-manual-v1` preparation profile. This procedure
reads already-running reviewed containers after separate activation approval; it
never starts them. The owner is the sole operator/responder under ADR-050.

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
