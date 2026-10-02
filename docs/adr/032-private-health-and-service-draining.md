# ADR-032 — Private health and service draining

- **Status:** Accepted — reversible infrastructure details within authorized Phase 16B.
- **Owner:** HamBazi engineering; deployment and final operational policy remain owner decisions.
- **Date:** 2026-10-02
- **Supersedes:** None. Extends ADR-031 and preserves preceding dependency-failure behavior.

## Context

Architecture 19.4 separates process liveness from dependency readiness and requires
readiness=false, admission stop, HTTP/Socket/job draining and transaction completion
before shutdown. Existing API sessions/logout depend on PostgreSQL and deliberately
survive Redis outages. A readiness check that removes every API instance when Redis
fails would contradict that policy. Existing service adapters already close their
transports and queues, but lack a shared lifecycle signal and uniform bounded caller
deadlines. A closed client socket does not prove its application write has finished.

## Decision

Keep operational HTTP separate from product ingress. Optional role-specific health
ports bind only `127.0.0.1`, require the exact local Host, reject browser/proxy headers
and expose exact GET `/v1/health/live` and `/v1/health/ready` paths. Ports have no
default and deployment must opt in. Responses contain only schemaVersion=1 and a
fixed status; no dependency names, addresses, errors, credentials or application
data. Do not publish this listener, add proxy rules or select final hosting/access
policy in this phase. Local process access is the trust boundary; this listener
does not provide remote operator authentication or admin authority.

Shared server infrastructure owns monotonic STARTING -> READY -> DRAINING -> STOPPED
state and bounded, coalesced dependency probes. Liveness does not call downstream
services. Readiness returns NOT_READY during startup/draining or required dependency
failure; a late successful probe cannot undo a drain. An adapter ignoring abort
keeps one underlying probe slot until it settles, rather than accumulating requests.

API Health owns the application readiness policy through injected infrastructure
ports: PostgreSQL is required; each enabled Redis limiter is degradable. DEGRADED
returns 200 so durable session/logout traffic remains routable, while individual
capabilities retain their existing failure policies. Worker requires PostgreSQL
and every enabled queue/publisher connection. Bot requires its authenticated private
API readiness. The private TLS API exposes a service-authenticated GET readiness
probe requiring both database and privileged admission Redis; it bypasses product
rate counters, performs no mutation, uses existing peer/scope restrictions and
never attaches to the public API. Its responses are additive to the existing v1
Bot contract. A separate v1 operational OpenAPI baseline covers local health.

Database infrastructure exposes a fixed transactional SELECT 1 probe, with the
existing acquisition/transaction bounds and sanitized errors; no raw query/table
surface is added. Redis limiters use abortable PING. Pinned BullMQ 6's public Redis
backend exposes INFO; queue probes require connection readiness, perform that
read-only round trip and discard all returned details. Probes never spend admission
counters, create jobs or export raw diagnostics. They do not prove every SQL grant,
queue script or application rule is healthy.

Close is idempotent. Mark readiness false first, stop new HTTP/Socket intents and
queue claims/polling, then wait for accepted handlers/jobs and current outbox work.
Track application handlers independently of response sockets, including client
aborts. Already admitted Socket commands retain their owning-port outcome. Pause
queues locally; do not delete shared schedules, reservations, outbox rows or jobs.
Keep database and outbound clients available until accepted work settles. If a
feature-specific job drain fails early, service teardown also awaits its separate
settlement signal before closing the database.
An already fetched job racing a local pause returns to waiting through BullMQ's
public transition and WaitingError, without spending a failure attempt.

Caller drain deadlines report a sanitized failure without cancelling the underlying
application work or calling it drained. Background teardown can complete when that
work settles. Supervisors retain a hard failure exit, one second after the configured
drain budget, for stuck processes; interruption may roll back an in-flight transaction
or leave an unacknowledged job for existing idempotent recovery. It does not justify
claiming success, exactly-once delivery or a new recovery guarantee.

Role-specific validated operational overrides bound probe waits to 100–5000 ms
and drain waits to 1000–120000 ms. Defaults preserve existing API/Worker 15000 ms
and Bot 30000 ms supervisor budgets, and the existing one-second Redis probe bound.
These compatibility defaults and safety bounds are not finalized SLOs or a chosen
production configuration; operators must budget service drain against supervisor
and ingress deadlines before activating a deployment.

## Alternatives

Mount unauthenticated detailed health on public product listeners: unnecessary
exposure and ingress coupling. Require Redis for all API readiness: prevents the
approved durable logout behavior during a complete Redis outage. Use connection
status alone: misses a failed round trip. Force-close the database at a deadline:
confuses an unfinished accepted write with completed draining. Wait indefinitely
without reporting failure: prevents bounded supervision.

## Consequences

Health/drain behavior is locally testable without a new dependency, migration,
grant or production activation. Probes add unmeasured pool/Redis traffic and coalesce
concurrent requests, not a production polling or capacity policy. Local health is
optional for release overlap; preceding code ignores the new environment settings.
Existing product contracts and capability flags remain unchanged except for the
additive authenticated private health path. Metrics, Sentry, remote health exposure,
provider, uptime/alert thresholds, incident drills and final deployment policy remain
16C or OD-002/006/007 and Phase 7C decisions.
