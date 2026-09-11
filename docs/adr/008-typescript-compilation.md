# ADR-008 — TypeScript compilation and runtime boundaries

- **Status:** Accepted
- **Owner:** HamBazi engineering
- **Date:** 2026-09-12
- **Supersedes:** None

## Context

Architecture sections 3, 4, 11, 23, and 24 require shared TypeScript tooling,
framework-independent engines, explicit public module surfaces, and reproducible
checks. Compiler configuration affects every future package. Architecture
section 27.1 already reserves ADR-001 through ADR-007 for foundational decisions.

## Decision

Use the private `@hambazi/typescript` workspace to export four JSON presets:

| Preset | Use | Resolution | Ambient types | Output |
|---|---|---|---|---|
| `base.json` | Common strict policy | NodeNext | ES2022 only | Consumer decides |
| `library.json` | Pure/shared libraries, including game-core and engines | NodeNext | ES2022 only | JS, declarations, maps; composite |
| `node.json` | Node applications and tooling | NodeNext | Node, explicitly enabled | No emit by default |
| `web.json` | Vite browser applications | Bundler / ESNext | DOM and DOM.Iterable | No emit; React JSX transform |

Use ES2022 as the emitted language baseline. This is not a claim of compatibility
with every Telegram WebView; actual device/browser support must be validated in
the frontend and staging phases. Node applications follow the root Node 24 range.

Enable strict checks, exact optional properties, checked indexed access,
explicit overrides, isolated compilation, and verbatim module syntax. Keep
dependency declaration checking enabled. Do not globally load `@types` packages.
ESM consumers declare `type: module` and use `.js` relative imports under NodeNext.
Bundler consumers may use extensionless imports.

Each consumer owns its `include`, `rootDir`, `outDir`, build-info path, and
`references`; presets do not contain paths relative to the tooling package.
Referenceable libraries emit declarations with `tsc --build`. Application
typechecking uses `tsc --project ... --noEmit`; an eventual Node build config must
explicitly enable emit. Build referenced libraries before checking their consumers.
Do not put no-emit application projects in another project's build references.
Workspace dependencies and their public exports remain the source of module
resolution; `paths` aliases must not bypass package boundaries.

Pin TypeScript 7.0.2, Vitest 5.0.0, and Node 24 types 24.13.4 for this tooling
package. Exercise the stable compiler CLI rather than TypeScript's unstable API.
Package consumers install the config through a `workspace:*` devDependency and
declare any runtime-specific type packages themselves.

## Alternatives

- One config with DOM and Node globals everywhere: simpler but hides accidental
  platform coupling in pure engines.
- Bundler resolution everywhere: permits imports that unbundled Node cannot run.
- CommonJS everywhere: possible, but does not match the ESM tooling/browser path.
- A root project referencing applications before they exist: deferred until real
  buildable dependencies require that graph.

## Consequences

Compiler tests cover strictness, public preset resolution, platform globals,
declaration output, no-emit applications, ESM imports, and composite references.
No runtime dependency is added to an engine. Missing Node/DOM globals help detect
coupling but are not a security boundary: explicit imports, `Date.now()` and
`Math.random()` still require the planned lint/dependency fitness checks.
Nest decorator settings and React type packages belong to their eventual app
configurations; their compatibility must be checked when those apps are added.
This decision does not resolve any product, hosting, session, or legal open decision.

## References

- [TypeScript configuration reference](https://www.typescriptlang.org/tsconfig/)
- [TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [Vitest guide](https://vitest.dev/guide/)
