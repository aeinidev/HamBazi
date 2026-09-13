# ADR-009 — Shared linting, formatting, and compatible compiler versions

- **Status:** Accepted
- **Owner:** HamBazi engineering
- **Date:** 2026-09-13
- **Supersedes:** ADR-008's TypeScript 7.0.2 version selection only

## Context

Architecture sections 3.2, 4, 23.3, and 24 require shared tooling, compatible stable
dependencies, and reproducible quality checks. Phase 2A introduced TypeScript
7.0.2 before a linter was installed. The stable typescript-eslint 8.70.0 release
supports TypeScript `>=4.8.4 <6.1.0`; its documented range and package peers exclude
7.0.2. TypeScript 6.0.3 is the latest stable compatible 6.0 release at assessment.

## Decision

Use TypeScript 6.0.3 for both compilation and lint parsing. Preserve ADR-008's
strict presets, runtime separation, and module-resolution decisions; rerun its
compiler fixtures to verify compatibility. Do not suppress peer compatibility
warnings or use an unsupported parser/compiler pairing.

Export the ESLint flat configuration through `@hambazi/eslint`. Use ESLint
10.10.0, @eslint/js 10.0.1, typescript-eslint 8.70.0, globals 17.12.0, and
eslint-config-prettier 10.1.8. Start with recommended JavaScript/TypeScript
syntax rules, strict equality, explicit type imports, unused-variable detection,
and unused-disable detection. Node/browser globals are opt-in configurations
scoped by the consuming root configuration. TypeScript's compiler owns undefined
name/type checks; typed lint rules can be added with actual application projects.

Use Prettier 3.9.6 for formatting, matching the established two-space, UTF-8/LF
conventions, with double quotes, semicolons, trailing commas, and a 100-column
print width. Keep original `AGENTS.md`, `docs/ARCHITECTURE.md`, and architecture
assets excluded to preserve the supplied reference files. Generated files and
environment files are also excluded. New documentation follows the formatter.

Root `lint` checks all current source and the root configuration in one ESLint
invocation. Root formatting and lint checks are uncached so root config changes
are always observed. Turbo orchestrates existing package typechecks and tests;
its default package inputs are explicit, and both tasks declare no output
artifacts. Tests depend on their package's typecheck when one exists. The ESLint
package is executable JavaScript configuration tested/linted directly and has no
TypeScript source to compile. Do not manufacture an application build task while
no application exists. Add build outputs and dependency ordering with Phase 3's
real packages. React-specific rules accompany actual React source in that phase.

## Alternatives

- Keep TypeScript 7 with an unsupported parser: conflicts with stable compatible
  dependency requirements and risks parser failures.
- Use two TypeScript majors for compilation and linting: risks differing syntax
  support and duplicates the upgrade burden.
- Put formatting rules in ESLint: overlaps Prettier; separate formatting checks
  give one owner for each formatting decision.
- Add lint tasks to every workspace immediately: duplicates wiring while a single
  root invocation covers this small repository; revisit with product workspaces.

## Consequences

All 2A compiler tests must pass on 6.0.3 before this change is complete. New lint
fixtures exercise acceptance/rejection, runtime globals, generated-file ignores,
and stale suppressions. Tooling dependencies stay out of product runtime code.
TypeScript 7 is deferred until the stable lint toolchain supports it. Full module
ownership/dependency enforcement remains Phase 5B; this phase does not claim to
provide those checks or resolve any product open decision.

## References

- [typescript-eslint supported dependencies](https://typescript-eslint.io/users/dependency-versions/)
- [ESLint flat configuration](https://eslint.org/docs/latest/use/configure/configuration-files)
- [Prettier configuration](https://prettier.io/docs/configuration)
