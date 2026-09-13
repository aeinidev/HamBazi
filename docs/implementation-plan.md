# HamBazi MVP Implementation Plan

## Plan controls

- **Authoritative architecture:** `docs/ARCHITECTURE.md` (HamBazi Software Architecture Specification, Reviewed Edition, version 1.1).
- **Operational guide:** `AGENTS.md`.
- **Delivery rule:** only one phase or subphase may be completed per interaction. The next item does not begin without explicit approval.
- **Allowed statuses:** `Pending`, `In Progress`, `Completed`, `Blocked`.
- **Scope rule:** work is limited to the MVP loop `Account -> Find/Invite -> Play Coup -> Finish -> Stats`.
- **Decision rule:** open decisions `OD-001` through `OD-008` remain unresolved until an owner decision and, where required, an ADR exist.
- **Verification rule:** commands are taken only from manifests that exist at the time of the phase. Missing scripts or unavailable environments are reported as validation gaps.

## Repository baseline (2026-09-10)

### Source resolution

The requested filename `HamBazi_Software_Architecture_v1.1_Reviewed.md` was not present at the repository root. The committed file `docs/ARCHITECTURE.md` identifies itself as **Software Architecture Specification — Reviewed Edition**, version **1.1**, and contains the referenced architecture and five linked diagrams. It is therefore the canonical authoritative architecture source. Phase 1B normalized the repository reference in `AGENTS.md` to this path without moving or duplicating the architecture or breaking its relative image links.

The initial assessment reported no substantive conflict. Phase 4B's database
review corrected that assessment: `AGENTS.md` section 9 (line 155) prohibits
persisting deck/card, RNG material, chat text, and hidden state, while architecture
sections 11.8, 13.1, and 14.5–14.6 require durable match snapshots/events and
PostgreSQL chat history with restricted access and no telemetry exposure.
`AGENTS.md` section 6 itself also requires durable match snapshots/events. The
distinction between authorized application persistence and prohibited logging
was explicitly clarified by the user: “Proceed with the correction and continue
Phase 4B.” The approved correction in `AGENTS.md` distinguishes architecture-required
restricted application persistence from prohibited telemetry, without authorizing
raw authentication-secret storage or unnecessary RNG-material retention.

### Foundation inventory through Phase 4A

| Area               | Observed state                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git                | Phase 4A began on `main` at `3b499e1` (Phase 3) with a clean worktree. No commit, push, or deployment was performed by this phase.                                                                                      |
| Existing user work | `docs/ARCHITECTURE.md`, five architecture PNGs, and `AGENTS.md` are committed and preserved.                                                                                                                            |
| Product code       | Config now provides validated API/Worker settings and redacted secret wrappers. Other app/package surfaces remain scaffolds; no gameplay or account behavior is implemented.                                            |
| Monorepo           | pnpm discovers 13 workspaces plus root. All 11 app/package workspaces build and typecheck; the two tooling packages retain their declared checks.                                                                       |
| Tooling            | Phase 1B activated pnpm `12.4.1` through Corepack `0.35.0` on the available Node.js `v24.20.0` LTS runtime and installed Turbo `2.10.12`.                                                                               |
| Tests/build        | Root checks pass: 64 tests (28 tooling, 29 config, 7 infrastructure), 12 typechecks, and 11 builds. Live service integration, browser bundling, and E2E remain pending.                                                 |
| Infrastructure     | Local Compose, role/ACL bootstrap, safe environment generation, and a development runbook exist. Docker/psql/redis-cli are unavailable here; live service checks have not run. Prisma and deployment/CI remain pending. |
| Documentation      | Architecture/assets, AGENTS, implementation plan, ADR-008/009/010, TypeScript/quality/workspace conventions, local runbook, and infrastructure ownership READMEs are present.                                           |

### Current inventory — Phase 4B update (2026-09-14)

- Work continues on `main` at `2802d49` (Phase 4A). The earlier blocked-phase plan edit was preserved; no commit, push, or deployment was performed.
- The database package now provides Prisma schema/client generation, 14 MVP/consumer-deduplication tables, an additive transactional migration, explicit API/Worker grants, safe lifecycle/owner callbacks, and native PostgreSQL integration tooling. Other product entry points remain scaffolds.
- Root checks pass with 77 tests (28 tooling, 29 config, 13 database unit, 7 infrastructure), 12 typechecks, and 11 builds. Ten additional real PostgreSQL integration tests, migration redeploy, zero Prisma-visible schema drift, and persisted-data restart verification pass. Audit reports no known vulnerabilities.
- PostgreSQL 18.6 distribution packages were downloaded/extracted into a temporary directory, not installed system-wide. Isolated test clusters were stopped and their synthetic data removed. Docker/Redis live verification remains unavailable. ADR-011 and the database runbook document the foundation and its limitations; the approved AGENTS.md clarification is the only reference-guide change.

### Gap summary

The repository contains the architectural input but none of the executable MVP. The implementation must establish the workspace and enforcement tooling before product modules, then build the generic platform and pure Coup engine behind versioned contracts. Durable writes, outbox delivery, realtime resynchronization, hidden-information views, and launch controls remain future phase gates rather than assumptions in the foundation.

