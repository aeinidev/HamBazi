# ADR-018 — Read-only game catalog baseline

- Status: Accepted by project owner
- Owner: HamBazi project owner / implementation maintainer
- Date: 2026-09-22
- Supersedes: none; narrows the initial Phase 7B deliverable

## Context

Architecture sections 3.1, 7, 15 and 16 require Games-owned configuration,
authenticated reads, readiness enforcement and secured operator controls.
Engine and gameplay capabilities are not implemented. ADR-011 deferred product
seeds; API/Worker have SELECT-only access to games. The owner approved the 7B
proposal, retaining read-only scope and deferring secured live controls until
before activation.

## Decision

- Coup registry ID/slug `coup`, title `Coup`, metadata capacity 2–6. This is not
  a ruleset or a claim of playability.
- Additive data migration inserts only an absent record: DISABLED, all flags
  false, config schema 1, empty config object. Conflicts do nothing; existing
  data and API/Worker SELECT-only grants remain unchanged.
- Authenticated `GET /v1/games` and `GET /v1/games/:slug` use Auth's public
  session/ACTIVE-user checks through composition. Games never queries Users/Auth.
  The list includes registered games only, currently Coup; unrelated database
  rows do not automatically register a game.
- Disabled/maintenance metadata remains visible. Stored status is projected,
  but playable and all effective capability flags stay false; readiness is
  NOT_IMPLEMENTED and descriptor is null. Stored ACTIVE/true flags cannot enable
  absent implementations. No invented engine/state/ruleset versions, modes,
  timers or minimum-client requirements.
- Strictly validate registered stored metadata and schema-1 empty config. Return
  only allowlisted fields, never raw config JSON. Unknown valid slugs return 404;
  malformed slugs 400; missing registered Coup, invalid config and database
  failure sanitized 503. No successful static/stale fallback. Responses no-store.
- One distributed atomic 60-second window per authenticated user shared by both
  routes. Explicit CATALOG_READ_LIMIT: 1–600, recommended 60. Exhaustion returns
  429/Retry-After. Redis failure fails open with safe warning/counter telemetry,
  never bypassing authentication, eligibility or database validation. This is
  an endpoint budget, not a launch capacity assumption.
- No live operator route, CLI or SQL bypass. Tracked Phase 7C requires separate
  admin auth, RBAC, MFA, private access and append-only audit before activation.
  This seed/read projection is not an operational kill switch.

## Alternatives

Immediate ACTIVE status was rejected because metadata cannot prove engine or
admission readiness. Hiding disabled games was not selected: explicit unavailable
metadata supports the future UI. Live admin configuration is owner-deferred to
keep 7B bounded. Redis read fail-closed was not selected; durable/auth checks
remain mandatory and degradation is observable.

## Consequences

Catalog reads work before gameplay without advertising admission. New games and
executable descriptors need explicit registry/schema evolution and tests.
Unsupported existing configuration is preserved but fails closed. Future
Rooms/Matchmaking must recheck Games at admission; client metadata is never
authorization. Operator controls and engine/capability readiness remain activation
gates. Hosting, launch capacity, retention, SLO and Coup rights remain open.
