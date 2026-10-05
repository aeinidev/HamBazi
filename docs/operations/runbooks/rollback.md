# Bad deployment and rollback

**Owner:** Release on-call with Database/Backend on-call. **Severity:** SEV1 for
corruption/exploit; SEV2 for release-linked errors, bad readiness or failed drain.

1. Stop rollout and record immutable current/previous artifact digests, deploy time,
   schema migration set, enabled consumers/job versions and safe symptom metrics.
   Confirm the prior artifact supports every active Match engine/state/ruleset pin
   and retained v1 job/event shape. If it cannot, hold admission and escalate; do not
   discard unfamiliar jobs or reinterpret active state with the new engine.
2. Remove affected nodes from new ingress and drain through the approved supervisor.
   Observe NOT_READY first, then actual accepted-handler/job settlement, stopped/failed
   lifecycle and exit status. On deadline failure preserve the incident evidence and
   allow idempotent queue/transaction recovery. A forced exit does not prove drain.
3. Roll back application images/configuration to reviewed compatible immutable
   artifacts using the provider's approved release procedure. Phase 18B2 supplies
   [portable application definitions and a disposable image rehearsal](../deployment.md),
   with exact scanned digests and separate role files. It does not supply an
   approved live supervisor/ingress procedure; those remain 18B3. Do not run the
   local development Compose stack or an unapproved command against live systems.
4. Keep additive database expansion, append-only history, claims/receipts, result
   generations and old handlers through release overlap. Do not run migrate reset,
   drop tables/columns or destructive down SQL alongside an app rollback. A schema
   rollback needs a separately approved expand/backfill/contract plan; restore of
   lost/corrupt data uses [Restore](restore.md) with explicit cutover approval.
5. If rolling statistics consumers back, retain generation and immutable result
   storage; the documented old/new projection overlap remains valid. Do not drop
   active projections or replay finishes into an incompatible consumer. Disabled
   metrics/Sentry config can be removed without changing durable schemas/job payloads.
6. Check local health, approved external ingress, original-ID retries, safe reconnect
   snapshots, progressing outbox/queue and preserved Match/result/statistics truth.
   Annotate the approved release ledger with rollback digest/time. Return traffic
   only after commander acceptance; keep unresolved launch/7C gates intact.

Local preparation adds a real current/previous/current/previous image replacement
drill on owned PostgreSQL/Redis, with original intent/session preservation and
accepted HTTP drain (NOT_READY before settlement, then exit zero). Both artifacts
have unchanged product code/schema/protocols; this is not arbitrary-version rollback
compatibility. The generated production Web Compose definition is separately
rehearsed. Existing populated expansion/redeploy/restart/grant and accepted-worker
drain suites remain relevant. See [Migrations](migrations.md) for the separate
expand/backfill/contract gate. No production migration, real staging rollout,
supervisor/ingress switch or provider/PITR recovery occurred. Provider-specific
commands, fresh release-pair scans and measured staging rollback remain 18B3 gates.
