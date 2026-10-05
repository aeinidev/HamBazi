# Phase 18B3 operating-decision worksheet

**Prepared:** 2026-10-04. **Status:** Draft; 18B3 operating decisions unapproved.
**Phase 18B3:** Pending; staging provisioning, deployment and activation remain
fully deferred. This worksheet is documentation preparation only.

The owner has approved portable 18B1/18B2 work and preparation of this worksheet.
Provider, region, domains, access model, backup/PITR policy, RPO/RTO, retention and
final SLOs remain unapproved. Completing this document or approving its format
does not authorize infrastructure changes. See the [implementation plan](../implementation-plan.md),
[portable deployment guide](deployment.md) and [ADR-043](../adr/043-portable-deployment-preparation.md).

## How to record a decision

1. Fill the answers below without adding credentials or sensitive payloads. Use
   restricted references for operator identities, account/network inventories,
   secret-store entries and recovery evidence; keep their contents out of Git.
2. For each decision group, record the owner, exact scope, rationale, alternatives,
   cost/operating consequences and approval reference/date. Until recorded owner
   approval exists, an answer is a proposal and its status remains unapproved.
3. Record architectural decisions in an ADR with Status, Context, Decision,
   Alternatives, Consequences, Owner and Date; identify any superseded ADR.
   Update the plan only to reflect the actual approved scope. This worksheet
   creates no accepted ADR and supersedes no existing decision.
4. Review the approved decisions together against the release and recovery
   procedures. Obtain explicit, bounded staging authorization separately before
   provisioning, publishing, migrating, deploying or changing Telegram settings.
5. After that authorization, collect actual staging evidence against the approved
   acceptance criteria. Decision approval alone is not evidence of a working system.

For every answer table, **Unresolved** means no value has been selected or approved.
All blank approval/evidence references below are **Unrecorded**, not passed gates.
Architecture section 1.4's initial numeric baselines and fixture configuration are
not approved final targets. Existing config bounds and drain budgets are not SLOs.

## Decision register

The architecture assigns owner roles; named approvers have not been assigned here.
DOMAIN/ACCESS/OPS are worksheet groups, not new architecture open-decision IDs.

| Group                                          | Required owner role                          | Status           | Named approver / approval date / reference / ADR |
| ---------------------------------------------- | -------------------------------------------- | ---------------- | ------------------------------------------------ |
| OD-002 — hosting and region                    | Tech                                         | Open; unapproved | Unrecorded                                       |
| DOMAIN — staging origins and Telegram identity | Tech + designated staging owner              | Unapproved       | Unrecorded                                       |
| ACCESS — operator and service access           | Tech + designated security/operations owners | Unapproved       | Unrecorded                                       |
| OPS — deployment and runtime operating policy  | Tech + designated release/operations owners  | Unapproved       | Unrecorded                                       |
| OD-006 — backup and recovery                   | Tech + Product                               | Open; unapproved | Unrecorded                                       |
| OD-007 — final SLOs and monitoring             | Tech                                         | Open; unapproved | Unrecorded                                       |

Use this record for each group when an owner supplies a proposal:

| Record field                                                        | Value      |
| ------------------------------------------------------------------- | ---------- |
| Group and document revision                                         | Unrecorded |
| Named decision owner and reviewer                                   | Unrecorded |
| Proposed answer and exact staging/production applicability          | Unresolved |
| Rationale, alternatives and consequences                            | Unrecorded |
| Cost limit and operational responsibility                           | Unresolved |
| Approval status                                                     | Unapproved |
| Approver, date and durable approval reference                       | Unrecorded |
| Accepted ADR or existing decision reference, including supersession | Unrecorded |
| Remaining conditions and evidence needed                            | Unrecorded |

## OD-002 — Hosting and region

