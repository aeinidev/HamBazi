# Redis unavailability and queue loss

**Owner:** Backend on-call. **Severity:** SEV2 for ephemeral degradation; escalate
SEV1 if admission consistency or durable recovery is at risk.

1. Confirm redis dependency_available/probe latency, Worker queue readiness,
   queue/outbox backlog, oldest pending age, rate-limiter degrade events and scrape
   validity. Bot backend health also requires its privileged API limiter. Distinguish
   unavailable transport from lost queue contents and worker-handler failure.
2. Degrade presence/matchmaking and fail closed for sensitive issuance/writes as the
   owning policies require. API DEGRADED keeps PostgreSQL-backed existing sessions
   and logout available. Do not globally eject all API instances solely for Redis
   loss or grant admission from client tickets. Disable new game admission via the
   approved containment path if coordination cannot be trusted; current catalog
   remains unplayable. No unsafe Redis fallback or reconstructed hidden Match state.
   Bound transport admission replies to the existing one-second deadline as well
   as cancelling queued commands. An already-written Redis command can ignore
   AbortSignal; its late reply must never grant a timed-out admission. Include a
   paused-service probe of existing-session reads, logout and denied fresh issuance
   in staging availability drills. Do not count the drill as full queue-storage recovery.
3. Preserve PostgreSQL Matches/events/commands/outbox/results and consumer receipts.
   Stop/drain local publishers/consumers if needed; do not delete failed jobs,
   flush Redis, reset counters or remove shared schedules. Connection health failure
   alone does not authorize destructive repair.
4. Restore the approved Redis service/configuration and verify authenticated
   read-only probes plus representative queue/script operations in staging. Reconnect
   leases/timeouts retain expectedConnectionEpoch/expectedStateVersion guards.
   Committed Bot takeover remains spectator-only; do not restore a human seat.
5. If queue data was lost, reconcile the restricted incident window's retained
   outbox records. PUBLISHED means enqueue acceptance, not completed consumption.
   The existing public `createMatchOutboxPort(...).redrive(eventId)` primitive is
   trusted recovery of retained FAILED/PUBLISHED rows after separate operator
   approval. Preserve original IDs/payloads and monotonically increasing attempts;
   do not create replacement IDs or mark effects completed manually. A still-present
   consumer-failed job needs its own reviewed failed-job retry after fixing its cause.
   There is no bulk recovery detector/Admin CLI in this repository.
6. Reconcile results/statistics through immutable Match truth and idempotent receipts.
   The declared trusted rebuild command is `pnpm --filter @hambazi/worker stats:rebuild`.
   Inspect [Statistics](../../architecture/statistics.md) for its required configuration
   and abandoned-generation recovery argument before invoking it. Finish recovery must corroborate retained inputs, not invent
   outcomes. Do not expose chat/game payloads while diagnosing replay.
7. Resume coordination only when queue backlog progresses, outbox failures have an
   approved disposition, reconnect succeeds and durable consistency is verified.
   Keep the 7C activation gate and final retention policy intact.

Local evidence: actual Redis connection loss/restart, durable session survival,
real BullMQ failure/recovery, outbox duplicate publication/receipt effects and
pause-vs-fetch handling. Network partitions, full Redis storage loss and bulk incident
reconciliation/notification drills require staging.
