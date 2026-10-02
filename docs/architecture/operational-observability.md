# Operational metrics and safe reports

[ADR-033](../adr/033-bounded-metrics-and-safe-error-reporting.md) extends
[correlation/logging](observability.md) and [health/draining](health-and-draining.md).
API, Bot and Worker composition own infrastructure observation. No domain/engine,
Web telemetry, module internals or foreign table access is introduced.

## Configuration and access

All exports are disabled by default. ROLE is API, BOT or WORKER:

| Setting                | Meaning                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `ROLE_METRICS_ENABLED` | exact `true`/`false`; default false                                        |
| `ROLE_HEALTH_PORT`     | existing loopback port, required when metrics enabled                      |
| `ROLE_SENTRY_DSN`      | optional secret HTTPS DSN with 32-character hex key and numeric project ID |

Probe/drain budgets retain ADR-032's bounds. DSN comes only from reviewed deployment
secret configuration, never a request or log. No account, collector, exporter
retention or public monitoring ingress is created. Only the executable composition
mains configure Sentry. In-process tests/adapters can inject safe telemetry directly.

Exact GET `http://127.0.0.1:<configured-health-port>/v1/metrics` emits text/plain,
version=0.0.4. Queries, other methods, wrong Host and Origin/Forwarded/proxy headers
are denied. The endpoint is absent when disabled and absent from public API/Bot
transports. Run the scraper in the same network namespace; deployment must protect
host/process access and must never publish/proxy this listener. This is not an
operator authentication or Admin endpoint. The operational OpenAPI adds only this
path; existing frozen health/product baselines remain compatible.

## Measurements

Every series has fixed `service=api|bot|worker`. Scraper job/instance labels are
collector-owned; do not add user-controlled labels.

| Metric suffix (prefix `hambazi_`)                                       | Meaning / dimensions                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `events_total`                                                          | observed attempts; fixed event, operation and stable error_code/NONE   |
| `duration_seconds`                                                      | histogram of observed completion latency; fixed event/operation        |
| `admitting`                                                             | local lifecycle admission flag, independent of dependency status       |
| `dependency_available`, `dependency_probe_seconds`                      | last bounded probe and latency; postgres/redis/backend                 |
| `drain_seconds`                                                         | caller drain completion/failure histogram; completed/failed            |
| `reports_total`                                                         | manual exporter sent/failed/dropped counters                           |
| `collection_success`                                                    | aggregate validity, database/matches/admissions/rooms/outbox/queues    |
| `sockets`, `connected_users`                                            | open authenticated sockets and node-distinct users                     |
| `db_pool_total`, `db_pool_idle`, `db_pool_waiting`, `db_pool_max`       | actual process-owned pg pool counters/configured maximum               |
| `matches_created/waiting/ready/starting/active/finished/terminated`     | retained durable rows by exact lifecycle status                        |
| `matches_started`                                                       | retained rows with durable startedAt                                   |
| `players_disconnected`, `players_bot`                                   | retained seats in the corresponding connection state                   |
| `disconnects_recorded`, `reconnects_recorded`, `bot_takeovers_recorded` | counts of corresponding durable connection events                      |
| `rooms_waiting/full/starting/started/closed/expired`                    | stored room states; expiry is observed after owner transition          |
| `admissions_searching/reserved`, `admissions_oldest_wait_seconds`       | unexpired durable tickets and oldest searching age                     |
| `outbox_pending/failed/oldest_pending_seconds`                          | retained backlog and oldest pending age, including leased/backoff rows |
| `queue_waiting/active/delayed/failed`                                   | sum over enabled owned cleanup/domain/automation queues                |

API collects Match/admission/outbox and enabled Rooms diagnostics. Worker never
reads admission metadata or expands its grants. Worker collects Match/outbox,
pool and queue diagnostics. Bot measures backend readiness/webhook/lifecycle. Worker
queue totals include finish jobs through the domain publisher when outbox is enabled,
or through an opt-in read-only queue handle for a standalone statistics consumer.
Each queue is counted once. Health probes every enabled consumer. Queue removal and
retention affect counts.