## Phase roadmap

### Phase 1A — Repository assessment and implementation roadmap

- **Objective:** establish an evidence-based baseline and a gated production-MVP roadmap.
- **Scope:** read the authoritative sources in full; inspect Git, files, manifests, scripts, tooling, code, tests, docs, and infrastructure; record gaps and phase gates.
- **Expected deliverables:** this implementation plan, repository baseline, gap summary, explicit next-phase boundary.
- **Dependencies:** existing architecture and `AGENTS.md` only.
- **Acceptance criteria:** user changes are preserved; sources are fully reviewed; current state and missing capabilities are factual; every planned phase records the required control fields.
- **Required tests and validations:** Git status/diff checks, complete file inventory, architecture asset inspection, manifest/config discovery, Markdown structural checks, and final diff review.
- **Status:** Completed

### Phase 1B — Minimal monorepo bootstrap

- **Objective:** create the smallest usable pnpm monorepo root without introducing application behavior.
- **Scope:** canonical architecture-reference normalization, repository metadata, root manifest, package-manager pin, workspace definition, ignore/editor conventions, and a minimal Turbo task graph only where supported by declared scripts.
- **Expected deliverables:** root `package.json`, `pnpm-workspace.yaml`, lockfile, minimal `turbo.json`, `.gitignore`, `.editorconfig`, and reconciled architecture path references.
- **Dependencies:** Phase 1A; current stable compatible package versions must be verified before pinning.
- **Acceptance criteria:** Corepack can provision the pinned pnpm version; frozen install succeeds; workspace discovery succeeds; no product packages or speculative scripts are introduced.
- **Required tests and validations:** declared install/workspace commands, configuration/schema validation, `git diff --check`, and user-change preservation review.
- **Status:** Completed

### Phase 2A — Shared TypeScript configuration

- **Objective:** establish strict, reusable TypeScript compilation policy for apps and packages.
- **Scope:** central base/library/application configs, project-reference conventions, module resolution, declaration output, and no-emit typecheck conventions.
- **Expected deliverables:** `tooling/typescript` package and root TypeScript orchestration scripts.
- **Dependencies:** Phase 1B.
- **Acceptance criteria:** a fixture package can extend each relevant config; strict type checking succeeds; configs do not couple the game engine to framework types.
- **Required tests and validations:** declared typecheck and config-resolution checks.
- **Status:** Completed
- **Delivered:** `@hambazi/typescript` exports base, library, Node, and web presets; root `typecheck`/`test` run real workspace commands. ADR-008 records compiler/runtime boundaries and `docs/architecture/typescript-tooling.md` records consumer/reference conventions.
- **Validation evidence (2026-09-12):** scoped and root typechecks pass; 15 compiler tests pass (0 failures), including preset resolution, strict negative cases, environment globals, declaration/map emit, no-emit checks, and composite references. Frozen install and dependency audit pass. Lint, application integration/E2E, and production builds are not yet available. A test-local `DOMHighResTimeStamp` alias accommodates tinybench declarations without adding DOM to consumer presets.

### Phase 2B — Shared ESLint, formatting, and Turborepo orchestration

- **Objective:** provide consistent static analysis and task orchestration.
- **Scope:** flat ESLint configuration, TypeScript/React rules as applicable, formatting convention, Turbo inputs/outputs/cache policy, root lint/typecheck/test/build scripts.
- **Expected deliverables:** `tooling/eslint`, finalized root task graph, and lint fixtures.
- **Dependencies:** Phase 2A.
- **Acceptance criteria:** lint catches representative invalid code; task dependencies and cache outputs are explicit; scripts invoke only existing workspace tasks.
- **Required tests and validations:** frozen install, lint, typecheck, Turbo dry-run/task graph inspection, and config tests.
- **Status:** Completed
- **Delivered:** `@hambazi/eslint` shared flat configuration, root lint/format/check commands, Prettier policy, explicit Turbo inputs/outputs, 13 lint fixtures, and ADR-009. TypeScript is aligned to 6.0.3 because the stable parser excludes 7.x; the 15 compiler fixtures still pass. Existing source and maintained documentation were formatted; supplied architecture and AGENTS files were preserved.
- **Validation evidence (2026-09-13):** frozen install with strict peer dependencies passes; `pnpm check` passes formatting, lint (zero warnings), typecheck, and 28 tests across two suites. Root ESLint stdin probes return 0 for valid code and 1 with the expected rule for invalid code. Turbo dry-run confirms task commands, inputs, empty outputs, and local cache hits. Audit reports no known vulnerabilities.
- **Deferred scope:** root lint/format run uncached to cover root configuration directly. The JavaScript lint package has no TypeScript compile script. Application build scripts/outputs and React-specific rules will be added with actual applications; full module-boundary enforcement remains Phase 5B.

### Phase 3 — Required workspace and module skeleton

