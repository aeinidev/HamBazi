# Database degradation

**Owner:** Database on-call, with Backend on-call. **Severity:** SEV1 for lost durable
availability or suspected corruption; SEV2 for rising latency/pool waiters.

1. Check postgres dependency_available/probe latency, actual database.completed
   latency, pool_max/total/idle/waiting and collector validity. Inspect safe
   INTERNAL_ERROR/state-conflict rates and the approved provider health view.
   Do not collect raw Prisma/query/connection errors into telemetry.
2. Prevent new Match creation/admission before overload worsens. Current code has
   no per-operation runtime kill switch: use approved ingress containment or drain
   the affected API nodes. PG-required readiness is NOT_READY; production ingress
   must have been rehearsed to honor it. Health alone does not implement routing.
   Preserve durable Match state, append-only events, processed commands/results and
   outbox. Do not move authority to Redis or accept writes into a temporary store.
3. Pause/drain Worker locally if durable transactions cannot progress. Preserve
   stable job IDs, failed jobs, schedules, receipts and leases. Existing retries and
   row/version/idempotency fences govern recovery; never reset state versions or
   replay client intents with new IDs to work around failures.
4. The database operator checks approved provider storage/connectivity/locks and
   restores availability using the provider's reviewed procedure. Do not raise pool
   limits across every process blindly: distinguish connection saturation, waiters
   and slow transactions. A healthy SELECT 1 is not proof that all writes/grants work.
   Corruption/data loss requires [Restore](restore.md), not an unreviewed migration.
5. Before reopening: confirm read-only health recovery and real authorized staging
   write/read success; compare accepted command IDs/state versions/event sequences,
   queue retries/outbox backlog and consumer effects. Reconcile ambiguous replies by
   retrying the original actionId/expectedVersion or REST commandId. A timeout is not
   evidence that the original transaction never committed.
6. Resume in controlled batches under commander approval; monitor latency, errors,
   pool waiters, terminated Matches and backlog. Keep feature/7C gates intact.

Local evidence: disposable integration covers database persistence, atomic rollback,
concurrent/idempotent writes, pool saturation and an accepted transaction held across
a drain caller deadline. Provider storage failure, true network partition,
production failover and ingress circuit handling remain unrehearsed.
