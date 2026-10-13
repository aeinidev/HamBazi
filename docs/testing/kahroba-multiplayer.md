# Kahroba Phase K2 verification record

Date: 2026-10-12. Scope: disposable local integration only. See [ADR-065](../adr/065-kahroba-local-multiplayer-and-shared-results.md) and [integration design](../architecture/kahroba-multiplayer.md).

## Real-service inventory

`pnpm test:kahroba:local` completed successfully: **294 tests / 24 suites / zero skipped**. Each suite is launched directly with Vitest in fresh harness-owned PostgreSQL/Redis services; only prerequisite builds can use Turbo cache. No integration result is satisfied by cached output.

- Database foundation/grants/transaction/history checks: 17.
- API inventory: sessions, profile, catalog, rooms, admission, matchmaking, processing, private-room matches, reconnect, realtime, transport admission, chat, statistics, diagnostics, release contract, personal Coup/Anarchist, Kahroba.
- Worker inventory: statistics, Kahroba, cleanup, outbox, match automation, personal automation.
- New Kahroba API suite: **11 passed**, including complete 2/3/4-player games and exact engine-event replay, actor/turn/forgery rejection, concurrent/duplicate commands, real-transaction rollback, known-conflict retry, all-capacity Redis matchmaking/admission, public denial, owner-private Socket projections/catchup, epoch reconnect, PostgreSQL/Redis restarts, shared finish/result rollback and a fresh API process.
- New Kahroba Worker suite: **3 passed**, including actual process kill/restart and BullMQ recovery, one win per co-winner, duplicate receipts, changed-payload rejection, mixed v1/v2 generation rebuild, actual Redis outage/recovery and outbox redrive, and guarded work for already committed bot seats.

Shared-victory edge snapshots are synthetic, invariant-valid fixtures. Complete-game tests use real server-random initialization and normal durable commands. Rollback/retry failures are explicitly injected around real PostgreSQL transactions. Authentication uses actual durable sessions/JWT, with synthetic Telegram verification. Local gateway admission/rate fixture stubs are not claimed as a production load/security benchmark. The API/Worker child processes use built application ports; no live Telegram credentials are used.

Existing migrations initialize only a freshly created disposable schema. No new migration, staging/production operation, public route, game activation or commit occurs. Harness services/volume/network/private temporary configuration were cleaned up after the passing run.

## Earlier findings and limits

1. An initial harness used automatic ports; Docker changed Redis's port after restart. This was corrected with reserved loopback bindings. The final inventory passed actual restart checks.
2. The trusted descriptor initially included the extra engine command/event version fields. Strict admission rejected it. The adapter now supplies exactly the three admission pins, with a contract test.
3. Shared edge-fixture installation initially omitted the required Match version increment. The existing SQL guard correctly rejected it. The fixture now increments its version; runtime writer behavior was unchanged.
4. A Worker changed-payload test initially threw during synchronous schema parsing. It now submits a schema-valid changed metric and verifies asynchronous digest-conflict rejection.
5. A broader early run also executed the existing `apps/api/tests/integration/bot-delivery.test.mjs`: **three passed / three failed**, concerning one-button registration/support and interrupted registration expectations. Bot, Auth, Users and those tests are unchanged by K2. This unrelated suite is excluded from the focused K2 runner; its failures remain reported and are not counted as passing regressions. Repairing or changing Telegram onboarding behavior is outside K2.

No staging/native Telegram/browser K3 acceptance, load/soak, production restore/PITR or full external security scan is claimed. Human turn duration/fallback remain unapproved and rejected by the K2 adapter. The existing root scanner canary needs `SECURITY_SCANNER_DIR`; its actual status is recorded with repository checks below.

## Repository checks

`pnpm check` passed: formatting, zero-warning lint, architecture (15 workspaces / 264 source files), typechecks, workspace tests/builds and all existing plus new v2 contract checks. Workspace tests: **2,003 passed** (existing Turbo cache reused; the changed API suite ran fresh with 966 passing tests). Infrastructure: **127 passed / one existing scanner canary skipped** because `SECURITY_SCANNER_DIR` was unavailable. Total root result: **2,130 passed / one skipped**. Frozen-lockfile installation passed without changing existing dependency pins.

After adding the explicit replaced-seat spectator resync check, the focused disposable-service run passed again: database 17, Kahroba API 11, Kahroba Worker 3, with no skips. A direct Worker typecheck and focused lint/format checks verified the final test change. The full 294-test inventory had already passed with identical runtime source. Final whitespace/protected-path checks passed; Bot/Auth/Users, public compositions, web, Coup/Anarchist/K1 engine source, database schema/migrations, staging/production infrastructure and existing v1 baselines remain unchanged.

K2 local integration is complete. The unrelated three failing Bot delivery expectations remain an explicit limitation; this is not a claim that every optional repository integration suite passes. K3 UI has not started.