| Question to resolve                                                                                                            | Approved answer |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Which provider/account owns staging, and who can administer/bill it?                                                           | Unresolved      |
| Which region and data-residency requirements apply to apps, durable data, archives and telemetry?                              | Unresolved      |
| Where will API/WS, Bot, Worker and static Web run; who operates PostgreSQL and Redis?                                          | Unresolved      |
| What staging budget, resource limits and workload inputs justify sizing?                                                       | Unresolved      |
| How are staging Bot/App, secrets, storage, queues and non-production data isolated from production?                            | Unresolved      |
| What private DNS, DB/Redis network paths, firewall/peer allowlists and controlled Bot egress are required?                     | Unresolved      |
| How do ingress, Socket.IO affinity/adapter and draining work for the approved node topology?                                   | Unresolved      |
| Does the chosen topology support the current amd64/IPv4 Compose path and TLS trust model, or need separately reviewed changes? | Unresolved      |

The portable definition creates no data services, volumes, ingress or networks.
Docker's internal bridge alone does not prove private provider connectivity or
firewall enforcement. Hosting proposals must preserve private PostgreSQL/Redis
and separate least-privilege API, Worker and migrator authority. Do not silently
extend the accepted portable preparation path to a different topology.

## DOMAIN and ACCESS — Origins, identities and access

| Question to resolve                                                                                            | Approved answer |
| -------------------------------------------------------------------------------------------------------------- | --------------- |
| What are the staging Web, public API/WSS and Bot webhook domains and DNS owners?                               | Unresolved      |
| Which separate staging Telegram Bot/App identity and deep-link configuration are approved?                     | Unresolved      |
| Which HTTPS/WSS certificates, issuers/trust, renewal owners and ingress peers apply?                           | Unresolved      |
| Which exact CORS origins, Mini App frame ancestors and immutable Web build policy are approved?                | Unresolved      |
| Who may use staging, through which access model, with what enrollment/revocation and test-data policy?         | Unresolved      |
| Which private operator paths, identity provider, verified MFA/RBAC, role roster and approval separation apply? | Unresolved      |
| How are health/metrics, the private Bot API and future Admin authority kept off public ingress?                | Unresolved      |
| Which secret-store/delivery/rotation mechanism and role-specific DB/Redis/TLS/Bot/session-key owners apply?    | Unresolved      |
| What audited emergency-access/recovery policy applies, without bypassing authorization?                        | Unresolved      |

Record only non-secret policy and restricted inventory references. Never place
tokens, passwords, keys, raw `initData`, MFA assertions or credential-bearing URLs
in this worksheet. The approved [session strategy](../adr/014-mini-app-session-strategy.md)
remains in force. The [browser policy](../security/browser-policy.md) requires actual
staging origin/header/SDK verification. The [Admin design](../security/admin-security-design.md)
assigns no operator and implements no mutation authority; 7C remains separately gated.

## OPS — Release and runtime operation

| Question to resolve                                                                                                                            | Approved answer |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Who publishes/reviews immutable images, where are they stored, and what protected hosted CI checks/evidence bind the exact source and digests? | Unresolved      |
| Who approves the current/previous release pair, active engine/state/ruleset pins and retained job/consumer versions?                           | Unresolved      |
| Which supervisor, readiness/admission sequence, traffic switching, stop grace and failure/rollback rules apply?                                | Unresolved      |
| Which separate migrator operator/access, compatible expansion/grant review, lock budgets and backfill recovery apply?                          | Unresolved      |
| Which explicit runtime quotas, pools, cleanup/queue budgets and configuration revisions apply within existing validated bounds?                | Unresolved      |
| Which allowlisted telemetry sink, access, retention, on-call roster and incident/release ledger apply?                                         | Unresolved      |

Follow [CI trust/evidence](ci.md), [migrations](runbooks/migrations.md) and
[rollback](runbooks/rollback.md). Keep at least one release overlap and old handlers
until compatible active state/jobs no longer need them. An image rollback retains
additive schema and durable history/receipts; it does not authorize destructive
SQL, database replacement or replay of every queue/outbox item. Publication,
repository settings and live operator composition need their own explicit scope.

## OD-006 — Backup, PITR and recovery