- **Objective:** create the architecture-owned app/package structure with public surfaces and no fake behavior.
- **Scope:** `apps/api`, `apps/bot`, `apps/web`, `apps/worker`; contracts, validation, database, game-core, Coup engine, config, and shared packages; required API and frontend feature boundaries; docs/ADR and infra directories.
- **Expected deliverables:** buildable package manifests, minimal entry points, public `index.ts` surfaces, and ownership documentation.
- **Dependencies:** Phase 2B.
- **Acceptance criteria:** all required workspaces are discovered and build/typecheck without cross-boundary internal imports; placeholders are explicit scaffolding rather than mocks or incomplete product behavior.
- **Required tests and validations:** lint, typecheck, unit test command, build, workspace listing, and import-surface review.
- **Status:** Completed
- **Delivered:** four app and seven package workspaces, 12 API module surfaces, six frontend feature surfaces, Coup UI ownership folders, and infra ownership READMEs. Every new workspace has explicit empty public entry points, private ESM exports, no-emit checking, and a module/declaration build. Root `check` now includes `build`; Turbo caches `dist/**` and builds dependencies before consumer checks. See `docs/architecture/workspaces.md`.
- **Validation evidence (2026-09-13):** strict frozen install passes after recording the new workspace importers; root formatting/lint and 12 real typechecks pass. Eleven real builds pass. Existing 28 tooling tests are reused from valid Turbo cache entries. Node smoke checks pass for all 11 public imports and reject all 11 internal package subpaths; emitted JS/declaration/maps are present. Workspace discovery finds 13 workspaces plus root, and audit reports no known vulnerabilities.
- **Limits:** these are compiled skeleton modules, not running services or a browser bundle. No behavior tests are invented for empty modules. Framework startup, integration/E2E, actual cross-module ports, and full import-boundary fitness checks remain assigned to their owning phases. Compiler presets and existing architectural decisions are unchanged; no new ADR is required.

### Phase 4A — Configuration management and local services

- **Objective:** provide validated runtime configuration and reproducible local PostgreSQL/Redis services.
- **Scope:** environment schema and safe examples, secret-handling rules, Docker Compose services, health checks, volumes/network, and local operator instructions.
- **Expected deliverables:** `packages/config`, local Docker assets, `.env.example`, and development runbook.
- **Dependencies:** Phase 3; validation library selection based on existing code or an explicit recorded decision.
- **Acceptance criteria:** invalid/missing config fails safely without logging secrets; services are private-by-default and become healthy locally.
- **Required tests and validations:** config unit tests, Docker Compose config validation, service startup and health checks when Docker is available, lint/typecheck/build.
- **Status:** Completed
- **Delivered:** public Node-only configuration parser with role-specific fields, safe error codes/field names, URL/origin validation, immutable output, and explicit secret reveal/redacted serialization. Added Zod 4.6.2, pinned PostgreSQL/Redis images, loopback ports, private network, PostgreSQL volume and separate roles, scoped Redis ACLs, exclusive mode-0600 environment generation, declared `infra:*`/`test:infra` scripts, ADR-010, and local runbook.
- **Validation evidence (2026-09-13):** frozen strict-peer install, root formatting/lint, 12 typechecks, 64 tests, 11 builds, audit (no known vulnerabilities), and diff checks pass. The official standalone Compose 5.5.1 binary was downloaded into a temporary directory, SHA-256 verified, and successfully ran `config --quiet` with temporary generated credentials; it was not installed system-wide. Built config public-import smoke accepts generated API/Worker configuration and rejects internal package imports. Shell syntax, non-overwrite/symlink protection, file permissions, credential distinctness/redaction, and static topology/privilege checks pass.
- **Resolved issue:** pnpm initially generated a release-age exception for Zod 4.6.4. Removed the exception and its stale lock entry, selected 4.6.2, and regenerated/verified the lockfile without relaxing policy.
- **Validation limit / next-phase prerequisite:** Docker, PostgreSQL client, and Redis client executables are unavailable. Live startup/health, authenticated permissions/ACLs, PostgreSQL volume recovery, and Redis restart-loss checks are not claimed; run them on a Docker-enabled host before Phase 4B database integration. The phase's conditional live checks remain a tracked environment gap, not production-readiness evidence. No service startup, migration, E2E, or deployment occurred.

### Phase 4B — Prisma database foundation

