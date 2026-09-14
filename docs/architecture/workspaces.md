# Workspace structure and ownership

Phase 3 establishes compilable workspace boundaries. Phase 4A implements the
Node-only config package and local data-service infrastructure. Phase 4B adds the
[database foundation](database-foundation.md), private generated Prisma client,
migrations, and database verification. Phase 5A adds the
[shared contract foundation](contracts.md), runtime schemas, and stable errors.
Application entry points remain empty modules, not implemented product APIs or
runnable app services. Phase 5B adds executable [architecture boundaries](boundaries.md).
No game rules or application startup side effects are introduced.

## Workspace ownership

| Workspace              | Directory                    | Responsibility / implementation gate                                                     |
| ---------------------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| `@hambazi/api`         | `apps/api`                   | Nest/Fastify REST, Socket adapter, and application use cases; feature phases 6–13 onward |
| `@hambazi/bot`         | `apps/bot`                   | grammY Telegram orchestration through application ports; Phase 6B                        |
| `@hambazi/web`         | `apps/web`                   | React/Vite Mini App and game renderers; Phase 14                                         |
| `@hambazi/worker`      | `apps/worker`                | Outbox/job adapters invoking application use cases; Phase 11B onward                     |
| `@hambazi/contracts`   | `packages/contracts`         | Versioned public DTO/event contracts; Phase 5A                                           |
| `@hambazi/validation`  | `packages/validation`        | Runtime validation for untrusted input; Phase 4A/5A                                      |
| `@hambazi/database`    | `packages/database`          | Prisma client, migrations, infrastructure; Phase 4B                                      |
| `@hambazi/game-core`   | `packages/game-core`         | Framework-free Game Module interfaces; Phase 10A                                         |
| `@hambazi/coup-engine` | `packages/games/coup-engine` | Pure, deterministic Coup rules and safe views; Phase 10                                  |
| `@hambazi/config`      | `packages/config`            | Validated runtime configuration; Phase 4A                                                |
| `@hambazi/shared`      | `packages/shared`            | Shared primitives/stable errors only; Phase 5A                                           |
| `@hambazi/typescript`  | `tooling/typescript`         | Shared compiler presets and compiler tests                                               |
| `@hambazi/eslint`      | `tooling/eslint`             | Shared lint configuration and lint fixtures                                              |

## Public surfaces

Each new workspace owns `src/index.ts`. Its package exports only `.` through
`dist/index.js` and `dist/index.d.ts`; imports of unexported package subpaths are
rejected by Node package resolution. Consumers must declare a workspace dependency
before importing a package. Validation depends on contracts/shared, and contracts
depends on shared. Other product dependencies should be added when their owning
use cases need them.

API modules each have an application public surface at
`apps/api/src/<module>/index.ts`:

`auth`, `users`, `games`, `rooms`, `matchmaking`, `matches`, `realtime`, `presence`,
`chat`, `leaderboard`, `admin`, and `health`.

These surfaces are empty until their owning phase adds use cases and ports. The
API root does not re-export all module internals. Internal domain/repository
folders should be created as the relevant implementation arrives. Follow the
architecture's dependency matrix when wiring modules; do not expose Prisma models
as shared contracts or import another module's repository. Package export maps
do not enforce same-repository relative imports on their own: Phase 5B's lint and
uncached architecture gate now enforce those source boundaries and manifest directions.

Frontend feature surfaces live under `apps/web/src/features` for `auth`, `profile`,
`game-catalog`, `room`, `matchmaking`, and `leaderboard`. Coup-specific `components`,
`screens`, `store`, and `adapters` live under `apps/web/src/games/coup`. Their empty
indexes reserve ownership and carry no rule authority.

## Build and typecheck

Each new workspace declares `build` and `typecheck` and depends on the public
`@hambazi/typescript` configuration package. Node applications explicitly enable
Node typings; shared/contracts retain the framework-free base environment.
Validation opts into DOM declarations for Zod's cross-runtime URL declaration,
without using DOM at runtime; its test configuration separately enables Node types.
Database/config packages may opt into necessary infrastructure types in their
own implementation phases, without changing game-core/engine presets.

- `tsconfig.json` performs a no-emit source check.
- `tsconfig.build.json` owns `src` and `dist` paths and emits JavaScript,
  declarations, and maps.
- Library build-info files stay inside `dist`, so cached/restored outputs contain
  both declarations and incremental metadata.
- `pnpm build` runs real workspace builds in dependency order through Turbo.
- `pnpm typecheck` builds dependencies before checking their consumers, ensuring
  public emitted declarations are available on a fresh checkout.
- `pnpm check` performs formatting, lint, typecheck, tests, and build.

The web scaffold uses the browser compiler preset for a module/declaration build.
This output is not an HTML application or a Vite production bundle. Vite/React,
framework startup commands, browser assets, and their lint integration arrive in
the owning app phases. The server scaffolds likewise do not start HTTP listeners,
Telegram polling, or worker jobs. There is no `start`/`dev` script yet.

No synthetic tests or `passWithNoTests` scripts are added to empty modules. Existing
tooling tests remain the unit suites until behavior is implemented. Phase 3 also
verifies emitted public imports and denied internal package imports as build
smoke checks. Application integration and E2E remain future gates.

## Infrastructure and documentation

`infra/docker` owns local/container definitions; `infra/scripts` owns operational
scripts. Phase 4A's [local runbook](local-development.md) documents implemented
PostgreSQL/Redis service definitions and configuration. Prisma begins in Phase 4B,
and production packaging in Phase 18B. `docs/architecture` owns supplementary
architecture conventions; `docs/adr` owns recorded implementation decisions.
The canonical product architecture remains `docs/ARCHITECTURE.md`.
