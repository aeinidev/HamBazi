# ADR-031 — Shared safe telemetry and causal correlation

- **Status:** Accepted — reversible infrastructure details within authorized Phase 16A.
- **Owner:** HamBazi engineering; open product/operational decisions remain with their documented owners.
- **Date:** 2026-10-02
- **Supersedes:** None. Extends the correlation handoff in ADR-024 without replacing its envelopes, persistence or delivery semantics.

## Context

Architecture sections 3.2, 11.8 and 21 require allowlist logging and correlation
through requests, transactions, outbox and workers. API/Bot already project safe
HTTP fields, while Worker directly binds observer fields to Pino. Existing Match
and Chat outbox envelopes and nullable storage columns support UUID request IDs
and validated W3C version-00 traceparent. Several production adapters generate
request IDs without a trace, and consumer execution does not bind an async scope.

## Decision

Create a Node-only `@hambazi/observability` infrastructure workspace. It owns the
existing pinned Pino version and exposes a fixed-event logger and an immutable
async correlation scope. API, Bot and Worker import only its root surface; domain,
engine, Web and persistence packages do not acquire this dependency. Enforce direct
Pino ownership and prohibit console calls in product source with existing lint
and architecture gates. Scripts/test harnesses retain their own safe diagnostics.

Only own scalar data properties with validated values reach Pino: architecture's
request/user/room/match/action IDs, stateVersion, durationMs and stable errorCode.
Event names are enumerated. Add only `traceId` and `spanId`, derived from validated
traceparent, to the telemetry allowlist. No arbitrary message, bindings, child
logger, raw Error/stack, payload, object serialization, URL, request header, token,
initData, content, deck/card/state or RNG material is exposed. Projection does not
invoke getters/toJSON. Invalid fields are omitted; invalid events are ignored.
Emitter/write failures are best effort and cannot change an application effect.

Public HTTP and each acknowledged Socket intent start server-owned roots using
CSPRNG UUID request IDs and nonzero CSPRNG trace/span IDs. Ignore public request-ID,
traceparent, tracestate and baggage headers. Use AsyncLocalStorage.run for isolated
scopes, capture context when work is queued, and restore the caller after throws
or rejection. A validated internal parent retains its trace ID/request ID and
gets a fresh span ID. Unspecified Match/Chat/reconnect metadata inherits the current
scope or starts a server root; explicitly supplied metadata keeps its existing
strict schema and behavior. Matchmaking ticks, Presence and automation recovery
also supply causal context. Engine clock/random/rules and replay remain unchanged.

Bot may transmit only the current traceparent to its fixed-origin internal HTTPS
client. The private API listener continues a syntactically valid parent only after
existing service authentication and direct-peer checks; it still generates its own
request ID. Invalid/duplicate headers are ignored for telemetry and do not change
authentication or product decisions. Public listeners never trust them.

The transaction writes the same existing request/trace columns and v1 envelope.
Dispatcher and consumers create child scopes from validated durable metadata;
publish payloads and event IDs remain unchanged. Jobs with absent/empty correlation
continue to work by starting a local root; do not backfill historical metadata or
rewrite queued inputs. Log successful/failed queue work with IDs and duration,
without result/game/chat payloads. A completion log is diagnostic and is not a
durable receipt or proof of exactly-once delivery.

## Alternatives

Keep independent logger implementations: fewer package edges, but projection
and field enforcement can drift. Put helpers in Shared or Game Core: violates
their framework-free/shared-primitive ownership. Install a complete tracing SDK
and automatic request/database instrumentation now: unnecessary for the first
handoff milestone and increases sensitive-data export surface before reporting
and provider configuration are reviewed.

## Consequences

Infrastructure has one reviewable logging surface and existing service APIs remain
compatible. IDs correlate logs across async/durable boundaries; they are not metric
dimensions. CSPRNG and async-context work add unmeasured overhead; capacity is not
claimed. Only existing dependency versions are reused and no database migration
or grant change is needed. Strict event/field additions require package review.

This is OpenTelemetry-compatible identifier propagation, not installed/exported
OpenTelemetry spans. No collector, Sentry account/DSN, sampling/export policy,
retention/provider, finalized SLO/alert threshold, health exposure, operational
admin authority or production activation is selected. Those remain 16B/16C or
the existing OD-002/005/006/007 and 7C gates.
