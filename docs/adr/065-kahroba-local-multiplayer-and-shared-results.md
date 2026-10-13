# ADR-065: Kahroba local multiplayer and versioned shared victory

- Status: Accepted for local K2 under the owner's explicit 2026-10-12 request; no public/staging activation
- Owner: HamBazi product owner
- Date: 2026-10-12
- Related: ADR-064, ADR-030, Match processing/reconnect/outbox and production HOLD
- Supersedes: none; existing v1 contracts, engine pins and Coup/Anarchist rules remain valid

## Context

K1 provides a pure disabled Kahroba engine with owner-private reservations and multiple winners. Existing Match processing already owns locks, optimistic versions, durable receipts, complete transactions, event audit and outbox. Existing result tables use version integers, JSONB envelopes, unique Match/per-seat keys and a per-seat winner boolean; no schema expansion is needed.

## Decision

1. Add an opt-in API composition adapter and capacity/mode descriptor lookup. Keep all live API/Worker composition, catalog filtering, web routing, personal staging admission and Telegram policy unchanged. Only explicitly isolated tests supply an eligible Kahroba catalog and seed a disabled synthetic game record.
2. Require the pinned K1 untimed rules explicitly. Reject timed configurations and timed snapshots in this K2 adapter. No human timeout policy or duration is selected. Existing committed BOT seats can use the explicit bot policy through the existing guarded Worker port; no new takeover grace/default is enabled.
3. Keep standard/v1 result parsers and `MATCH_FINISHED_V1` unchanged. Introduce result schema 2 and `MATCH_FINISHED_V2`, outer/payload schema 2, on `match-finished-v2`. Shared validation belongs to the existing validation package; no new dependency or service is introduced.
4. Persist all winning IDs, an explicit SOLE_VICTORY/SHARED_VICTORY outcome, equal placements and the structural legacy winnerId (null for shared). Winners must exactly equal the unique first-place entries. Only Kahroba is an approved v2 producer in this phase.
5. Write v2 Match result JSON and per-seat schema-2 rows in the same existing finish transaction. Set every winner's existing boolean true. Preserve the single durable finish event and Match/per-seat uniqueness. Replays verify the original envelope, roster, finish counters/time, pins and outbox identity.
6. Retain both queue handlers and v1/v2 result recovery/rebuild. Statistics credits each v2 winner one win, every seat one completion, with existing receipt and generation/Match/digest guards. Coup v1 credit remains unchanged.
7. Publish only the existing state-free invalidation, then construct recipient-safe views through the pinned adapter. Raw audit events and persisted snapshots are never client publications. Reconnect uses existing sessions, leases and epoch/version guards without changing engine state or deadlines.
8. Exercise real disposable PostgreSQL, Redis, Socket.IO and BullMQ through a declared local test inventory. Existing migrations initialize only a newly created disposable schema; no new migration is created/applied to any existing environment. Native Telegram and K3 rendering are outside this authorization.

## Alternatives

- Choosing one co-winner or storing shared victory as a draw loses approved semantics and is rejected.
- Changing v1 payloads or collapsing both queues would break retained consumers and is rejected.
- Creating new result columns/tables, a separate Kahroba backend or new infrastructure is unnecessary.
- Public catalog/route activation or selecting a human fallback exceeds K2 authorization.

## Compatibility and rollout strategy

No database migration is required. Future authorized rollout deploys dual readers/consumers before enabling any v2 producer. Retain v1 handlers and active engine pins. A rollback must disable Kahroba production first, drain/retain the v2 queue, and preserve a v2-capable recovery/rebuild reader; older code cannot rebuild v2 truth. Do not downgrade or fabricate a sole winner. No rollout or deployment is performed in K2.

## Consequences

Kahroba can use the platform locally at all three capacities without public availability. Each co-winner gets one win even across retries/rebuild, and equal winning placements remain durable. The v2 contract baseline is checked alongside all existing API contracts. Runtime timing, private staging/public admission, release rights and native acceptance remain separate decisions.
