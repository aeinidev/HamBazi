# Compatible release migrations

**Owner:** Database on-call with Backend/Release on-call. Keep migration authority
outside API/Worker/Bot/Web. This runbook prepares Phase 18B2; live execution requires
the later approved environment, recovery policy and operator scope.

1. Inventory the exact clean source/image pair, deployed migration checksums/grants,
   active Match engine/state/ruleset pins, v1 event/job handlers and pending consumer
   receipts. Review SQL and both readers/writers. Hash equality does not prove
   semantic compatibility. Modified applied migrations or unknown drift block rollout.
2. **Expand:** nullable/defaulted additions and additive grants/constraints must
   tolerate previous inserts/reads. Test on a populated prior schema with the actual
   previous artifact and roles. Keep old fields, adapters and queue handlers through
   at least one release overlap. A restrictive constraint can still break old code
   even when no column is dropped. Review locks/statement timeouts and interruption
   recovery in staging; do not guess production limits.
3. Verify approved backup/recovery evidence and secure operator access before any
   live schema operation. For the explicitly disposable personal staging in
   [ADR-050](../../adr/050-disposable-personal-staging-exception.md), record its scoped
   omission instead of marking recovery passed; confirm that the target contains
   only disposable synthetic data and obtain the applicable bounded migration scope.
   OD-006 remains unresolved for production; the disposable logical restore
   test is not permission to migrate real data or proof of PITR/RPO/RTO.
4. Through the existing database-owned deployment command and a separate restricted
   migrator environment, apply expansion then actual role grants:

   ```sh
   pnpm --filter @hambazi/database db:migrate
   ```

   Supply `MIGRATION_DATABASE_URL` through the approved private operator environment,
   never a CLI argument, app role file, log or shared CI credential. The command
   captures Prisma/SQL diagnostics and emits fixed errors. It applies grants after
   Prisma deploy; a grant-stage failure blocks app rollout even if schema committed.
   Inspect in a secure operator session and retry the same reviewed command only
   after diagnosing the cause. Do not invent reset/down/resolve operations.

5. **Migrate/backfill:** add an explicitly reviewed idempotent, bounded, restartable
   owner migration when data conversion is actually needed. Preserve original Match
   pins/state and queue IDs. No new backfill is required or implemented by 18B2;
   current thirteen migrations and permissions remain unchanged. Verify counts/
   invariants with content-free diagnostics, and do not capture hidden rows in logs.
6. Verify real API/Worker least-privilege access and denied DDL/cross-role content
   access, repeat deployment without duplication, and reconcile durable Match/
   event/command/result/receipt truth. Only then release compatible application code.
   Failure keeps traffic/admission closed; inspect original committed truth before
   retry. Do not automatically reinterpret an unfamiliar engine version.
7. **Contract:** after at least one release overlap and proof no old code, active
   state or queued job requires the old shape, seek separate authorization for a
   reviewed destructive migration and its recovery plan. Do not contract during
   application deployment/rollback. There is no destructive migration in this phase.

Application rollback keeps expansion and original durable rows; see
[Rollback](rollback.md). Database corruption/loss uses [Restore](restore.md), with a
separately approved recovery point/cutover. Do not combine those operations.

Local verification uses actual `db:migrate` fresh/repeat calls in owned image
fixtures and the existing isolated `pnpm test:auth-http:local` populated upgrade,
thirteen-migration/redeploy/grant/restart suite. Staging lock/duration estimates,
provider TLS/roles, real prior-version readers/writers and production recovery
objectives remain acceptance gates.
