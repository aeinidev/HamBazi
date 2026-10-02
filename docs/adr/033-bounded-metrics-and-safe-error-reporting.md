# ADR-033 — Bounded metrics and safe error reporting

- **Status:** Accepted — reversible infrastructure details within authorized Phase 16C.
- **Owner:** HamBazi engineering; deployment, routing and final operational policies remain owner decisions.
- **Date:** 2026-10-02
- **Supersedes:** None. Extends ADR-031 and ADR-032.

## Context

Architecture 21 requires bounded diagnostics, safe Sentry reporting, actionable
alerts and recovery runbooks. Product payloads, hidden state, chat, credentials and
RNG material cannot enter any telemetry export. Provider/region, final SLOs and
backup/PITR/retention remain OD-002/006/007. Public catalog activation remains 7C.

## Decision

Own a small Prometheus 0.0.4 text registry in the existing infrastructure-only
Observability package. All names/dimensions come from fixed enums; no generic label
API, arbitrary route, ID, URL, game action, exception or payload is accepted.
Process counters/histograms reset on restart. Durable counts are aggregate gauges,
not exactly-once event counters. Match, admission, connection-event and outbox
aggregates belong to Matches' existing scoped infrastructure; Rooms owns its own
aggregate port. Queries select counts/timestamps only and use bounded transactions.
Composition collects these public ports with coalesced deadlines. Failed samples
retain last values with collection_success=0; consumers must gate on validity.
Each process can have one outstanding read per collector after a deadline.

Expose exact GET `/v1/metrics` only when ROLE_METRICS_ENABLED=true and the existing
ROLE_HEALTH_PORT is configured. Use ADR-032's separate loopback access restrictions;
never mount on public HTTP, Socket or private Bot product transport. Scrapes refresh
read-only health and diagnostics. Fixed latency buckets are distribution resolution,
not production SLO thresholds. Dependency probe latency is distinct from actual DB
operation latency. Read-only pool counts use the already-pinned pg Pool through the
supported Prisma adapter constructor, retaining adapter disposal and all existing
connection/transaction settings. Metrics never grant access to business data.

Add an opt-in manual Sentry envelope transport, activated only by a role-specific
secret-wrapped HTTPS DSN. Construct an event with server-generated ID/time, fixed
service/event/error code/message/fingerprint only. No automatic exception capture,
SDK integrations, user/request context, breadcrumbs, stacks, tracing, profiling,
replay, attachment or browser exporter. HTTPS verifies certificates, has a two-second
absolute request budget, discards response content and rejects redirects. Permit
one in-flight report and one report per fixed event per minute; discard additional
reports without persistence/retry. Transport failure cannot change application work. Successful application draining
clears its failure-exit timer before the optional bounded report flush; a configured
active reporter may add up to two seconds, requiring supervisor budget review.
These bounds are engineering safeguards, not final sampling/retention policy.
Expected client/rule/conflict failures remain codes in local logs/metrics.

Dashboard/alert definitions are provider-independent reviewable JSON. Alerts name
an owner role, severity, linked runbook and cooldown. Routing is disabled pending
operator assignment/staging approval. Final target-dependent thresholds stay null
with OD-007 references; structural availability/failure signals are usable without
inventing launch SLOs. Actual Grafana/Prometheus/Sentry accounts, remote uptime,
notification delivery, deployment annotations and incident permissions are not
selected or activated here.

Recovery documentation uses current owning ports and real scripts. Trusted lifecycle
TERMINATE and outbox redrive exist; no public Admin route or CLI authorization is
invented. Maintenance may require broad ingress containment/draining because a
per-game live kill switch is not implemented. Logical backup/restore rehearsal is
restricted to harness-created disposable PostgreSQL; it does not select production
PITR/RPO/retention or authorize restoring live data.

## Alternatives

- A general metrics/SDK capture API: convenient but increases payload/cardinality
  and automatic context collection risk.
- A new monitoring dependency/provider deployment now: unnecessary to establish
  safe local exports, and prematurely selects OD-002/007 operational policy.
- Export raw errors and scrub afterwards: cannot establish deny-by-default privacy.

## Consequences

Operations can diagnose local service/dependency/drain, pool, backlog and application
failure signals without observing hidden data. Safe reports trade away stack-level
debugging and identity correlation; local allowlisted Pino correlation remains the
investigation path. Aggregate queries add bounded DB load requiring Phase 17C
measurement. Node-distinct users are not global CCU. Queued delivery metrics count
attempts, not unique logical outcomes. Restore/archive access, monitoring access and
retention, alert routing, SLO burn targets, staging fault/restore/rollback drills and
live activation remain explicit later gates.

References: [Prometheus exposition specification](https://prometheus.io/docs/instrumenting/exposition_formats/),
[Sentry envelope specification](https://develop.sentry.dev/sdk/foundations/envelopes/).