| Question to resolve                                                                                                                    | Approved answer |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| What durable-data recovery scope and acceptable loss/impact define the RPO, with units and measurement start/end?                      | Unresolved      |
| What service-recovery scope and start/end conditions define the RTO, with units?                                                       | Unresolved      |
| Which automated backup method/schedule and PITR/WAL capability are selected, and what budget/failure trade-offs justify them?          | Unresolved      |
| How are database contents, global roles/grants, server configuration and required versioned application/config references recoverable? | Unresolved      |
| Where are archives/WAL retained off the app/data host, and what approved region/failure-domain separation applies?                     | Unresolved      |
| What backup/WAL retention, expiration/deletion and legal/privacy constraints apply?                                                    | Unresolved      |
| What encryption, integrity/provenance verification, key recovery and least-privilege archive access apply?                             | Unresolved      |
| Who owns backup-failure/coverage alerts, archive verification and restore rehearsals, and at what approved cadence?                    | Unresolved      |
| What isolated restore destination, simulated failure/recovery point and acceptance measurements will prove the policy?                 | Unresolved      |
| How are queues/outbox, original command IDs, consumer receipts, Match versions/events and results reconciled before cutover?           | Unresolved      |
| Who approves recovery cutover/rollback, source preservation and resumption of accepted work?                                           | Unresolved      |

Use the [restore procedure](runbooks/restore.md), including restricted row-integrity
reconciliation, constraints/triggers/grants and append-only protections. PostgreSQL
is durable truth; Redis is coordination, not a substitute database backup. Queue
recovery still requires reviewed deduplication and epoch/version guards. The
existing same-cluster logical drill proves neither an offsite/global-role/WAL/PITR
design nor any production RPO/RTO. Evaluate the selected policy against the
architecture's backup requirements; any departure needs an explicit reviewed ADR.

## OD-007 — Final SLOs and monitoring acceptance

For each proposed SLO, define eligible operations, numerator/denominator or timing
boundaries, percentile where applicable, measurement window, exclusions, signal
source and response owner. Record units with every target. Do not exclude failures
merely because telemetry is missing; identify coverage/freshness requirements.

| SLO to decide                                          | Approved target / window | Approved definition / signal / owner |
| ------------------------------------------------------ | ------------------------ | ------------------------------------ |
| Critical path availability: Auth → Room/Match → Finish | Unresolved               | Unresolved                           |
| REST latency                                           | Unresolved               | Unresolved                           |
| Match command commit and acknowledgement latency       | Unresolved               | Unresolved                           |
| Committed Match-event fanout latency                   | Unresolved               | Unresolved                           |
| Reconnect success within the approved grace policy     | Unresolved               | Unresolved                           |
| Critical path correlation coverage and detection time  | Unresolved               | Unresolved                           |

| Monitoring decision                                                                               | Approved answer |
| ------------------------------------------------------------------------------------------------- | --------------- |
| Which error-budget window, burn rules and release/incident responses apply to each SLO?           | Unresolved      |
| Which region/client/test workload and instrumentation validate each definition?                   | Unresolved      |
| Which dashboard/uptime/reporting system, scrape access and safe retention apply?                  | Unresolved      |
| Which alert thresholds, persistence windows, named on-call routing and notification drills apply? | Unresolved      |
| What evidence establishes missing/stale collectors and accurate aggregation across nodes?         | Unresolved      |

The [dashboard](dashboard.json) and [alerts](alerts.json) are existing local
definitions, with final SLOs/routing still awaiting approval. Dependency probes
and local command metrics do not by themselves prove end-to-end availability,
commit-to-client fanout or reconnect success. Record measurement gaps and obtain
separate implementation approval when necessary. Architecture-required command
integrity, idempotency and hidden-information safety remain mandatory invariants;
this worksheet cannot trade them against a latency or availability target.

## Separate prerequisites and release gates

