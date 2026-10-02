# Observability boundary

Phase 16A implements shared safe logging and causal metadata. Parent Phase 16 is
complete with its available local evidence: dependency health/draining is documented
in [16B](health-and-draining.md), and metrics/reporting/dashboard/alert/runbooks in
[16C](operational-observability.md). These documents do not authorize live activation,
administrative mutations or a real external telemetry target.

## Ownership and safe fields

`@hambazi/observability` is server infrastructure with a single public root export.
Only it imports Pino. API/Bot adapters retain their existing lifecycle/completion
methods and counters, delegating serialization to the package. Worker startup,
outbox/automation/domain work and the statistics maintenance CLI use that surface.
The architecture check rejects direct Pino imports in other workspaces, telemetry
imports into domain/engine/Web, and console calls in product source.

Allowed record fields are `event`, `requestId`, `userId`, `roomId`, `matchId`,
`actionId`, `stateVersion`, `durationMs`, `errorCode`, `traceId`, `spanId`, plus
Pino's numeric `level`. Events/codes are enumerated, IDs are canonical UUIDs,
versions are bounded nonnegative integers, durations are finite nonnegative
milliseconds, and trace/span IDs come only from validated traceparent. There is
no dynamic text or arbitrary binding/serializer interface. All unknown fields,
arrays, nested objects, raw errors/stack, headers, bodies, auth material, names,
chat, cards, deck, state and RNG material are discarded. Getters and toJSON are
not called during projection. Safe projection is not permission to relabel a
secret as an identifier; owners must supply actual verified application IDs.

## Context lifecycle

HTTP hooks run downstream work inside a fresh server-generated correlation scope;
`X-Request-Id` remains the existing support reference. Public client headers cannot
choose that request ID or trace. Every acknowledged Socket intent gets a separate
root before entering its per-socket queue, so an earlier operation cannot lend
its context to the next. Session credentials stay in the existing private weak
map; only validated intent IDs can enter completion metadata.

Match, Chat and reconnect ports inherit current metadata when the optional context
is omitted. Valid explicitly supplied metadata retains its existing schema.
Atomic owner repositories persist the existing request/trace columns alongside
state/events/receipts/outbox. No I/O/export is added inside a transaction and the
engine never imports instrumentation. Matching retries retain the first committed
outbox/context and do not rewrite it with the retry's request ID.

Outbox dispatch binds a child context per claimed event; domain, realtime and
automation consumers validate first, then create another child scope. The trace
ID and originating request ID survive while each hop has a fresh span ID. Socket
fanout on another Redis node reconstructs context from the same validated wakeup.
Observation failures cannot turn a committed effect into a failed job. Stable
event/job identities, leases, retries, deduplication and at-least-once delivery
retain their previous semantics. Legacy empty metadata starts a local root;
causality before that point is unavailable rather than invented/backfilled.

Bot's webhook starts its own server root, then sends only traceparent through its
existing fixed-origin HTTPS backend client. The internal listener accepts it only
after service/peer authentication and generates its own request ID. Invalid,
duplicate or unauthenticated parent headers cannot enter the trusted scope. No
baggage/tracestate/user-provided attributes are propagated.

These are compatible trace identifiers and async scopes, without a span exporter.
Initial roots use the unsampled flag; no production export/sampling percentage is
chosen. Pino's existing no-base/no-timestamp setup is preserved in this subphase;
collector timestamps remain collector-owned. [16C](operational-observability.md) adds
metrics/reporting configuration; deployed annotations remain a release-ledger gate. HTTP status-based completion code
mapping remains the existing adapter mapping; it is not a replacement for an
owning use case's exact error code or a metrics taxonomy.

## Validation and operation

Use declared commands after dependency builds (Turbo orchestrates them):

```sh
pnpm install --frozen-lockfile
pnpm --filter @hambazi/observability test
pnpm --filter @hambazi/api test
pnpm --filter @hambazi/worker test
pnpm --filter @hambazi/bot test:integration
pnpm lint
pnpm check:architecture
pnpm typecheck
pnpm build
pnpm --filter @hambazi/api contract:check
```

The existing isolated `pnpm test:auth-http:local` harness requires documented
`TEST_POSTGRES_BIN`/`TEST_POSTGRES_SHARE` and distribution library paths; it creates
and cleans disposable PostgreSQL/Redis services. Correlation tests cover inherited
atomic context/idempotent retry and real BullMQ dispatch/consumption, alongside
existing compatibility, lease/rollback/privacy and restart regressions. HTTP and
Socket tests cover concurrent isolation with synthetic credentials. TLS Bot tests
cover trusted parent transfer; telemetry tests inject secret markers and hostile
objects. These local checks are not a production export, uptime/alert drill,
capacity test, staging Telegram smoke or backup restore rehearsal.

No external credentials are needed for 16A. Consumers of logs must protect access
to account/Match/request IDs under the future approved telemetry retention and
access policy. Rollback to the preceding application remains possible because
nullable columns, v1 envelopes and old job shapes are unchanged. New jobs carrying
valid request/trace metadata are already understood by the preceding version.

Phase 16C's [metrics and safe reporting](operational-observability.md) adds one fixed
`operation` enum to the telemetry allowlist (server-selected auth/http/webhook or
Socket dispatch class), database completion measurements and private aggregate
exports. This is never a command/action payload or arbitrary route/name. Manual
Sentry events project away identifiers/context before export. See ADR-033 and the
linked runbooks for deployment/retention/alert limitations.
