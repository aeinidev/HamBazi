# Admin Phase 4 Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the approved 4.1–4.6 Admin games/rooms/Matches scope locally without regressing phases 1–3.

**Architecture:** Same modular monolith and separate Admin listener. Add strict independent read schemas and owning public ports; reuse all existing administrative write commands and approval/audit machinery.

**Tech Stack:** Existing TypeScript/Nest/Fastify/Prisma/PostgreSQL/React/Vitest/Playwright/pnpm; no new dependency.

**Spec:** `docs/superpowers/specs/2026-11-04-admin-phase4-design.md` (records the already approved design).

## Global Constraints

- Only local synthetic fixtures; no Staging/Production/real OWNER/SSH/deploy/Phase 5.
- Keep frozen v1 baseline and resource/action field shapes; intentionally extend only the existing permission vocabulary under ADR-079/085 and document coordinated rollout/compatible history reader. New typed paths. Strict validation, at most 50 list rows and 64 roster seats; bounded query and scope before pagination.
- No hidden state, event payload, cards/RNG/chat/auth; no new service/queue/DB.
- Keep GAME_AVAILABILITY, ROOM_CLOSE, MATCH_TERMINATE writer/approval/Audit semantics; no new unsafe mutation.
- TDD RED then GREEN, unchanged existing assertions/timeouts; review before progressing.
- Recovery point of Claude's five exact files is outside Git; only those changes were restored. Work branch `codex/admin-phase4-rebuild`.

## Review Focus

- Filter/cursor cannot bypass a game deny or leak foreign identifiers; task 2/3 DB tests.
- Nullable room/pending readiness/64-seat overflow cannot become false health; task 3 tests.
- Current schema permits only metadata SELECT and rejects raw state/payload under real reader role; task 3 DB tests.
- Concurrent start/finish/permission changes invalidate preview without a second effect; task 4 existing plus targeted integration.
- Responses completing after navigation or revocation cannot repopulate another detail panel; task 5 browser tests.

### Task 1: 4.1 — Strict contracts, ADR and permissions

**Files:** Create `packages/validation/src/admin-game-management.ts`, tests in `packages/validation/tests`; update validation index and `admin-management.ts`; create `docs/adr/093-admin-games-rooms-matches.md`; extend `apps/api/src/admin/infrastructure/contract.ts` without changing frozen resource schemas or baseline; explicit permission-enum additions are the documented exception.

**Interfaces:** Export `adminGameSearchQuerySchema`, `adminRoomSearchQuerySchema`, `adminMatchSearchQuerySchema`, resource page/detail/roster/history/diagnostics schemas and their inferred types. Search queries: cursor?, limit?, search?, status?, gameId?, playerId? (Match only), createdFrom?/createdTo? (Room/Match); strict per-resource accepted keys. Common resource result metadata comes from the new schemas, never the old row model.

- [ ] Write failing schema tests: reject extra/hidden fields, invalid UUID/status/date/range/limit; accept bounded legitimate filters and nullable room; strict old adminRow still rejects additions.
- [ ] Run declared validation test script and record RED for missing new exports/behavior.
- [ ] Implement strict schemas, register explicit players/history/diagnostics permissions, ADR and additive OpenAPI paths.
- [ ] Run validation unit tests, build and contract compatibility against unchanged baseline; review.
- [ ] Commit only Task 1 files and record test evidence.

### Task 2: 4.2 — Owning search/read ports and HTTP

**Files:** Extend owning `apps/api/src/{games,rooms,matches}/infrastructure/repositories/admin-read.ts` with separately exported advanced read constructors; public module/index exports; Admin HTTP/composition; reader SQL grant file. Add `apps/api/tests/integration/admin-phase4.test.ts` to disposable harness `apps/api/tests/admin/local.mjs`.

**Interfaces:** Public constructors `createGamesAdminManagementRead(database)`, `createRoomsAdminManagementRead(database)`, `createMatchesAdminManagementRead(database)` expose `.search(query, games, excluded)` and `.detail(id, games, excluded)`. `AdminReadPort.management?` dispatches by resource/kind with scope supplied from authenticated Backend; no client-supplied environment.