- **Objective:** establish the PostgreSQL data package and a backward-compatible baseline schema.
- **Scope:** Prisma configuration/client lifecycle, initial MVP tables and constraints, migration workflow, generated-client isolation, and database test harness.
- **Expected deliverables:** `packages/database`, initial expand-safe migration, database scripts, and integration-test utilities.
- **Dependencies:** Phase 4A.
- **Acceptance criteria:** PostgreSQL is the durable source; key uniqueness/version/idempotency/outbox constraints exist; Prisma models are not exported as cross-module contracts.
- **Required tests and validations:** Prisma format/validate/generate, migration apply on an empty test database, constraint integration tests, lint/typecheck/build.
- **Status:** Completed
- **Assessment:** both reference documents, repository state, manifests, task graph, and available service tooling were reviewed. The pre-implementation conflict pause was respected, then implementation resumed after explicit owner approval.
- **Resolved source conflict:** the user explicitly approved correcting `AGENTS.md` section 9 and continuing. Restricted durable match state/events and chat history are allowed as required by the architecture; sensitive payloads remain prohibited in telemetry, raw authentication secrets remain non-persistent, and unnecessary RNG-material retention is not authorized. Chat retention and session policy remain open.
- **Delivered:** pinned stable Prisma CLI/client/adapter-pg 7.10.0 and pg 8.23.0; isolated generated ESM client; public database lifecycle and owned top-level delegate/transaction callbacks; sanitized errors; initial 14-table schema, foreign keys and uniqueness, version guards and append-only history triggers; dedicated migration/grants workflow; unit/integration tests and isolated native PostgreSQL harness; ADR-011 and database runbook. Session/refresh persistence and product policies remain deferred.
- **Validation evidence (2026-09-14):** strict frozen install, Prisma format/validate/generate, lint/format, 12 typechecks, 77 root tests, 11 builds, audit, public-import/subpath-denial smoke, and diff checks pass. PostgreSQL 18.6 was run from extracted Ubuntu packages without installing a system service. The actual role bootstrap, initial migration and repeat deploy, zero Prisma-visible schema drift, 10 integration tests, and schema plus committed-data restart verification pass. Integration covers BigInt-safe identity, unique action/sequence/seat keys, foreign keys, version pinning, atomic four-record commit/rollback, concurrent duplicate commands, append-only enforcement, role restrictions, outbox delivery-column grants, and consumer deduplication.
- **Resolved implementation issues:** pnpm's default-denied Prisma install scripts were reviewed and narrowly allowlisted. Audit findings in CLI transitive dependencies were removed with targeted patched deepmerge-ts/mysql2 overrides, then compatibility checks rerun. Generated `CREATE SCHEMA IF NOT EXISTS public` requested unnecessary database-level CREATE permission; it was removed in favor of the pre-provisioned schema, preserving least privilege. Temporary diagnostic instrumentation was removed.
- **Remaining limits:** Docker networking/named-volume and Redis startup/ACL/restart tests from Phase 4A remain unverified; native PostgreSQL checks do not replace them. Domain repositories, row-lock command processing, outbox publishing, all-module dependency fitness, application contracts, E2E, production TLS/backup/deployment, and product open decisions remain future phase gates. The schema is not a playable backend and local restart is not backup restore evidence.

### Phase 5A — Shared contracts, validation, and stable errors

- **Objective:** define the minimal versioned public primitives used across transport boundaries.
- **Scope:** identifiers, error envelope/codes, pagination, command/event envelopes, runtime validation, and compatibility conventions.
- **Expected deliverables:** `packages/contracts`, `packages/validation`, narrowly scoped `packages/shared`, schemas and contract tests.
- **Dependencies:** Phase 4B.
- **Acceptance criteria:** untrusted input is runtime-validated; `schemaVersion`, `actionId`, `matchId`, and `expectedVersion` are represented; clients can branch on stable error codes, not messages.
- **Required tests and validations:** schema positive/negative tests, serialization tests, lint/typecheck/build.
- **Status:** Pending

### Phase 5B — Enforced architecture boundaries

- **Objective:** convert modular-monolith dependency rules into failing automated checks.
- **Scope:** API module dependency rules, public-surface imports, engine forbidden dependencies, database ownership, and architecture fitness tests.
- **Expected deliverables:** ESLint/dependency-boundary rules, test fixtures, architecture check script, and boundary documentation.
- **Dependencies:** Phase 5A and the Phase 3 skeleton.
- **Acceptance criteria:** prohibited internal/framework/Prisma imports fail CI-style checks while documented application ports pass.
- **Required tests and validations:** positive and negative architecture fixtures, lint, typecheck, unit tests, build.
- **Status:** Pending

### Phase 6A — Telegram Mini App authentication

- **Objective:** authenticate Mini App users from raw Telegram `initData` and issue a safe short-lived application session.
- **Scope:** constant-time signature verification, configurable freshness, replay/abuse controls, identity resolution port, `/v1/auth/telegram-mini-app`, safe logging, and Socket-compatible authentication context.
- **Expected deliverables:** auth domain/application/infrastructure adapters, REST contract, tests, and threat-focused documentation.
- **Dependencies:** Phase 5B; `OD-003` must be resolved before freezing the public session strategy.
- **Acceptance criteria:** forged/stale/malformed inputs fail; raw `initData`, hashes, and tokens are neither persisted nor logged; client-supplied `userId` is non-authoritative.
- **Required tests and validations:** official-vector unit tests, tamper/freshness/constant-time-aware tests, REST integration tests, log redaction tests, lint/typecheck/build.
- **Status:** Pending

### Phase 6B — Account creation and Telegram Bot onboarding

- **Objective:** complete `/start` and create-account orchestration through the shared Users application port.
- **Scope:** grammY adapter, webhook secret/update deduplication, display-name flow, public-handle generation, Mini App invite onboarding handoff, and account menus.
- **Expected deliverables:** Users account use case, Bot handlers/adapters, webhook endpoint/config, and tests.
- **Dependencies:** Phase 6A.
- **Acceptance criteria:** retries do not duplicate users or Bot updates; Bot contains no business rules; webhook requests require valid secret/auth controls.
- **Required tests and validations:** user-domain unit tests, handle collision tests, Bot adapter tests, webhook integration/idempotency tests, lint/typecheck/build.
- **Status:** Pending

