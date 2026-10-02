# Backup restore and durable reconciliation

**Owner:** Database on-call with Release/Backend on-call. **Severity:** SEV1 for
confirmed data loss/corruption; SEV2 for a planned rehearsal.

OD-006 still owns PITR, RPO and backup retention; final provider/region is OD-002.
This procedure does not promise an RPO/RTO or select a production backup schedule.
Archives contain permitted durable hidden state/chat/auth storage and need restricted,
encrypted operator storage/access. Never attach an archive or raw restore error to
telemetry/tickets. Preserve the source and its append-only audit evidence.

1. Contain writes/admission, drain accepted work and pause consumer cutover under
   the commander. Establish the approved recovery point and impact window. Inventory
   the compatible app/schema/engine/job versions, roles/grants, outbox and projection
   generations. Do not declare a Redis snapshot the durable recovery source.
2. The authorized database operator verifies archive integrity/provenance/access and
   decrypts using the approved provider process. Restore into an isolated destination,
   never overwrite the live source during validation. A logical database dump does
   not include global roles, server configuration or a production WAL/PITR chain;
   these need the separately approved backup design. Use matching supported database
   tooling and verify all role credentials/grants without exposing them.
3. Reconcile retained tables and counts, exact row integrity inside restricted storage,
   schema constraints/triggers, column grants, Match version pins/event sequences,
   processed commands/idempotency, results, consumer receipts and projection head.
   Verify append-only guards. Do not synthesize missing RNG material, finishes or
   newer state. Rebuild statistics only from corroborated immutable Match results
   through the existing trusted rebuild procedure.
4. Redis queues may contain jobs newer/older than the recovery point. Isolate them
   from the restored DB until approved reconciliation: preserve original stable IDs,
   dedupe receipts and retained outbox; use reviewed per-event redrive/failed-job retry.
   Do not blanket-publish all rows or delete evidence. Stale lease/epoch/state-version
   jobs retain their normal guards. Keep Bot takeover behavior unchanged.
5. Run actual application health, least-privilege read/write/idempotency/reconnect
   checks and staging smoke against the isolated destination. Measure recovery time
   and compare to owner-approved RPO/RTO only after those targets exist. Obtain a
   separately approved cutover plan, rollback point and provider commands before
   changing live credentials/traffic. Reopen only after reconciliation and commander
   acceptance; retain the source per the approved policy.

## Repeatable disposable rehearsal

The declared local harness accepts `TEST_RESTORE_DRILL=isolated`. It creates its own
native PostgreSQL cluster and Redis container, migrates/seeds via actual tests, then
uses installed pg_dump/pg_restore to create a custom-format archive and a new database
inside that disposable cluster. It compares every public table's count/DB-computed
row digest, constraints, triggers, table/column grants; checks append-only protection
and real API/Worker credential reads; verifies the source is unchanged. No application
client is redirected. Archive mode is 0600 inside the private temporary directory;
cleanup removes only harness resources after successful shutdown.

Supply installed `TEST_POSTGRES_BIN` and, when needed, `TEST_POSTGRES_SHARE` and library
path as documented by the database local harness, then run the actual root script:

```sh
TEST_RESTORE_DRILL=isolated pnpm test:auth-http:local
```

This is logical restore into the same disposable server/roles, not recovery of a
Docker volume, global-role bootstrap, offsite encrypted archive, WAL/PITR, production
cutover or disaster region. Those drills, provider access/retention, RPO/RTO and
staging full-volume recovery remain OD-002/006 and Phase 18B gates.
