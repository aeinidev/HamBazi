# ADR-012 — Versioned shared contract and validation foundation

- **Status:** Accepted for the Phase 5A foundation
- **Owner:** HamBazi engineering
- **Date:** 2026-09-14

## Context

Architecture sections 10.4 and 15 require versioned commands, recipient-safe
events, reconnect counters, and stable machine-readable errors. The database
foundation already stores UUID identities and INTEGER sequence/version counters.
Shared packages were empty. Feature modules and transport adapters need a small
common vocabulary without importing Prisma, introducing Coup rules, or deciding
the open session, retention, deployment, and launch policies.

## Decision

Keep the dependency direction `validation → contracts → shared`; validation also
reads shared error codes directly. Shared exports only the initial stable public
code catalog. Contracts owns framework-free TypeScript envelopes, constants,
semantic ID aliases, and construction of safe static error responses. Validation
uses the existing pinned Zod 4.6.2 from ADR-010, with no second validation library.
No package exports internal paths or database models.

Introduce transport schema version 1 independently of the engine, persisted-state,
and ruleset versions. UUID validation checks format only (including RFC nil/max
sentinels); it does not establish existence, identity, uniqueness, or authorization.
Use case owners decide admissibility. Do not select a UUID generation algorithm,
coerce IDs, or convert Telegram IDs to JavaScript numbers. Versions/history cursors
are nonnegative INTEGER-compatible numbers; actual event sequences start at one.
Counter storage expansion requires an additive database migration before a wider
wire range is accepted.

Command envelopes are strict and contain only schemaVersion, actionId, matchId,
expectedVersion, and a feature-validated command. Authenticated actor identity is
connection context, not an envelope field. Each owner supplies an explicit payload
schema. A generic envelope never establishes command legality or authorization.

Match event/snapshot and page response schemas are receiver schemas: they strip
unrecognized envelope fields. Feature receiver schemas should similarly tolerate
safe additive fields. Required fields remain required; unsupported versions and
incorrect event types fail. Event `payload` and snapshot `view` must already be
projected by the owning Match/Game Module. These are not internal replay events,
and a parser is not a hidden-information projector. Feature payloads are checked
for JSON input/output so transforms cannot silently introduce Date/BigInt or
other non-JSON data.

Page requests use an explicit numeric limit and optional nonempty opaque cursor;
each endpoint supplies its maximum. Responses contain items and nextCursor, with
null marking completion. Do not choose product limits, sorting, cursor encoding,
signing, expiry, or HTTP query coercion in this phase.

Server error construction accepts only known codes and fixed safe messages and
retryability hints. Receiving clients accept unknown well-formed future codes and
must implement a generic fallback; adding a code must not invalidate older error
decoders. Clients never branch on message text. Retryable is not permission to
blindly repeat a mutation: state conflicts require resync; rate limits require
backoff; a retry retains its action ID. Use cases will map infrastructure/domain
failures instead of forwarding raw database exceptions.

`parseContract` accepts synchronous schemas and returns either typed data or a
fixed INVALID_INPUT envelope. Raw Zod errors, rejected values, property paths,
custom messages, and thrown causes are not returned or logged. Negotiation and
minimum-client-version checks belong to future adapters; rejecting a version here
does not implement CLIENT_UPGRADE_REQUIRED negotiation.

Zod's public declarations reference the cross-runtime URL type. Only validation's
source/build configs opt into DOM library declarations; no DOM runtime is used.
Shared/contracts and the pure engine presets remain unchanged. Test compilation
has a separate Node preset and the existing test-local Vitest performance alias.
Keep skipLibCheck disabled rather than hiding dependency declaration errors.

## Alternatives

- Import Zod into contracts and infer every DTO there: couples all contract-only
  consumers to the validation library. Separate pure contracts plus compile-time
  schema assertions keep the dependency explicit, at the cost of duplicated shapes.
- Treat payload as unknown and only check its envelope: accepts unvalidated game
  input. Schema factories require owner-supplied schemas; tests include malformed
  feature payloads, not only envelope structure.
- Strictly enumerate all received error codes or reject all new server fields:
  breaks old clients on additive releases. Keep strict inbound intents but tolerant
  receivers. Newly added optional command fields still require server-first rollout.
- Include raw validation issues in responses: easier diagnostics but can expose
  hidden input and attacker-controlled text. Return a fixed safe code instead.

## Consequences

This is a tested baseline, not a complete OpenAPI/AsyncAPI catalog or a live
transport. Feature phases must define specific schemas and fixtures, preserve
current/previous client compatibility, and review public contract diffs. Removing
or renaming fields, changing their meaning/type, or narrowing accepted input is a
breaking change requiring a versioned compatibility path and ADR. Generated
catalog/diff automation remains the realtime/CI phase gate.

Transport owners must enforce request size/depth/rate limits before synchronous
validation. Feature schema authors must not use unknown/any as a replacement for
domain validation, perform I/O in refinements, or accept raw state as a public view.
Error messages and validated payloads are not approved telemetry fields. Durable
idempotency, ordering, gap recovery, authorization, and information-flow tests
remain required in their owning phases. No architectural open decision is resolved.

## References

- [Zod schema APIs: object strictness, composition, and JSON](https://zod.dev/api)
- [Contract ownership and compatibility conventions](../architecture/contracts.md)