### Phase 7 — Profile, settings, and game catalog

- **Objective:** expose authenticated profile/settings and a backend-driven Coup catalog entry.
- **Scope:** `GET/PATCH /v1/me`, user settings, game manifest/descriptor registry, status/capabilities/remote config, maintenance switch, and read contracts.
- **Expected deliverables:** Users and Games module use cases/adapters, Coup manifest/version descriptor baseline, REST endpoints, tests.
- **Dependencies:** Phase 6B.
- **Acceptance criteria:** profile mutation rules and unique handle behavior are server-enforced; game availability is backend-configured; no game rules leak into catalog/Users.
- **Required tests and validations:** domain/repository/REST contract tests, authorization tests, lint/typecheck/build.
- **Status:** Pending

### Phase 8A — Private room domain and persistence

- **Objective:** implement the durable private-room lifecycle and membership invariants.
- **Scope:** create/read/join/leave/start, `WAITING -> FULL -> STARTING -> STARTED -> CLOSED/EXPIRED`, capacity, host transfer, idempotent join, and application ports.
- **Expected deliverables:** Rooms domain/application/repository adapter and `/v1/rooms` contracts.
- **Dependencies:** Phase 7.
- **Acceptance criteria:** only the host can start a full eligible room; concurrent joins cannot exceed capacity; leave/host-transfer transitions are deterministic.
- **Required tests and validations:** state-machine unit tests, PostgreSQL integration tests, concurrent join/idempotency tests, REST authorization/contract tests, lint/typecheck/build.
- **Status:** Pending

### Phase 8B — Invite codes and Telegram deep links

- **Objective:** add secure invite resolution and continuity through authentication/onboarding.
- **Scope:** high-entropy opaque codes, deep-link builder/parser, invite expiry/resolution, authenticated join, and Bot/Mini App handoff.
- **Expected deliverables:** invite service/ports, route contracts, Telegram link adapter, and abuse-focused tests.
- **Dependencies:** Phase 8A and Phase 6B.
- **Acceptance criteria:** codes are non-sequential and non-enumerable in practice; no unauthorized membership is created; retries preserve one membership.
- **Required tests and validations:** entropy/format tests, expiry/not-found tests, invite onboarding integration tests, rate-limit tests, lint/typecheck/build.
- **Status:** Pending

### Phase 9 — Matchmaking and cancel-vs-match safety

- **Objective:** implement Redis-coordinated matchmaking whose committed matches remain durable in PostgreSQL.
- **Scope:** ticket lifecycle, one active ticket per user/game/mode, atomic enqueue/cancel/claim, TTL reservation, DB commit/release compensation, admission token, and post-commit notification intent.
- **Expected deliverables:** Matchmaking module, Redis scripts/adapters, match-creation port, contracts, and race tests.
- **Dependencies:** Phase 8B and database/Redis foundations.
- **Acceptance criteria:** exactly one of `MATCHED` or `CANCELLED` wins; match-found is exposed only after DB commit; Redis loss cannot erase a committed match.
- **Required tests and validations:** unit/integration tests, cancel-vs-match concurrency tests, duplicate enqueue tests, Redis/DB failure tests, lint/typecheck/build.
- **Status:** Pending

### Phase 10A — Game-core contract and Coup model foundation

- **Objective:** establish a framework-free, versioned game contract and immutable Coup state model.
- **Scope:** `GameEngine` interfaces, `Clock`, `RandomSource`, `RuleConfig`, standard result, manifest/descriptor alignment, command/event unions, validation, and initial state/deck creation.
- **Expected deliverables:** `packages/game-core`, Coup engine types/state initialization, deterministic fixtures, and forbidden-dependency tests.
- **Dependencies:** Phase 5B and Phase 7.
- **Acceptance criteria:** engine has no I/O/framework dependency or direct `Date.now()`/`Math.random()` call; versions are explicit; seeded test dependencies reproduce state.
- **Required tests and validations:** initialization/invariant/determinism tests, architecture checks, lint/typecheck/build.
- **Status:** Pending

### Phase 10B — Coup core actions and turn lifecycle

- **Objective:** implement income, foreign aid, coup, turn rotation, influence loss, elimination, and game completion.
- **Scope:** command validation, event generation/application, mandatory-coup threshold, player-specific and spectator projections, and result mapping.
- **Expected deliverables:** pure engine transitions and golden safe-view tests.
- **Dependencies:** Phase 10A; ruleset/legal wording remains subject to `OD-008`, so implementation must use an explicitly versioned provisional ruleset without claiming rights clearance.
- **Acceptance criteria:** transitions are deterministic and replayable; invalid actors/states are rejected; views reveal no other player's cards.
- **Required tests and validations:** example/unit, invariant, model/property, replay, result, and information-flow tests; lint/typecheck/build.
- **Status:** Pending

### Phase 10C — Coup claims, challenges, and blocks

