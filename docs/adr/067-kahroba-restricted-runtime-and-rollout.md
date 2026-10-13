# ADR-067: Kahroba private application runtime and rollout

- Status: Accepted for K4A local implementation; restricted staging activation pending K4B approval
- Owner: HamBazi owner
- Date: 2026-10-13
- Context: K2 exercised explicit composition and K3 an isolated browser transport. The actual API entry point previously composed Auth, Users, catalog, optional Rooms and personal Coup/Anarchist, without the generic Match gateway. Staging retains an older Worker and public gameplay remains held.

## Decision

Reuse existing application ports, PostgreSQL writer/receipts/outbox, Redis admission and Socket adapter, and the Worker v1/v2 result consumers. Register the pinned Kahroba adapter explicitly in the actual API composition. No new database schema, runtime service, dependency, turn timer or human Bot fallback is introduced.

Four explicit flags govern registration, runtime, routes and new-room admission. Invalid dependency combinations fail closed. Default configuration has no Kahroba runtime or route. `local-private-v1` requires loopback services, nonproduction mode and a private file with two to four synthetic identities. `restricted-staging-v1` requires production TLS configuration, the existing owner/tester policy and exact staging origin, retained personal gameplay, and capacity two. Local admission files are forbidden in production. No admission file or deployed environment was changed in K4A.

Private REST routes use `/v1/kahroba`; Socket uses `/kahroba-v1` and `/v1/kahroba/socket.io`. Existing public contracts and catalog remain unchanged. A stored `DISABLED` Game row is required; a private registration facade validates it without changing public status. Match-bounded names use Users' public names port after membership validation. They are display names, not claimed Telegram usernames. Views and pins remain K1/K2.

The Web affordance requires an explicit build flag and the existing staging origin/API pair. A child runtime shares only a validated, memory-held server-issued session, has its own transport/store/query cache and is disposed on exit or parent session change. UI retries capture their original command ID and expected version. The backend remains authoritative.

Separate Socket servers coexist with Engine.IO's unknown-upgrade destruction disabled only when both are present; the HTTP composition rejects paths outside the two known transports. Trusted proxy and production TLS rules are supplied by the existing HTTP composition. A real listener test exercises both transports together.

Worker consumers and durable v2 readers precede API producers. Rollback after any v2 history exists retains v2-capable readers, statistics rebuild and consumers indefinitely; queue draining alone does not make the old Worker safe. New admission can close while existing Kahroba routes/engine finish active matches. Emergency containment preserves state and jobs without invented termination, re-deal or Bot takeover.

## Alternatives

- A new game service, database or queue infrastructure: unnecessary; existing ports meet the scope.
- Public catalog/navigation activation: unapproved.
- A fixture-only acceptance claim: insufficient; actual process entry points and real disposable services are now tested.
- A schema-v1 shared-result conversion or old-Worker rollback: loses approved shared victory semantics.

## Consequences

K4B needs a reviewed disabled Game registration DML, private route/configuration delta, exact artifacts, fresh target scans and operator evidence, with the same two humans. No new migration is required. Bot onboarding failures, the retained scanner finding, native Telegram acceptance, publication rights and production operating holds remain explicit gates. See the restricted [rollout plan](../operations/kahroba-restricted-staging-plan.md) and [K4A report](../testing/kahroba-k4a.md).