`http.completed` uses auth/http classification selected from registered routes;
Socket classifications come from the fixed dispatch enum (command, room, matchmaking,
subscribe, snapshot, catchup, ready, chat, presence). Payload actions/URLs never become
labels. Reconnect is represented by recorded transitions plus snapshot/subscribe
outcomes; subscribe is not claimed to be a unique reconnect. Sockets/users are local,
so summing users across nodes can double-count. Global active CCU needs a reviewed
presence/capacity definition. Rejected commands are counted separately by code;
GAME_STATE_CONFLICT and rule errors are not unexpected Sentry failures.

Snapshots are diagnostic and need not be mutually consistent across separate ports.
Bounded/coalesced scrapes retain one outstanding read per collector; a failed/timeout
sample marks validity false and retains prior numbers, never substitutes healthy zero.
Require collection_success=1 before interpreting a gauge; use scraper freshness/up
as well. Read transactions use existing acquisition/transaction bounds; the shorter
probe deadline bounds callers without cancelling accepted reads. Scrapes add DB load;
no capacity or final scrape interval is claimed. Durable gauges can decrease after
approved restore/retention and must not be treated as monotonically increasing counters.

Histograms use 5/25/100/250/500ms, 1/2/5/15/60 seconds and +Inf buckets. These are
resolution choices, not final thresholds. DB operation latency includes acquisition
and transaction/application callback settlement; probe latency is separate. Process
series reset on restart. A successful drain usually closes the scrape listener before
its final sample can be collected; lifecycle logs and supervisor evidence must also
be retained. A failed drain remains failure even if background cleanup later settles.

## Error reporting

Only manual constructed events reach the Sentry envelope transport. Fields are
server-generated event_id/timestamp, platform/level/logger and fixed message,
fingerprint and service/event/error_code tags. UUID user/match/request identifiers
and local trace IDs are deliberately absent. No raw exception, cause, stack, request,
headers, breadcrumbs, state, chat, token, initData, RNG, source context or attachment
is accepted. The DSN in the envelope header is protocol authentication and is never
copied to the event or Pino. Response content is discarded. Normal input/auth/rule
errors stay in safe counters/logs; unexpected failures use stable codes.

One in-flight report, 60-second per-event cooldown and two-second verified HTTPS
budget bound failures. There is no local spool, automatic retry, SDK auto-capture or
provider activation. Drops/failures are measured. This intentionally sacrifices stack
and identity diagnosis; use allowlisted local correlation to investigate. Flush the
bounded active report at shutdown/startup failure. Once application draining succeeds,
clear its failure-exit timer before the optional report flush so telemetry cannot turn
a successful drain into a failure exit. An active configured reporter can add up to
two seconds after application drain; the external supervisor must account for that
or cut off optional delivery. The existing failure timer still bounds failed drains. External account/access/retention,
consent and deletion configuration need owner approval before setting a real DSN.

## Dashboards, alerts and evidence

[Dashboard definition](../operations/dashboard.json) and
[alert definitions](../operations/alerts.json) document exact available queries,
validity filters, role owners, severity, cooldown and runbook links. They are review
artifacts, not deployed provider resources. SLO burn panels/rules retain unresolved
objective/threshold fields under OD-007; deployment annotation source is the future
approved release ledger (18B), never arbitrary application labels. Routing remains
disabled until on-call assignment, provider configuration and staging verification.

[Runbooks](../operations/runbooks/README.md) cover exploit/maintenance, dependencies,
stuck Matches, rollback and restore, with exact current authority/activation limits.
Local tests exercise real TLS safe envelopes/timeouts, hostile projection, collector
failure/coalescing, private exports, real storage/pool diagnostics and existing
DB/Redis/queue/drain recovery. The disposable backup/restore drill reconciles all
public tables, schema guards and grants. Staging incident response, notifications,
remote uptime, full volume recovery, production PITR/RPO/RTO and capacity remain gates.