| Item                                                        | Boundary retained                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OD-001 — approved peak CCU, active Matches and commands/sec | Needed for sizing and 17C; no peak is inferred from fixtures or local runs.                                                                                  |
| OD-003 — session lifecycle                                  | Already resolved by ADR-014; preserve it. This worksheet chooses no replacement session strategy.                                                            |
| OD-004 — reclaim after Bot takeover                         | Existing MVP behavior stays unchanged; no reclaim decision is made here.                                                                                     |
| OD-005 — final retention/moderation/age/privacy             | Separate owner policy; temporary chat/statistics baselines do not resolve it. Coordinate backup/audit retention without silently choosing product retention. |
| OD-008 — Coup rights                                        | Separate Product/Legal public-release decision; no clearance is supplied here.                                                                               |
| Phase 7C — secured live game configuration                  | Pending; implement/verify the separately approved controls and gameplay readiness before live activation.                                                    |
| Phase 17C — capacity/reconnect/soak                         | Pending and required before final readiness: production-like staging, 2x approved peak, reconnect storm, at least two-hour soak and durable reconciliation.  |
| Phase 19 — final readiness review                           | Pending; this worksheet supplies no production launch approval.                                                                                              |

## Authorization record — no grants recorded

Keep decision acceptance separate from permission to execute. Before each future
authorized operation, record the named operator, target account/environment,
approved change plan/resource and cost limits, data scope, time window, exact
artifact/config revisions, failure/rollback conditions and durable approval
reference. Recovery cutover and production release require their own scope.

| Authorization                                                 | Current state                              | Approver / date / exact scope / reference       |
| ------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| Prepare this documentation worksheet                          | Authorized by owner; documentation only    | Owner request, 2026-10-04; no operational scope |
| Accept proposed operating decisions                           | Not granted                                | Unrecorded                                      |
| Publish artifacts or change hosted CI/repository settings     | Not granted                                | Unrecorded                                      |
| Provision staging resources/domains/access                    | Not granted; fully deferred                | Unrecorded                                      |
| Migrate/deploy/run staging drills or change Telegram settings | Not granted; fully deferred                | Unrecorded                                      |
| Enable live gameplay/admin controls                           | Not granted; 7C gate retained              | Unrecorded                                      |
| Run 17C or approve final production release                   | Not granted; separate phase gates retained | Unrecorded                                      |

## Future staging acceptance evidence

This is an evidence collection checklist for a separately authorized 18B3, not
an executable deployment plan. Each row is currently unverified on staging.
Use dated restricted evidence references and safe scalar results/hashes; no raw
DB rows/dumps, chat, cards/decks/hidden state, RNG material or error/trace payloads
may be attached to this worksheet or public CI artifacts.

| Acceptance item                                                                                                          | Evidence reference / result |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| Approved OD-002/006/007, origins/access/OPS and bounded execution authorization                                          | Unrecorded / unverified     |
| Exact clean source/current and rollback image identities, fresh scans, hosted protected CI and provenance                | Unrecorded / unverified     |
| Private data DNS/network/TLS, real role grants/denials, ingress/egress and secret rotation/trust                         | Unrecorded / unverified     |
| Compatible migration/redeploy, active Match pins and retained job-handler review                                         | Unrecorded / unverified     |
| Actual HTTPS/WSS health, browser headers/origins, Telegram SDK/mobile WebView and authorized product smoke               | Unrecorded / unverified     |
| Supervisor/ingress drain with accepted-work settlement, retry/reconnect and durable reconciliation                       | Unrecorded / unverified     |
| Actual candidate-to-previous staging rollback preserving schema/history/receipts                                         | Unrecorded / unverified     |
| Selected backup/PITR isolated restore, measured recovery point/time against approved RPO/RTO and reconciled durable data | Unrecorded / unverified     |
| Approved SLO definitions/signals, monitoring freshness/aggregation and notification drill                                | Unrecorded / unverified     |

Local 18B1/18B2 implementation and rehearsal evidence remains recorded in the
plan; it cannot fill these staging rows. Completing 18B3 would still leave 17C
as a required pre-release gate and 19 as the separate final-readiness review.

**Current outcome:** worksheet prepared; no operating decision resolved, no
staging action authorized, and 18B3 remains Pending and fully deferred.
