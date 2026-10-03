# ADR-039: Separate administrative authority and audited owner-port mutations

- Status: Accepted security requirements/design for Phase 17A3; implementation
  and provider/role assignments require the separately authorized Phase 7C gate
- Owner: HamBazi engineering; product/operations owns provider, operators and approvals
- Date: 2026-10-03
- Related: ADR-018, ADR-023, ADR-030, ADR-031, ADR-033, ADR-036; architecture section 16

## Context

Games configuration remains read-only and disabled in production. Trusted Match
termination and statistics rebuild capabilities exist only for reviewed internal
composition. Neither player sessions nor scoped Telegram Bot credentials confer
operator authority. The architecture requires separate authentication, RBAC,
MFA, private network restrictions and append-only audit before live controls.
There is no approved identity provider, operator roster or deployment network.

## Decision

Keep the public API free of operator mutations. The future Admin module owns
separate identity/authorization/audit ports and a private TLS listener/origin,
audience and keys. Deny player/Bot credentials, unsolicited issuer/key URLs and
spoofed proxy identity. Require both verified operator identity with MFA and
approved private peer/network access; neither substitutes for the other.

Authorize explicit capabilities per action, deny unknown roles and recheck
current authorization, revocation and MFA freshness even on retries. The
[design](../security/admin-security-design.md) proposes a capability matrix and
phishing-resistant step-up requirements for owner review; it assigns nobody and
selects no provider, numeric session lifetime or product-session refresh policy.

Call only owning application ports. Games checks revisions/readiness/admission;
Matches preserves its atomic writer and pinned active behavior; statistics
rebuild uses the existing trusted generation workflow. Admin does not query or
mutate foreign repositories/tables or obtain hidden game/chat/auth payloads.

Before any mutation, durably append a bounded, content-free admission audit
record. Audit unavailability denies new mutations. The owner commits the effect,
idempotent receipt and content-free outcome outbox in its own transaction.
Admin appends deduplicated outcome events from that outbox; it never pretends a
cross-module network call shares one database transaction. Stable actor-bound
command identity and durable receipts resolve retries/crashes. Append-only
grants/triggers and separate credentials protect audit records; missing outcome
reconciliation must be operationally visible.

## Alternatives

- Player/Bot auth plus an admin flag: combines trust domains and violates separate
  administrative authority.
- IP allowlist without MFA/RBAC: a permitted host or forwarded address is not an
  authorized human operator.
- Direct SQL or CLI environment bypass: bypasses readiness, idempotency,
  append-only evidence and module ownership.
- Log the request after success: loses authorization/attempt evidence and allows
  unaudited effects when audit storage fails.
- Admin-owned writes across Games/Matches/Leaderboard tables: violates module
  boundaries and owning transactional invariants.

## Consequences

This delivers a reviewable design, not executable RBAC/MFA or admin endpoints.
Phase 7C remains mandatory before game activation. Owner choices for provider,
verified MFA claim mapping/recovery, network inventory, role assignments,
approval separation, time bounds and audit retention/access remain open. General
retention/erasure stays OD-005; identity/session design does not change ADR-014.
7C must prove the listed authorization, race, failure, audit and grant tests,
including effect/outcome recovery, before its own gate. Existing operational
runbooks do not authorize a bypass while Admin is absent.