- **Objective:** implement Tax, Steal, Assassinate, their challenge/block windows, and resolution ordering.
- **Scope:** Duke/Captain/Ambassador/Contessa claims, challenge outcomes, replacement/shuffle semantics, payment timing, pass windows, and multi-player eligibility.
- **Expected deliverables:** complete claim/challenge/block state machine and versioned events.
- **Dependencies:** Phase 10B.
- **Acceptance criteria:** every legal and illegal resolution path is specified; coins/cards/deck invariants hold; command ordering cannot double-resolve an action.
- **Required tests and validations:** rule matrix tests, property/model tests, deterministic replay, hidden-state views, lint/typecheck/build.
- **Status:** Pending

### Phase 10D — Exchange, timers, bot policy, and engine compatibility

- **Objective:** complete the Coup Game Module contract beyond direct player actions.
- **Scope:** exchange/deck integrity, deadline/timeout policy, bot policy using only PlayerView, result metrics, state migration/upcaster hooks, frontend adapter contract, and compatibility fixtures.
- **Expected deliverables:** production-complete pure engine module contract and compatibility test corpus.
- **Dependencies:** Phase 10C; takeover reclaim stays disabled by the documented MVP baseline unless `OD-004` is explicitly changed via ADR.
- **Acceptance criteria:** time/randomness are dependency-driven; bot has no hidden-state advantage; old fixtures migrate/replay or fail with a stable incompatibility code.
- **Required tests and validations:** timer tests, deck property tests, bot-valid-command tests, replay/migration/golden-view tests, architecture checks, lint/typecheck/build.
- **Status:** Pending

### Phase 11A — Match lifecycle and atomic command processing

- **Objective:** make matches durable, single-writer, version-checked, and idempotent.
- **Scope:** lifecycle transitions, pinned engine/state/ruleset versions, match players, row lock, `expectedVersion`, `(match_id, action_id)` processing, snapshot/events, and cached retry result in one short transaction.
- **Expected deliverables:** Matches domain/application service, repository implementation, schema evolution, and transaction tests.
- **Dependencies:** Phase 10D and Phase 4B.
- **Acceptance criteria:** accepted commands have at-most-once effect; state/event/version remain atomic; no network I/O occurs in the transaction.
- **Required tests and validations:** lifecycle/domain tests, duplicate/stale/concurrent command integration tests, rollback/failure tests, deterministic replay, lint/typecheck/build.
- **Status:** Pending

### Phase 11B — Transactional outbox and result projection inputs

- **Objective:** durably bridge committed match changes to realtime, jobs, and stats.
- **Scope:** versioned outbox events, claim/publish marking, retry/backoff, consumer deduplication, finish/result events, and trace-context propagation.
- **Expected deliverables:** outbox repository/dispatcher in Worker, consumer idempotency store/pattern, and integration tests.
- **Dependencies:** Phase 11A.
- **Acceptance criteria:** outbox row is written with state/events; nothing publishes before commit; retries may redeliver but cannot duplicate logical side effects.
- **Required tests and validations:** commit/rollback tests, dispatcher retry and duplicate-delivery tests, failed-queue behavior, lint/typecheck/build.
- **Status:** Pending

### Phase 12A — Versioned realtime contracts and authenticated gateway

- **Objective:** expose rooms, matchmaking, match commands/events, presence, and chat-ready channels through an authenticated Socket.IO adapter.
- **Scope:** handshake auth, namespaces/event catalog, acknowledgements/errors, membership authorization ports, rate-limit hooks, and identity binding.
- **Expected deliverables:** Realtime module/gateway, versioned event schemas/catalog, adapter tests.
- **Dependencies:** Phase 11B and Phase 6A.
- **Acceptance criteria:** payload `userId` is never authoritative; invalid schemas and unauthorized subscriptions fail with stable codes; gateway owns no game/business rule.
- **Required tests and validations:** Socket contract/integration/auth tests, architecture boundary checks, event catalog generation/diff, lint/typecheck/build.
- **Status:** Pending

### Phase 12B — Ordered delivery, fanout, and resynchronization base

- **Objective:** implement at-least-once player delivery with per-match sequence handling.
- **Scope:** post-commit fanout, player-specific projections, Redis adapter behavior, monotonic `seq`, duplicate/gap handling contract, snapshot/event catch-up endpoints, and connection draining.
- **Expected deliverables:** fanout adapters, resync use cases/contracts, client sequence utility, and multi-node/failure tests.
- **Dependencies:** Phase 12A.
- **Acceptance criteria:** only sanitized views leave the server; duplicates are harmless; gaps trigger catch-up; snapshots expose `stateVersion` and `lastEventSeq` and replace only older client state.
- **Required tests and validations:** delivery/ordering/gap tests, multi-socket integration, Redis-adapter degradation test, drain test, lint/typecheck/build.
- **Status:** Pending

### Phase 13 — Reconnection, timeout, and Bot takeover

- **Objective:** preserve active matches across disconnects and safely replace expired seats.
- **Scope:** presence, grace deadline, BullMQ delayed jobs, `connection_epoch`, expected state/version guards, reconnect cancellation/resync, `REPLACED_BY_BOT`, and spectator-only human return.
- **Expected deliverables:** Presence/reconnect application services, versioned job payload/handler, bot command integration, and race tests.
- **Dependencies:** Phase 12B and Phase 10D.
- **Acceptance criteria:** stale/duplicate jobs are no-ops; reconnect-vs-timeout has one valid winner; post-takeover humans receive only SpectatorView under the baseline policy.
- **Required tests and validations:** timer/integration/E2E tests, reconnect-vs-timeout races, duplicate job tests, worker restart/retry tests, hidden-information checks, lint/typecheck/build.
- **Status:** Pending

