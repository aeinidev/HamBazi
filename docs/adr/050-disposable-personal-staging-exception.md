# ADR-050: Disposable personal staging and omitted recovery gates

- Status: Accepted for the owner's temporary personal staging only; recovery evidence remains unperformed
- Owner: HamBazi project owner, also the sole operator, tester, secrets owner and monitoring responder
- Date: 2026-10-08
- Related: ADR-014, ADR-038, ADR-039, ADR-041, ADR-043, ADR-048, ADR-049
- Supersedes: ADR-049's unresolved ownership/recovery/monitoring statements for this temporary environment only

## Context

The owner confirmed that the existing ParsPack Germany staging host and development
Bot are personal, temporary and use disposable synthetic data. The owner explicitly
forbids provisioning backups, PITR, WAL archiving and external backup storage, and
operates monitoring manually through existing private health checks, safe logs and
metrics. These are supplied decisions, not unanswered proposals.

Architecture sections 19.2/19.3 require off-host backup for self-hosted PostgreSQL,
daily automated backups and restore tests. Sections 1.4 and 19.5 define recovery
criteria, including RPO/RTO and isolated/offsite restore evidence; section 27.4
requires backup/restore for MVP launch. Phase 18B3 and the migration/deployment
runbooks carry these gates forward. Omitting them requires a scoped exception;
disposable data cannot be reported as successfully restored.

## Decision

1. The project owner holds every operational role for this personal environment.
   There is no unanswered staffing, secrets-owner or monitoring-responder decision.
   Database API, Worker and migrator authority, Bot service/session keys, private
   access and applicable MFA/RBAC controls remain separated. One human operator
   does not imply shared service credentials or activated Admin authority.
2. Omit staging backup schedules, PITR, WAL archiving, backup retention, offsite
   archives and recovery-target provisioning. Accept the possibility of losing all
   disposable synthetic staging data. Assign no promised RPO or RTO. Starting a
   new empty test environment is a rebuild, not evidence of restoring lost data.
   PostgreSQL's normal transactional WAL, fsync and durable application correctness
   remain required; the omission concerns archiving/backup services.
3. For this environment only, record the architecture/18B3 backup, offsite/PITR,
   isolated-restore and measured RPO/RTO gates as **Excluded by accepted temporary
   exception — not performed, not passed**. A compatible initial migration on
   an explicitly disposable target may use this recorded exception instead of
   unavailable backup evidence, once its target and bounded execution are authorized.
   Compatible expansion/grants, idempotency, active pins/jobs, draining and application
   rollback still need their normal review and actual evidence. No destructive reset,
   real-data cutover or migration execution is authorized by this ADR.
4. Manual monitoring by the owner is the chosen temporary operating model. Do not
   require an external monitoring vendor or a new responder roster. Private checks,
   safe allowlisted logs and existing metrics remain the intended signals; their
   actual availability/coverage must be verified. The current portable definition
   uses logging driver `none`, and `prepare.mjs` rejects enabled metrics export.
   This implementation limitation is not a missing owner decision or proof of
   monitoring acceptance. Preserve the activation gate until the actual path is
   reviewed. Existing latency/capacity targets remain unchanged; no automated-alert,
   production availability or error-budget acceptance is inferred.
   The subsequent bounded repair in [ADR-051](051-private-manual-staging-preparation.md)
   adds an explicit private profile and read-only operator path; actual staging
   coverage remains unperformed while applications are inactive.
5. Record the owner's BotFather “Enable Mini App” selection and approved URL
   `https://staging.hambazi.top` as the Main Mini App direction. Official Telegram
   documentation supports `https://t.me/Hambazidev_bot?startapp` without a short name.
   Bot configuration and `prepare.mjs` require the HTTPS Web URL, not `ROOM_APP_NAME`.
   Current Room invitation config/helper/response schema require a named app segment;
   Main Mini App invitation generation is an implementation gap for the separately
   gated Room/gameplay composition. Do not invent a short name, weaken its validator
   or claim the live BotFather setting/mobile flow was independently verified.
6. The exception expires when the environment gains non-disposable data, additional
   testers, public-beta/production use or another target/scope. Resolve OD-006 and
   the normal recovery/monitoring release requirements before that transition.
   This ADR does not complete 18B3/19 or waive 7C, TLS, role separation, scan thresholds,
   advisory freshness, private data access or correctness requirements.

## Alternatives

- Provision the normal backup/PITR/offsite design: conflicts with the owner's explicit temporary scope.
- Leave the supplied decisions unanswered: repeats settled choices and misstates the checkpoint.
- Mark restore/recovery passed without backups: provides false acceptance evidence.

## Consequences

Temporary personal preparation no longer waits for backup settings, archive
references, responder names or a Mini App short name. Full loss of synthetic data
and gaps outside the owner's observation periods are accepted consequences of this
limited model. TLS/private-network references, role-specific inputs, runtime budgets
and applicable execution/activation evidence still need to be made concrete.
Production OD-006 and final OD-007 remain unresolved. Historical restore evidence
is retained with its original scope and does not fill this environment's excluded gates.

## References

- [Operating decisions](../operations/staging-operating-decisions.md)
- [Deployment preparation](../operations/deployment.md)
- [Architecture backup and recovery](../ARCHITECTURE.md#193-backup)
- [Telegram Main Mini App](https://core.telegram.org/bots/webapps#launching-the-main-mini-app)
- [Telegram Enable Mini App configuration](https://core.telegram.org/bots/webapps#recent-changes)
