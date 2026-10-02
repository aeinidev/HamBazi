# Health and draining

Phase 16B implements private health and service draining under ADR-032. This is not
deployment approval, a public uptime monitor, metrics export or an incident runbook.

## Operational configuration

For each role use the API, BOT or WORKER prefix:

| Setting                          | Behavior                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `<ROLE>_HEALTH_PORT`             | Optional integer 1–65535; absent means no extra listener. Bind is always 127.0.0.1. |
| `<ROLE>_HEALTH_PROBE_TIMEOUT_MS` | Optional 100–5000 ms; compatibility default 1000.                                   |
| `<ROLE>_DRAIN_TIMEOUT_MS`        | Optional 1000–120000 ms; existing API/Worker default 15000, Bot default 30000.      |

These are bounded technical compatibility settings, not finalized SLOs. Choose
unused local ports and budget drains against supervisor/ingress timeouts in the
deployment review. Do not map health ports through a public proxy, expose them on
container host interfaces, or add them to Mini App CORS. No health credential or
public bind option is implemented. Local host/process isolation must protect the
listener. A same-host operator can use an ordinary HTTP GET to the exact
`http://127.0.0.1:<configured-port>/v1/health/live` or `/v1/health/ready` URL;
`localhost`, browser Origin, proxy headers, query strings and alternate methods
are rejected. Ports cannot collide with product listeners. No environment value
or dependency detail is returned or logged by probes.

## Signals and dependency behavior

All bodies have only `schemaVersion: 1` and `status`:

| Probe / state                                       | HTTP status / body status | Meaning                                                                                                             |
| --------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Liveness while the process responds                 | 200 / LIVE                | Independent of application admission state and dependency I/O.                                                      |
| Readiness before startup or during drain            | 503 / NOT_READY           | Do not admit new work.                                                                                              |
| Required dependency failure/deadline                | 503 / NOT_READY           | Service cannot meet its required dependency contract.                                                               |
| All required and optional dependencies work         | 200 / READY               | Current checks succeed.                                                                                             |
| API Redis limiter failure with PostgreSQL available | 200 / DEGRADED            | Preserve durable session/logout routing; owning capabilities still fail/degrade according to their existing policy. |

API checks PostgreSQL through its fixed database probe and every enabled limiter
through its public probe. It does not acquire access to another module's tables.
Bot's private API GET readiness is service-authenticated over the existing fixed
HTTPS origin and direct-peer policy. The private API requires PostgreSQL and its
own admission Redis connection, without consuming onboarding counters. The public
API never mounts that route. Worker requires PostgreSQL, cleanup queues and every
enabled outbox publisher, automation and statistics consumer transport. Disabled
capabilities are not required and remain disabled; Phase 7C is still required for
live gameplay orchestration.

Probes are read-only, bounded and coalesced. The PostgreSQL transaction uses existing
pool/transaction limits; an ignored cancellation may outlive the caller's deadline,
but repeated probes share one underlying operation. Redis uses PING; BullMQ 6 uses
the public backend's ready status and INFO round trip, discarding the details.
Successful dependency checks are not proof of every permission, job script or use
case. Readiness does not revoke sessions, mutate shared schedules, toggle feature
flags or restart a service. Route admission during dependency outages continues
to follow the existing owning-module policy.

## Shutdown sequence

1. Mark readiness NOT_READY and stop new application admission synchronously.
2. Reject new HTTP requests/Socket intents; stop queue claims and recovery/outbox
   polling. Keep already admitted Socket commands eligible to finish.
3. Drain HTTP handlers, Socket queues, accepted jobs, current outbox work and their
   transactions. A client abort or closed Redis worker is not a settlement proof.
4. Close outbound clients, queue/publisher transports and database after application
   settlement. Close health after marking the service stopped.

Repeated close calls share one promise. Caller deadlines return failure and retain
resources needed by pending accepted work; background cleanup can finish later.
The process supervisor's hard failure exit follows one second after the drain
budget. An interrupted transaction/job uses the existing atomic/idempotent recovery
semantics and may require retry; no successful-drain claim is made on timeout.
Statistics/automation feature deadlines remain supported, and Worker also awaits
their application settlement before database teardown. Queue pause is local and
does not remove shared schedules or accepted jobs. Existing delayed jobs and v1
payloads retain their identities and handlers.
An already fetched job racing pause returns to waiting without spending a failure
attempt; it remains eligible for another worker after this instance drains.

## Compatibility, verification and limits

Local health OpenAPI and its v1 baseline are checked by the existing API
`contract:check` command through `bot-contract.mjs`; the private Bot addition is
checked against the unchanged prior Bot baseline. Previous product paths/schemas
and database migrations are unchanged. Existing deployment settings omit health
ports and therefore create no new network listener on upgrade. Rollback can ignore
these settings; do not promise a successful interrupted drain during rollback.

Use existing declared scoped tests/typechecks and the root lint, architecture,
format, typecheck, build and contract checks. The isolated
`pnpm test:auth-http:local` harness uses documented PostgreSQL paths and disposable
Redis/PostgreSQL services; it does not operate on project or live data. Coverage
includes real connection failure/recovery, HTTP client-abort settlement, admitted
Socket command drain, private TLS health without counter mutation, actual Worker
transactions during deadline failure, and repeated service shutdown. Browser E2E
does not validate these server operations. Public HTTPS/Telegram, remote monitoring,
network-partition/load/soak and incident/restore drills remain separate gates.