### Phase 14A — Telegram Mini App shell and shared platform UI

- **Objective:** create the React/Vite Mini App shell for authentication, profile, catalog, lobby, rooms, matchmaking, and realtime session state.
- **Scope:** Telegram bootstrap, memory-only auth state, TanStack Query server state, Zustand session/UI state, Tailwind design primitives, routing, accessibility/responsiveness, and contract clients.
- **Expected deliverables:** runnable web app and shared feature screens/components.
- **Dependencies:** backend contracts through Phase 13.
- **Acceptance criteria:** no token is stored in `localStorage`; server state is not treated as authoritative game logic; status/errors/reconnect states are usable in Telegram viewport constraints.
- **Required tests and validations:** component/unit tests, contract-client tests, accessibility checks, responsive visual verification, lint/typecheck/build.
- **Status:** Pending

### Phase 14B — Coup frontend adapter and game UI

- **Objective:** render and operate a complete Coup match solely from PlayerView/events.
- **Scope:** table/player/card views, action/target/challenge/block/exchange/lose-card flows, timers, reconnect/gap indicators, spectator state, animation without rule authority, and version mismatch handling.
- **Expected deliverables:** `apps/web/src/games/coup` adapter/screens/store/components and browser tests.
- **Dependencies:** Phase 14A and Phase 10D.
- **Acceptance criteria:** every valid server phase has a usable UI; unsupported versions fail safely; DOM/client state does not contain other players' hidden cards.
- **Required tests and validations:** component/state-adapter tests, golden UI states, hidden-data inspection, responsive/accessibility checks, Playwright match-flow tests, lint/typecheck/build.
- **Status:** Pending

### Phase 15A — Text chat

- **Objective:** add bounded, membership-protected match chat without weakening gameplay privacy.
- **Scope:** send/list contracts, PostgreSQL history/pagination, Socket delivery, membership checks, length/rate limits, escaping/sanitization, and telemetry redaction.
- **Expected deliverables:** Chat module, persistence/realtime adapters, Mini App UI, tests.
- **Dependencies:** Phase 14B; final retention/report/mute/age behavior depends on `OD-005`, so only the documented MVP-safe baseline may be implemented before resolution.
- **Acceptance criteria:** non-members cannot read/send; content is not logged/traced; stored/displayed content cannot inject active markup; pagination is stable.
- **Required tests and validations:** validation/auth/rate-limit/XSS tests, repository/realtime integration tests, UI tests, lint/typecheck/build.
- **Status:** Pending

### Phase 15B — Match results, user statistics, and leaderboard

- **Objective:** complete the `Finish -> Stats` portion of the MVP loop from durable match results.
- **Scope:** standard result persistence, idempotent stats projection, per-game aggregates, all-time/period dimensions, profile stats and leaderboard REST/UI.
- **Expected deliverables:** Leaderboard/statistics module, Worker consumer, APIs, UI, rebuild procedure, and tests.
- **Dependencies:** Phase 15A and Phase 11B.
- **Acceptance criteria:** PostgreSQL results remain source of truth; duplicate finish events do not double-count; projections can be rebuilt; no Redis leaderboard is added without measured need.
- **Required tests and validations:** result/projection idempotency tests, ranking/tie/pagination tests, rebuild integration test, REST/UI tests, lint/typecheck/build.
- **Status:** Pending

### Phase 16 — Observability, health, and operational runbooks

- **Objective:** make critical paths diagnosable and services safely operable.
- **Scope:** Pino allowlist logging/redaction, request/trace correlation, metrics, Sentry-safe reporting, liveness/readiness, graceful shutdown/draining, dashboards/alerts definitions, and required incident runbooks.
- **Expected deliverables:** observability package/config, health module, operational docs for exploit, DB/Redis loss, stuck match, maintenance, deploy rollback, and restore.
- **Dependencies:** functional services through Phase 15B; final SLO alert thresholds remain gated by `OD-007`.
- **Acceptance criteria:** critical path carries correlation IDs through outbox/worker; prohibited fields never enter telemetry; readiness/shutdown behavior is tested.
- **Required tests and validations:** log/trace redaction tests, health dependency tests, shutdown/drain integration tests, runbook review/drill evidence where environment permits, lint/typecheck/build.
- **Status:** Pending

### Phase 17A — Security hardening

- **Objective:** systematically close application, dependency, browser, transport, and administrative attack paths.
- **Scope:** threat-model review, distributed rate limiting, CORS/CSP/security headers, secret boundaries, authorization matrix coverage, dependency/secret/container scanning, admin RBAC/MFA/network design, and privacy checks.
- **Expected deliverables:** hardened configs/middleware, security test suite, scan policies, risk register updates, and any required ADRs.
- **Dependencies:** Phase 16; hosting/network controls depend on `OD-002`; product/legal controls depend on `OD-005` and `OD-008`.
- **Acceptance criteria:** no known Critical/High vulnerability is accepted without explicit risk decision; auth/role/membership/state checks are server-side; hidden and secret data are absent from outputs/telemetry.
- **Required tests and validations:** authorization matrix tests, input/fuzz/abuse tests, dependency/secret/container scans, header/CORS/CSP tests, PlayerView information-flow tests, lint/typecheck/build.
- **Status:** Pending