- [ ] Write fixture tests for actual search/status/date/player filters, stable cursor, max50, excluded game and scoped missing detail; old resource endpoints unchanged; persisted action/history remains parseable by the new runtime.
- [ ] Run isolated harness and observe RED for missing path/port.
- [ ] Implement bounded owning queries, exact allowlist SELECT and route policy; public compose glue; narrow activation SQL separate from existing grants.
- [ ] Run actual reader-role tests and old phase2/3 suites; contract compatibility and review.
- [ ] Commit and ledger results before Task 3.

### Task 3: 4.3 — Detail/roster/history metadata

**Files:** Same owning advanced repositories/ports and integration fixture; `packages/database/prisma/admin-phase4-permissions.sql`; contract generation.

**Interfaces:** `.players(id,games,excluded)` for Room/Match, `.history(id,query,games,excluded)` for Match; schema outputs from Task 1. Match history allowlisted event metadata plus registered player placement/winner, never raw payload. Per-resource details include asOf and pinned Match versions.

- [ ] Write failing DB tests for nullable personal room, real roster readiness/agent/connection values, result metadata and seq pagination.
- [ ] Test real reader cannot SELECT state_jsonb/payload_jsonb/invite_code or write tables; positive projections must work with only bounded grants.
- [ ] Implement owner-controlled read-only snapshots, allowlists and explicit output schemas; overflow is error, not silent truncation.
- [ ] Run DB/API/security suites and review before commit.

### Task 4: 4.4 — Evidence-based diagnostics and safe commands

**Files:** Owning advanced repositories; Admin routes; integration and existing operations tests; ADR acceptance details.

**Interfaces:** `.diagnostics(id,games,excluded)` returns strict `state/reason/asOf`; no automatic mutation. All mutations still use existing `/operations` and action schemas.

- [ ] RED: expired WAITING/FULL Room is SUSPECTED; absent policy deadline is UNKNOWN; overdue live reconnect is SUSPECTED; terminal state cannot be repaired/terminated again.
- [ ] Implement diagnostics using existing durable expiry/deadline evidence only.
- [ ] Run close-v-start/finish-v-terminate/idempotency/UNKNOWN/Audit rollback and default-deny/pending/CSRF tests; no timeout changes.
- [ ] Review and commit.

### Task 5: 4.5 — Real Persian UI and browser acceptance

**Files:** New `apps/admin/src/features/game-management/index.tsx` and related focused style; minimal wiring in `app.tsx`; `apps/admin/tests/browser/phase4-real.spec.ts`; fixture invocation from real integration harness.

**Interfaces:** Panel consumes new typed routes and reused `ResourceActions`/`OperationFlow`. Callers supply existing access, csrf, refreshed callback and resource reload. IDs isolated with bdi; profile links gated by users.view; independent players/history/diagnostics permissions. Any profile navigation uses existing UserDetail route handling.

- [ ] Add browser tests against disposable TLS Backend first: filtering actual fixtures, detail links/roster/history, limited role denied routes, no hidden values in responses, terminal action disabled, navigation race and access revoke; fa-IR/RTL keyboard/390px/desktop/axe.
- [ ] Run RED against baseline UI, then implement minimal feature with error/empty/loading/asOf/refresh states and abort guards.
- [ ] Reuse prior commands, no duplicate credential or permission editor implementation. Run all Admin browser tests including phases 1–3, typecheck/build/lint; review and commit.

### Task 6: 4.6 — Release preparation and truthful qualification

**Files:** `docs/operations/admin-phase-4-release-readiness.md`, `docs/operations/admin-phase-4-staging-release-plan.md`, `docs/security/admin-phase4-qualification.json`; scoped infra checks only if needed.

- [ ] Run declared root quality/unit/infra/contracts and actual disposable integrations/browser/security/private ingress tests; preserve workload/timeouts.
- [ ] Build/scan final pinned local images and run standard `infra/ci/verify.mjs` only in a clean isolated candidate without developer .env; never fake evidence or rewrite baseline.
- [ ] Record every actual pass/failure/unrun gate and source/artifact identity. Prepare fresh encrypted full/offserver/restore gate and binary/grant rollback plan with Task-1 vocabulary/parser compatibility floor; no server backup or deploy in this authorization.
- [ ] Obtain fresh final whole-change Code Review; reproduce/fix material findings with RED→GREEN and rerun affected/full required suites.
- [ ] Commit documentation and report readiness/remaining gates; stop before deploy or Phase 5.
