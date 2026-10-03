# Operational runbooks

Reviewed against the current repository in Phase 16C. This is a procedure set,
not authorization to operate a live service. The incident commander assigns named
operators and records approvals, environment, timestamps and evidence in the private
incident record. Owner roles in [alerts](../alerts.json) must be assigned before routing.

| Incident                         | Owner            | Procedure                           |
| -------------------------------- | ---------------- | ----------------------------------- |
| Exploit / planned maintenance    | Backend on-call  | [Maintenance](maintenance.md)       |
| Database degradation             | Database on-call | [Database](database-degradation.md) |
| Redis / queue loss               | Backend on-call  | [Redis](redis-loss.md)              |
| Stuck Match / reconnect failures | Backend on-call  | [Match recovery](stuck-match.md)    |
| Bad release / failed drain       | Release on-call  | [Rollback](rollback.md)             |
| Data recovery                    | Database on-call | [Restore](restore.md)               |

Common diagnosis: inspect safe Pino events/correlation, local exact-GET health and
metrics, supervisor exit status and the approved release ledger. Probes/metrics are
loopback-only; access from the process network namespace. Never add proxy exposure
or copy `.env`, DSNs, initData, tokens, chat, deck/card/state/event payloads, RNG,
raw SQL errors or dumps to tickets/logs/Sentry. Count-only diagnostics are sufficient
for dashboards; raw durable data remains restricted to the owning recovery service.

For an already configured health port, these read-only probes exist:

```sh
curl --silent --show-error http://127.0.0.1:<health-port>/v1/health/live
curl --silent --show-error http://127.0.0.1:<health-port>/v1/health/ready
curl --silent --show-error http://127.0.0.1:<health-port>/v1/metrics
```

Replace `<health-port>` with the role's reviewed configuration; do not run a literal
placeholder. Read status codes/body: readiness 200 READY/DEGRADED, 503 NOT_READY;
metrics are 404 unless explicitly enabled. Metrics remain inspectable during a
required dependency outage. Validate scrape freshness/up and collection_success
before trusting retained gauges. Local health does not prove ingress, all SQL grants,
queue scripts, Telegram delivery or recovery correctness.

Production catalog admission is still disabled pending 7C. Gameplay/chat/statistics
are opt-in. No live per-game kill-switch, authorized public Admin route, general
recovery CLI, approved provider supervisor or release deployment exists yet.
Trusted Match lifecycle/outbox ports are available to separately approved operator
composition; they are not client APIs. Exact provider/supervisor/migration/backup
commands must be selected and rehearsed in 18B. This phase executes only disposable
local tests/drills and records those external limits. Do not infer deployment or
mutation approval from these documents.

Phase 17A3 supplies the [administrative security design](../../security/admin-security-design.md)
and ADR-039 for separate MFA/RBAC/private access and durable append-only audit.
It is a design, not operator composition or authorization. 7C must implement and
verify it before activation; no direct SQL, player/Bot credential or incident
authentication bypass is added by these runbooks.

Return to normal only after the commander accepts durable consistency, dependency
recovery, backlog reconciliation and the relevant staging verification. Reopening
admission cannot authorize 7C activation or finalize OD-002/005/006/007.