### Phase 17B — Contract, concurrency, fault, and E2E release suites

- **Objective:** turn cross-component correctness guarantees into repeatable release gates.
- **Scope:** OpenAPI/event catalog compatibility diffs, duplicate command, cancel-vs-match, reconnect-vs-timeout, DB/Redis degradation, worker retry, node drain, and complete MVP happy/failure paths.
- **Expected deliverables:** contract snapshots/checks, integration/fault suites, Playwright E2E suites, stable fixtures, and test documentation.
- **Dependencies:** Phase 17A.
- **Acceptance criteria:** the main `Account -> Find/Invite -> Play Coup -> Finish -> Stats` paths pass; breaking contracts fail unless versioned/ADR-approved; stated race invariants hold under repetition.
- **Required tests and validations:** all declared lint/typecheck/unit/integration/contract/build/E2E commands plus targeted fault and concurrency suites.
- **Status:** Pending

### Phase 17C — Capacity, reconnect-storm, and soak validation

- **Objective:** validate launch capacity and preliminary SLOs with measured evidence.
- **Scope:** workload model, 2x target load, payload/DB/Redis/socket metrics, reconnect storm, at least two-hour soak, bottleneck/remediation report.
- **Expected deliverables:** versioned load scenarios and evidence-backed capacity report.
- **Dependencies:** Phase 17B; `OD-001`, `OD-002`, and `OD-007` must be resolved before this phase can complete.
- **Acceptance criteria:** tested limits and environment are recorded; zero lost accepted commands/duplicate side effects/hidden leaks; agreed latency and resilience gates pass or the phase is Blocked.
- **Required tests and validations:** load, reconnect-storm, soak, resource saturation, failure/recovery, and result reconciliation checks.
- **Status:** Pending

### Phase 18A — CI quality and supply-chain pipeline

- **Objective:** enforce all reproducible quality gates on every change and release.
- **Scope:** frozen install, lint, typecheck, unit/integration/contract/build, staged E2E, generated-spec diff, migration compatibility, dependency/secret/container scans, and cache/artifact policy.
- **Expected deliverables:** CI workflows, protected release checks documentation, and immutable artifact metadata.
- **Dependencies:** Phase 17C.
- **Acceptance criteria:** clean CI passes; representative lint/contract/test/scan failures block; secrets and production credentials are not present in workflows.
- **Required tests and validations:** local workflow validation where available, clean CI run evidence, deliberate failure checks, lockfile integrity.
- **Status:** Pending

### Phase 18B — Docker packaging, migrations, staging, and production readiness

- **Objective:** package deployables and prove a safe staging-to-production operating path.
- **Scope:** minimal non-root images for API/Bot/Worker/Web, Compose/deployment definitions, expand/backfill/contract migration process, immutable tags, readiness/drain, rollback, backups/restore, and staging smoke.
- **Expected deliverables:** Dockerfiles/deployment assets, migration/release/rollback/restore runbooks, staging evidence, and release checklist.
- **Dependencies:** Phase 18A; provider/region `OD-002`, backup/PITR `OD-006`, and SLO `OD-007` must be resolved for completion.
- **Acceptance criteria:** images pass scans and run as non-root; staging migration/deploy/smoke/rollback succeeds; backup restore rehearsal meets approved RPO/RTO.
- **Required tests and validations:** image builds/scans, Compose validation, migration rehearsal, staging E2E/health checks, rollback and restore drills.
- **Status:** Pending

### Phase 19 — Final Definition of Done and release-readiness review

- **Objective:** determine factually whether the HamBazi MVP is ready for public production release.
- **Scope:** architecture/game-module/MVP DoD audit, unresolved decisions/ADRs, complete validation evidence, security/capacity/operations results, residual risk and launch/hold recommendation.
- **Expected deliverables:** updated implementation plan, traceable readiness matrix, residual-risk register, and release decision input in the conversation.
- **Dependencies:** all prior phases; all launch-blocking open decisions, including `OD-001` through `OD-008` as applicable, require recorded owner outcomes.
- **Acceptance criteria:** every DoD item has evidence or is explicitly Blocked; no unapproved open decision is silently fixed; production launch is recommended only when all mandatory gates pass.
- **Required tests and validations:** full frozen-install/lint/typecheck/unit/integration/contract/build/E2E pipeline, security scans, replay checks, load/soak evidence, restore/rollback evidence, and final diff/document review.
- **Status:** Pending

## Current gate

Phase 4B is completed, including the explicitly approved persistence correction
and native PostgreSQL migration/integration acceptance. Phase 5A — shared
contracts, validation, and stable errors — must not begin until the user explicitly
approves proceeding. The outstanding Docker/Redis verification gap remains tracked
and is not a claim of deployment readiness.
