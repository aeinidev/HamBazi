# ADR-013 — Executable modular-monolith boundaries

- **Status:** Accepted for the Phase 5B foundation
- **Owner:** HamBazi engineering
- **Date:** 2026-09-14

## Context

Architecture sections 3.1–3.2, 5.1, and 23.3 require failing import/ownership
checks, not only a directory convention. Phase 5A established public shared
packages, but imports could still bypass export maps via relative paths, and an
engine could declare unused infrastructure dependencies. The database's scoped
Prisma delegates restrict top-level models, but generated relation types can
still traverse another module's tables.

## Decision

Extend the existing ESLint package with local rules and a shared ownership policy.
Reuse the installed TypeScript parser and ESLint Node API; add no dependencies.
Run the rules in ordinary lint and in an independent, uncached
`pnpm check:architecture` command included in `pnpm check`. The latter ignores
inline suppression comments and root lint rule overrides. CI pipeline installation
remains Phase 18; this phase supplies the executable local/CI-ready gate.

The gate inspects product source imports and production dependency manifests.
Static imports, type imports, import types, re-exports, literal dynamic imports,
and require syntax share one policy. Reject computed loaders, runtime module
loader imports, cross-workspace relative imports, unknown aliases/remapping,
unexported subpaths, production-to-test/output imports, forbidden workspace
directions, and runtime dependency cycles. Resolve existing relative symlinks
before ownership checks. Explicit package export targets remain compiled public
indexes; new API application-port subpaths need explicit manifest entries.

Translate the dependency matrix into a reviewed source allowlist. Map matchmaking
eligibility to Users/Game Catalog ports and match creation to Matches. Matches
may consume Users, optional Rooms, and the generic Game Catalog. Presence uses a
Match membership port. Realtime consumes product application ports; Admin may
orchestrate the existing Users/Games/Rooms/Matches ports, with authorization still
owned by its future use cases. Leaderboard receives versioned events/contracts,
not a synchronous Match service dependency. These are ceilings, not newly
implemented APIs. New edges require policy/fixture/document review.

API `src/index.ts` and `src/composition/**` are process wiring surfaces. They may
wire concrete engines and database infrastructure, but still enter other API
modules through their indexes. Generic Matches/Rooms/etc. cannot import Coup.
Module indexes expose application ports/factories, not repository implementations.
A module may implement its assembly factory in its own internal file and export
that factory through the index; repository objects/Prisma records are not public
application DTOs. Domain code cannot import application/infrastructure layers.
Frontend feature/game internals likewise require their public index.

Bot/Worker may depend on explicitly exported API module ports when their owning
phase establishes that packaging, never API startup or private source paths.
No such new export or application dependency is added now. Worker jobs do not own
database repositories; they invoke the owning API application use case. Worker
composition may construct the process database dependency, not select an owner.

Pure shared/contracts/game-core/engine code rejects infrastructure dependencies
and ambient time/randomness/I/O. The rule recognizes global references and common
alias/destructuring forms, while permitting injected parameters and deterministic
Math operations. Game core/engines may use Zod and the approved pure contract/
validation packages; shared/contracts themselves do not acquire runtime libraries.
Pure-package tests may use their own test-time clock/fixtures; production cannot
import them. This does not prove deterministic replay or prevent arbitrary
reflective JavaScript from circumventing static analysis.

Database imports are limited to API-owned
`src/<owner>/infrastructure/repositories/**` and API/Worker process wiring. Only
the owning repository selects `forModule` with its literal owner; Matches may
also select its narrower existing `outbox` scope. Prisma imports remain private
to the database workspace. Ordinary adapters/use cases cannot query delegates or
use raw SQL/Prisma escape hatches.

Repository queries use direct owned delegates and inline structural objects/
arrays. Scalar values remain dynamic, including validated JSONB payloads and
compound unique selectors. Scalar names are read from the current Prisma schema.
Reject relation selections, relation counts, relational filters, nested relation
writes, structural spreads/computed keys, and opaque query option builders. Even
same-owner relations use explicit owned scalar queries in this initial convention;
this is intentionally narrower than Prisma. Extend with auditable fixtures before
admitting another query form. Database internals retain their existing scope and
transaction implementation unchanged.

## Alternatives

- Only package export maps or import-string restrictions: misses relative paths,
  unused runtime dependencies, API directionality, and relation traversal.
- Add dependency-cruiser or another boundaries plugin: viable, but the existing
  parser/rule tooling covers this repository without another dependency and can
  also implement its owner-selector/query conventions.
- Add runtime Prisma wrappers now: changes database execution semantics and
  requires another database integration gate. This phase implements static fitness
  checks without modifying the tested database foundation.
- Allow arbitrary query builders and infer every alias/return type: requires
  substantially broader type/dataflow analysis. Keep explicit supported syntax
  and document the remaining review obligations.

## Consequences

The check is fail-closed for currently supported source/resolver conventions, not
a hostile-code sandbox or proof of business correctness. It cannot establish
authorization, safe PlayerViews, scalar ownership of arbitrary JSON, correct
mapping of inferred repository return types, event schemas, or runtime SQL
semantics through arbitrary reflection. Those require module review, typechecking,
integration, contract, information-flow, and replay tests in their feature phases.
No feature may use this limitation as permission to bypass ownership.

Tests cover allowed/forbidden source fixtures, loader variants, scope-aware
determinism, repository syntax, manifest cycles/remapping, and symlink resolution.
Their Turbo inputs include manifests, resolver configs, and Prisma schema because
the tests read those files outside the ESLint workspace. The independent gate
always runs regardless of test cache state.

No public wire contract, database schema, application behavior, or open product
decision changes. Authentication's OD-003 remains required before session freeze.

## References

- [ESLint custom rule API](https://eslint.org/docs/latest/extend/custom-rules)
- [ESLint Node integration API](https://eslint.org/docs/latest/integrate/nodejs-api)
- [Architecture boundary conventions](../architecture/boundaries.md)
