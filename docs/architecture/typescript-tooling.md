# TypeScript workspace conventions

The compiler policy is recorded in [ADR-008](../adr/008-typescript-compilation.md).
The public presets live in `tooling/typescript` and are exported as
`@hambazi/typescript/base.json`, `library.json`, `node.json`, and `web.json`.

## Consuming a preset

A future pure library declares `@hambazi/typescript: workspace:*` as a
devDependency, declares `type: module`, and uses this local configuration:

```json
{
  "extends": "@hambazi/typescript/library.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/library.tsbuildinfo"
  },
  "include": ["src/**/*.ts"]
}
```

This is a consumer configuration example, not an existing product package.
Libraries expose public emitted entry points in their package exports. Relative
ESM source imports use `.js` extensions, which TypeScript resolves to source `.ts`
files and preserves for Node. Framework-neutral libraries retain `types: []`.

Node apps extend `node.json` and declare their own `@types/node` devDependency.
Their build configuration can override `noEmit` to `false` and specify output
paths. Nest decorator/metadata settings are app-owned and will be validated when
Nest is introduced. Browser apps extend `web.json`, install React types when React
is introduced, and let Vite emit production assets. Node-only Vite configuration
files should use a separate Node config rather than add Node globals to browser
source. Arrays such as `types` are replaced, not merged, when overridden.

## Project references and no-emit checks

Declare project references locally and only for real buildable library
dependencies. Referenceable projects use the composite library preset and emit
their declarations before consumers are checked. Keep references aligned with
workspace dependencies; import via documented package exports, not cross-package
source paths. No root solution graph is needed while only tooling exists.

For libraries, use a distinct check config when a completely artifact-free check
is required: extend the library config and override `composite: false`,
`incremental: false`, and `noEmit: true`. This check config is not a reference
target. Normal composite builds may create build-info files even during a
no-emit check; output/build-info paths must stay inside the owning package.

## Current commands

After dependencies are installed with `pnpm install --frozen-lockfile`:

- `pnpm --filter @hambazi/typescript typecheck` checks the tooling tests.
- `pnpm --filter @hambazi/typescript test` runs the compiler fixture tests.
- `pnpm typecheck` runs declared workspace typechecks through Turbo.
- `pnpm test` runs declared workspace tests after their typechecks through Turbo.

The fixture tests create temporary consumer projects, resolve the real public
presets through a package link, invoke the pinned `tsc` binary, and remove the
temporary projects after each test. Valid and invalid programs test compiler
behavior, including emitted declarations and two-project build references.
No application integration or E2E suite exists at this phase.

Vitest's transitive `tinybench` 6.1.4 declaration references the browser-named
`DOMHighResTimeStamp` numeric type. `tests/vitest.d.ts` supplies only that alias for
the Node test harness, with full dependency declaration checking still enabled.
It is not exported by the presets or loaded into fixture/consumer projects.
Reassess this compatibility alias when upgrading Vitest/tinybench.
