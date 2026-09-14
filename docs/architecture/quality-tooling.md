# Quality tooling

[ADR-009](../adr/009-eslint-formatting.md) records version compatibility,
formatting, lint scope, and task orchestration. TypeScript configuration usage is
described in [TypeScript tooling](typescript-tooling.md).

## Commands

Run `pnpm install --frozen-lockfile` first. Root commands are:

| Command                   | Scope                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm lint`               | All current JavaScript/TypeScript files; warnings fail the command                            |
| `pnpm check:architecture` | Uncached source ownership, runtime manifest, and resolver-policy audit                        |
| `pnpm format:check`       | Supported source/config/document formats, read-only                                           |
| `pnpm format`             | Apply the shared formatter to the same scope                                                  |
| `pnpm typecheck`          | Declared workspace TypeScript checks through Turbo                                            |
| `pnpm test`               | Declared workspace tests through Turbo                                                        |
| `pnpm build`              | Declared app/package module builds through Turbo                                              |
| `pnpm check`              | Formatting, lint, architecture gate, typecheck, tests, then build; stops at the first failure |

Scoped suites are `pnpm --filter @hambazi/eslint test` and the TypeScript
package commands documented separately. The ESLint configuration package uses
JavaScript modules, so it has tests and lint coverage but no compile script.
Phase 3 adds app/package module builds. Service startup, a browser bundle,
integration tests, and E2E scripts remain pending.

## Shared configuration

The root `eslint.config.mjs` imports only `@hambazi/eslint`'s public surface:
`base`, `node`, `browser`, and `architecture`. Base enables recommended JS and TS rules and does
not assume a runtime. Consumers scope the Node/browser additions using `files`.
Root config enables Node for tooling, root `.mjs` files, and API/Bot/Worker
source. Browser globals are scoped to `apps/web/src`.
Unused TypeScript parameters/variables prefixed `_` are an explicit convention.
TypeScript files rely on compiler checks for undefined identifiers; JS uses ESLint
`no-undef`. Phase 5B adds [module-boundary rules](boundaries.md) through the
architecture configuration factory. These are syntax/scope-aware checks, not full
TypeScript type/dataflow analysis. React-specific rules will be selected when React source is added.

`.prettierrc.json` defines the formatting policy; `eslint-config-prettier` prevents
conflicting lint rules. `.prettierignore` preserves the supplied architecture and
agent guide, and excludes generated artifacts and environment files. Newly added
documentation remains checked. ESLint separately ignores generated outputs.

## Task graph and cache behavior

Turbo typecheck depends on dependency-package builds and typechecks so emitted
public declarations are available to consumers. A package test waits for
its own typecheck when present. Both tasks use `$TURBO_DEFAULT$`, including package
source/config files, and declare `outputs: []` because successful verification
produces no deliverable artifacts. Logs may be replayed from the local cache.
Package manifests and dependency graph/lockfile data contribute to task hashes.
Consumers must declare shared configuration dependencies with `workspace:*`.

Root formatting/lint always run, so changes to root config or formatting policy
cannot be hidden by a package task cache. Use `pnpm exec turbo run typecheck test
--dry=json` to inspect the resolved graph and hashes. After changing the runtime
or investigating stale local results, `pnpm exec turbo run typecheck test --force`
executes the real declared tasks again. Phase 3 build tasks depend on dependency
builds and cache `dist/**`, including library incremental metadata. See
[workspace conventions](workspaces.md) for the current scaffold build limits.

The independent architecture gate is also uncached and disallows inline
suppression. The ESLint test task explicitly includes the repository manifests,
resolver configurations, and Prisma schema that its boundary fixtures read, so
those external inputs invalidate its cached result.
