# Executable architecture boundaries

[ADR-013](../adr/013-enforced-architecture-boundaries.md) defines Phase 5B's
enforcement baseline. Rules live in `tooling/eslint`; product code does not import
them. No application business behavior is implemented by this phase.

## Commands

```sh
pnpm check:architecture
pnpm --filter @hambazi/eslint test
pnpm check
```

`check:architecture` audits production manifests/resolver settings and lints all
app/package `src` trees. Generated Prisma source is excluded from lint, not from
database compilation. The command fails on errors or warnings, has no cache, and
does not honor inline suppression comments or root lint overrides. Ordinary
`pnpm lint` also includes the three architecture rules for editor feedback.
`pnpm check` runs both gates; no CI workflow is installed yet.

## Package and import rules

- Import another workspace by a declared public package name, never `../../other`.
- Source dependencies must be in dependencies/peerDependencies/optionalDependencies;
  a dev dependency is not permission for a production import.
- Public product exports are explicit compiled `index` entry points. Wildcards,
  generated models, raw source subpaths, and alternate export remapping fail.
- Shared is the bottom layer; contracts depends on shared; validation depends on
  contracts/shared. Game core/engines may use those and Zod, not infrastructure.
- Web/Bot cannot import database or a concrete engine. Only API process composition
  imports concrete engines; generic modules work through game-core/registry ports.
- Direct Prisma and the policy's listed SQL-driver imports belong only to the database workspace.
- Type-only imports, re-exports, import types, and dynamic/require imports follow
  the same ownership rules. Computed import specifiers and runtime loaders fail.
- Production source cannot import test fixtures, scripts, or compiled outputs.
  Existing relative symlinks are resolved before checking the target.
- Package imports/browser/typesVersions mappings, TypeScript paths/baseUrl/rootDirs/
  moduleSuffixes/customConditions, and dependency aliases require a reviewed
  resolver extension. They must not silently bypass the policy.
- New ordinary workspaces must register an owner; new `packages/games/*` workspaces
  inherit pure-engine restrictions. Runtime workspace dependency cycles fail.

## API module matrix

Only `src/<module>/index.ts` is the current cross-module surface. A module's own
relative internals remain available to that module. Application/domain code
depends on repository interfaces, not infrastructure implementations; domain
cannot import its application layer. Public indexes must not directly expose
repository implementations. A module-owned assembly factory may encapsulate its
repository construction and be exported through the public index.

| Source module | Allowed synchronous module ports                                |
| ------------- | --------------------------------------------------------------- |
| auth          | users                                                           |
| users         | none                                                            |
| games         | none (configuration uses its package/port)                      |
| rooms         | users, games                                                    |
| matchmaking   | users, games, matches                                           |
| matches       | users, rooms, games                                             |
| realtime      | auth, users, games, rooms, matchmaking, matches, presence, chat |
| presence      | matches                                                         |
| chat          | matches                                                         |
| leaderboard   | none; consumes versioned result events/contracts                |
| admin         | users, games, rooms, matches                                    |
| health        | none; injected infrastructure health ports                      |

This matrix is an import ceiling, not authorization or evidence those ports exist.
The mapping of eligibility/presence/admin wiring is recorded in ADR-013. Register
new edges with positive/negative fixtures and architecture review. In particular,
Room start orchestration must not introduce a reciprocal Rooms→Matches service
dependency; compose existing ports in the appropriate application workflow.

`apps/api/src/index.ts` and `src/composition/**` may wire modules through their
public indexes and inject engines/database dependencies. They are not a loophole
for private module imports. Bot/Worker imports of API modules require an explicit
`@hambazi/api/<module>` export added by the owning feature phase; API startup is
not a shared port. This phase adds no such runtime dependency/export.

Frontend `features/<name>` and `games/<name>` similarly expose indexes. Sibling
features and the application shell cannot import another feature/game's private
components, store, or adapters directly.

## Engine and pure-library isolation

Pure package imports and runtime manifests reject frameworks, built-in Node
modules, storage, transport SDKs, and dependencies that point back to applications.
Ambient Date, Math.random, crypto, performance, timers, network/browser globals,
logging, and dynamic evaluation fail. Normal deterministic Math operations and
explicit injected Clock/RandomSource parameters pass. Referencing or destructuring
the ambient object is checked too; changing `Math.random()` to an alias is not a fix.

These are import/source fitness checks, not a determinism proof. Property, replay,
and hidden-information tests remain mandatory when the engine is implemented.

## Database repositories

Permitted owning locations are:

```text
apps/api/src/<users|games|rooms|matches|chat|leaderboard>/infrastructure/repositories/
```

Only these adapters select the corresponding literal `forModule` owner. Matches
may select `outbox` for its narrower dispatcher persistence scope. API/Worker
process composition may construct the database dependency but cannot select an
owner or query tables. Worker jobs, realtime adapters, Bot, and application/domain
services invoke public owning use cases instead.

Supported query shape:

```ts
const persistence = database.forModule("users");
const record = await persistence.execute((db) =>
  db.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true } }),
);
// Map the record to an owned domain/port DTO before returning it.
```

Queries must directly name an owned delegate. Structural options use inline
object/array literals, not aliases, spreads, computed keys, or opaque builders.
Dynamic scalar values, JSONB values, and existing compound unique keys are allowed.
Relation reads/counts/filters/nested writes are rejected, including through
`select` and `where`, not merely `include`. Read owned rows separately inside the
owning transaction or ask the other module's public port. Even same-owner relation
traversal needs a reviewed extension before use. Raw SQL/Prisma escape hatches stay
inside the database package; this does not authorize unreviewed SQL there.

The schema-derived scalar parser supports the current simple Prisma model and
compound-key declarations. Changes to schema syntax/query forms require fixture
coverage and policy review. Typecheck still validates actual Prisma argument types.
The database's existing runtime delegate restrictions and transaction behavior are
unchanged; static checks are an additional gate, not a replacement.

## Review obligations and limitations

Static checks do not prove that public factories hide all inferred persistence
types, that DTOs project safe views, or that an allowed application port is used
with correct authorization. Arbitrary reflection, handcrafted protocol clients,
and malicious runtime capability laundering are not a supported programming model.
Do not bypass the gate with those constructs. Review return types, queries, event
contracts, and repository mapping; retain integration/information-flow tests.

Future query builders, extra export surfaces, path aliases, or new module edges
must extend policy and tests explicitly. No inline ignore is an approval mechanism.
The tests' Turbo inputs include the external manifests, resolver settings, and
Prisma schema they read; the architecture command remains uncached regardless.
