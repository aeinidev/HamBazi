# Phase 18B3 operating-decision worksheet

**Prepared:** 2026-10-04. **Updated:** 2026-10-08. **Status:** Temporary host/origins, sole ownership, disposable data and manual monitoring confirmed; concrete preparation inputs remain missing.
**Phase 18B3:** Blocked; staging provisioning, deployment and activation remain
unstarted and fully deferred. Phase 17C is Completed for MVP with documented
performance exceptions under [ADR-048](../adr/048-mvp-capacity-acceptance.md),
2026-10-07. The authorized next-phase assessment is complete; independent
operating/environment/activation prerequisites below are unresolved. This
worksheet records approved inputs and decision preparation, not staging acceptance evidence.

The owner's continuous-execution instruction authorizes all remaining implementation
phases in dependency order. Generic phase approval need not be requested again;
actual operating decisions, environment/access and acceptance evidence are still
required before live operations can be made concrete.

The owner has approved portable 18B1/18B2 work and preparation of this worksheet.
Temporary ParsPack Germany hosting, the existing test VPS, staging domains and
development Bot are now confirmed under [ADR-049](../adr/049-temporary-parspack-staging-preparation.md).
Final production hosting, access model, backup/PITR policy, RPO/RTO, retention and
remaining final SLOs remain unapproved. Completing this document or approving its format
does not authorize infrastructure changes. See the [implementation plan](../implementation-plan.md),
[portable deployment guide](deployment.md) and [ADR-043](../adr/043-portable-deployment-preparation.md).

The owner's 2026-10-07 follow-up authorizes local read/write development,
security remediation, builds/scans, owned disposable database migrations and
local commits. The earlier repository read-only restriction is superseded.
Remote execution and unresolved policies are not inferred from that local scope.

## Confirmed temporary inputs and actual preparation

Use Web `https://staging.hambazi.top`, API/WSS `https://api-staging.hambazi.top`
and `wss://api-staging.hambazi.top`, webhook origin
`https://bot-staging.hambazi.top`, and development Bot `@Hambazidev_bot`.
The actual webhook route is `POST /v1/telegram/webhook`. The owner manages
DNS-only A records to `185.110.191.104` and confirmed the new ParsPack delegation.
Do not ask again for provider, region, resources or these hostnames.

Read-only checks verified SSH availability, Ubuntu 24.04.5 amd64, four logical
CPUs, approximately 3.8 GiB RAM, no swap, active Docker 29.8.2 and Compose v5.6.0.
At inspection the VPS had no application containers/volumes. Host/provider
firewall and operator access acceptance remain unverified; the observed SSH
configuration is not an approved security policy.

All six IPv4 parent nameservers and eight unique authoritative IPv4 endpoints
returned the new delegation / authoritative SOA and expected A records from
both local and VPS paths. Two IPv6-only parent endpoints were unavailable from
these paths. A six-round public sample retained five local and three VPS
Cloudflare SERVFAIL responses among 36 Cloudflare queries; EDE referenced an old
nameserver returning REFUSED. Google and the subsequent Cloudflare DoH checks
passed. This supports stale recursive delegation as the observed failure,
without declaring global DNS stability or changing settings.

The later three-round Cloudflare sample at 2026-10-07 16:17 UTC returned all
18 expected A answers across local and VPS paths. Preserve earlier failures and
recheck before external execution; this sample does not certify every cache.

The original clean `a212cd4` inventory and its failures remain in private storage
outside Git. Its fresh four-role image scan passed with one Moderate zlib
`CVE-2026-85091` per image and no High/Critical/Unknown. The full-lockfile audit
separately blocked on High `GHSA-68fv-2mgg-jv7q` in source-map-js 1.2.1.
The original production-Web definition rehearsal passed 13 checks and cleaned
its owned fixtures. These are local preparation results, not staging evidence.
Fresh advisory retrieval verified the official GHCR manifest/layer digests,
completed a timed-out transfer using HTTP Range and retained its failures;
the unchanged scanner still enforces schema 2, 24-hour freshness and all
existing blocking severities without suppression or skip flags.

Authorized remediation updates only the existing transitive lockfile resolutions
to source-map-js 1.2.2. The clean local source `65ff180` now has a separate four-role
candidate using the exact approved Web/API origins, successful fresh image/audit/
secret scans, 1,831 quality tests and 26/33/2 Web browser cases. Its local definition
and runtime rehearsals pass 13/43 checks plus two image-browser cases, with owned
fixture cleanup verified. All six application/data image scans have zero
High/Critical/Unknown and one Moderate zlib CVE-2026-85091 each. The final six-round
Cloudflare/Google sample passed all 72 local/VPS A queries; earlier failures remain.
The original inventory is never rewritten. See the current 18B3 plan record for
dated hashes and restricted evidence references. No new release rollback pair,
actual staging acceptance, recovery objective or external authorization is inferred.

## Supplied personal-staging decisions — 2026-10-08

[ADR-050](../adr/050-disposable-personal-staging-exception.md) records the project
owner as the sole operator, tester, secrets owner and monitoring responder. Use
only disposable synthetic staging data. Do not provision backups, PITR, WAL
archiving or external backup storage. Recovery gates are **Excluded by accepted
temporary exception — not performed, not passed**; no RPO/RTO promise exists.
Normal transactional durability, compatible migrations, application rollback and
security/correctness gates remain mandatory.

Manual monitoring through existing private health checks, safe logs and metrics
is the selected model. No new monitoring vendor/responder selection is requested.
Actual coverage is unverified: portable Compose selects logging driver `none`,
and `prepare.mjs` rejects enabled metrics export. Preserve the activation gate
while reviewing that implementation gap. Production final availability/error-budget/
automated-alert acceptance remains separate.

The owner selected BotFather's “Enable Mini App” path with the approved Web URL.
Official Main Mini App links need no short name. Bot/portable preparation accept
`BOT_MINI_APP_URL=https://staging.hambazi.top`; `ROOM_APP_NAME` is absent from the
preparation allowlist. Room invitation config, shared link builder and response
schema still require a named-app path. Main-flow invitation generation is an
implementation prerequisite for later Room/gameplay activation, not an unanswered
short-name decision. No live Telegram setting is independently verified.

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

## Exact preparation inputs still missing

`infra/docker/release/inputs.example.json` has eight top-level fields. It contains
no backup/PITR/monitoring-vendor/short-name/operator-roster field. The existing
clean `65ff180` inventory and adjacent scan are available privately on the laptop;
their identities/freshness were revalidated on this follow-up, not rescanned or
rewritten. `schemaVersion=1`, exact staging origins/development Bot and ADR-014's
900/300/30-second auth profile and 30/6 issuance limits are already established.
The generic preparation metadata still lists normal-release OD-006/007 gates;
record this target's accepted ADR-050 exception separately in the operating ledger,
without adding a skip flag or claiming those evidence gates passed.

The following are concrete **proposals, not adopted operating values**. A read-only
VPS preflight found no overlap for the two proposed CIDRs, no required custom
networks/private directory/application containers, and no Node/pnpm preparation
toolchain. The private draft uses the exact schema and is intentionally not ready
to run. Pure existing role/environment parsers accepted its proposed values with
transient in-memory synthetic credentials; no credential was persisted, no actual
`prepare.mjs`/TLS/connectivity/grant acceptance was performed.

| Actual missing input                                                | Concrete recommendation                                                                                                                                                                                                                                                                                                                           | Consequence / prerequisite                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `privateNetwork`, `botEgressNetwork`, `privateAddresses`            | `hambazi-staging-private`, internal `10.89.18.0/24`; separate controlled `hambazi-staging-bot-egress`, `10.89.19.0/24`; API/Bot/Worker/Web `.10/.11/.12/.13` in the private subnet                                                                                                                                                                | Networks must actually exist on the daemon checked by prepare; inspect again before use. No public data/health ports.                                                                                                                                                                                                                   |
| API/Worker data-service URLs and trust                              | Temporary same-VPS PostgreSQL/Redis on private aliases `postgres-staging` / `redis-staging`, separate fixed roles/passwords; PostgreSQL `sslmode=verify-full`, Redis `rediss://`                                                                                                                                                                  | Certificates/trust and least-privilege grants need review. The current definition creates no data service or extra data-CA mounts; URL validation does not prove trust. Shared host failure affects all disposable data.                                                                                                                |
| Role ports, ingress peer and `stopGraceSeconds`                     | API HTTP/health/private Bot TLS `8080/8081/9443`; Bot HTTPS/health `9444/8082`; Worker health `8083`; Web HTTP/health `8080/8081`; private ingress peer `10.89.18.2`; grace 45 seconds for each role                                                                                                                                              | API trusts only that reviewed ingress peer; Bot preserves actual HTTPS and rejects forwarded headers. API/Worker drain 15 seconds, Bot 30 seconds, probe 1 second fit existing budgets. Grace is not an SLO.                                                                                                                            |
| Runtime quotas, cleanup/queue and binding identifiers in role files | API/Worker pools `5/3`; profile read/write `60/10`, catalog `60`; HTTP/Engine/connect/event admission per minute `300/60/10/120`, in-flight HTTP/Engine `8/8`, connections `32`, pending per socket/total `4/32`, subscriptions `8`; Worker namespace `hambazi_staging_personal`; cleanup interval/batch/attempts/backoff `60000 ms/10/3/1000 ms` | This sole-tester envelope limits resource use; it does not replace ADR-045/046 capacity/SLO targets. Full proposed public fields, including auth/service key IDs and issuer/audience, are in the private review artifact.                                                                                                               |
| `roleEnvFiles` and `tlsFiles`                                       | `/opt/hambazi-staging/private/{api,bot,worker,web}.env`; `tls/{api-key.pem,api-cert.pem,bot-key.pem,bot-cert.pem,api-ca.pem}` under that directory                                                                                                                                                                                                | Four literal production-profile files, mode 0600, separate authority, real development Bot credential and independently generated session/service/webhook secrets. Separate private TLS pairs need API/Bot private-IP SANs and API CA verification. Keys must be privately readable by runtime UID 1000. Never submit contents in chat. |
| `inventory`, input/output location and execution context            | Preserve laptop inventory as source; intended VPS copy `/opt/hambazi-staging/private/release/current/images.json` with adjacent `.scan.json`; input `/opt/hambazi-staging/private/inputs.json`, new output `/opt/hambazi-staging/private/prepared-20261008`                                                                                       | Private directories 0700, files 0600, no symlinks/overwrite. A reviewed runner needs the repository/config public build and the pinned Node 24.20.0 and pnpm 12.4.1, and must inspect the same daemon as the target networks. Recheck scan freshness at execution.                                                                      |

The non-secret review artifacts are outside Git at
`~/.cache/hambazi-18b3-personal-preparation-20261008/inputs.proposed.json` and
`public-values.proposed.json`. They distinguish adopted owner decisions from
proposed values and missing credential fields. No actual role/TLS file, network,
backup service, hosted registry or external policy approval is created by them.
Public TLS/framing and verified private operator access remain activation evidence;
they are not extra top-level fields in this portable schema. A named Mini App,
backup archive, monitoring vendor and separate human roster are not prerequisites
to this `prepare.mjs` input file.

## Decision register

**OD-001 approved (2026-10-05):** **1,000 concurrent users, 200 active Matches and
50 gameplay commands/sec**, with **2,000/400/100** at 2x. [ADR-045](../adr/045-initial-capacity-target.md)
records the complete MVP decision. [ADR-046](../adr/046-normal-load-capacity-slos.md)
records normal-load REST/ack p95 ≤ 300 ms, event dispatch p95 ≤ 500 ms, reconnect
success ≥ 99% and reconnect p95 ≤ 5 seconds; those latency gates do not apply at
2x. Remaining final availability/error-budget/monitoring policy under OD-007,
hosting and staging/recovery acceptance are unresolved. ADR-048 changes only MVP
completion acceptance: approved targets remain future optimization/production-like
staging targets, with local limitations accepted and no SLO success claim.

The project owner confirmed the temporary inputs in ADR-049 and holds every
personal-staging operational role under ADR-050. No additional operator, secrets
owner or monitoring responder is requested. Actual service credentials and access
mechanisms remain separate from human ownership.
DOMAIN/ACCESS/OPS are worksheet groups, not new architecture open-decision IDs.

| Group                                          | Required owner role | Status                                                                                                       | Named approver / approval date / reference / ADR |
| ---------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| OD-002 — hosting and region                    | Project owner       | Temporary host/region/operator confirmed; private data topology and production policy open                   | ADR-049/050; 2026-10-07/08                       |
| DOMAIN — staging origins and Telegram identity | Project owner       | Origins/Bot/DNS/Main direction confirmed; no short name needed for preparation; TLS/framing evidence pending | ADR-049/050; 2026-10-07/08                       |
| ACCESS — operator and service access           | Project owner       | Sole owner/tester/secrets owner confirmed; mechanism and private references missing                          | ADR-050; 2026-10-08                              |
| OPS — deployment and runtime operating policy  | Project owner       | Sole operator confirmed; runtime values/release references and execution evidence pending                    | ADR-050; 2026-10-08                              |
| OD-006 — backup and recovery                   | Project owner       | Excluded for disposable personal staging, unperformed; production decision remains open                      | ADR-050; 2026-10-08                              |
| OD-007 — final SLOs and monitoring             | Project owner       | Manual personal monitoring/responder confirmed; coverage and final production SLOs pending                   | ADR-046/050; 2026-10-05/08                       |

Use this blank record for a new proposal; it does not erase the confirmed decisions above:

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

| Question to resolve                                                                                                            | Approved answer                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Which provider/account owns staging, and who can administer/bill it?                                                           | Existing ParsPack test host; project owner is the sole owner/operator; no new resource scope inferred                            |
| Which region and data-residency requirements apply to apps, durable data, archives and telemetry?                              | Germany temporary VPS; backup archives omitted and private manual monitoring selected; production policy unresolved              |
| Where will API/WS, Bot, Worker and static Web run; who operates PostgreSQL and Redis?                                          | Project owner operates all roles; exact private data-service topology remains missing                                            |
| What staging budget, resource limits and workload inputs justify sizing?                                                       | Existing 4-CPU / approximately 3.8-GiB host confirmed; runtime budgets/cost limits unresolved; ADR-045 targets unchanged         |
| How are staging Bot/App, secrets, storage, queues and non-production data isolated from production?                            | Development Bot and disposable synthetic personal data confirmed; actual separated credentials/storage/queue references required |
| What private DNS, DB/Redis network paths, firewall/peer allowlists and controlled Bot egress are required?                     | Unresolved                                                                                                                       |
| How do ingress, Socket.IO affinity/adapter and draining work for the approved node topology?                                   | Unresolved                                                                                                                       |
| Does the chosen topology support the current amd64/IPv4 Compose path and TLS trust model, or need separately reviewed changes? | Host architecture/Docker/Compose compatible; actual private-network/data TLS acceptance unresolved                               |

The portable definition creates no data services, volumes, ingress or networks.
Docker's internal bridge alone does not prove private provider connectivity or
firewall enforcement. Hosting proposals must preserve private PostgreSQL/Redis
and separate least-privilege API, Worker and migrator authority. Do not silently
extend the accepted portable preparation path to a different topology.

## DOMAIN and ACCESS — Origins, identities and access

| Question to resolve                                                                                            | Approved answer                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| What are the staging Web, public API/WSS and Bot webhook domains and DNS owners?                               | ADR-049 exact origins; owner-managed ParsPack DNS-only records/delegation                                                               |
| Which separate staging Telegram Bot/App identity and deep-link configuration are approved?                     | @Hambazidev_bot and Main direction confirmed; no short name requested; named-only Room invitation implementation remains gated          |
| Which HTTPS/WSS certificates, issuers/trust, renewal owners and ingress peers apply?                           | Project owner operates renewal; issuer/trust, real certificates and ingress peer remain missing                                         |
| Which exact CORS origins, Mini App frame ancestors and immutable Web build policy are approved?                | Exact approved Web/API origins in immutable production candidate; framing remains deny-by-default pending reviewed Telegram Web origins |
| Who may use staging, through which access model, with what enrollment/revocation and test-data policy?         | Project owner only, disposable synthetic data; actual restriction/enrollment mechanism unverified                                       |
| Which private operator paths, identity provider, verified MFA/RBAC, role roster and approval separation apply? | Sole human operator confirmed; technical private access/MFA/RBAC and 7C evidence remain pending                                         |
| How are health/metrics, the private Bot API and future Admin authority kept off public ingress?                | Unresolved                                                                                                                              |
| Which secret-store/delivery/rotation mechanism and role-specific DB/Redis/TLS/Bot/session-key owners apply?    | Project owner owns secrets; protected role-specific file delivery/rotation and actual references missing                                |
| What audited emergency-access/recovery policy applies, without bypassing authorization?                        | Backup recovery omitted only under ADR-050; private access and separately authorized rebuild/rollback remain required                   |

Record only non-secret policy and restricted inventory references. Never place
tokens, passwords, keys, raw `initData`, MFA assertions or credential-bearing URLs
in this worksheet. The approved [session strategy](../adr/014-mini-app-session-strategy.md)
remains in force. The [browser policy](../security/browser-policy.md) requires actual
staging origin/header/SDK verification. The [Admin design](../security/admin-security-design.md)
assigns no operator and implements no mutation authority; 7C remains separately gated.

## OPS — Release and runtime operation

| Question to resolve                                                                                                                            | Approved answer                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Who publishes/reviews immutable images, where are they stored, and what protected hosted CI checks/evidence bind the exact source and digests? | Project owner; publication mechanism/hosted evidence pending and not an input to prepare.mjs                                                   |
| Who approves the current/previous release pair, active engine/state/ruleset pins and retained job/consumer versions?                           | Project owner; actual pair/compatibility review pending                                                                                        |
| Which supervisor, readiness/admission sequence, traffic switching, stop grace and failure/rollback rules apply?                                | Unresolved                                                                                                                                     |
| Which separate migrator operator/access, compatible expansion/grant review, lock budgets and backfill recovery apply?                          | Project owner uses separate migrator authority; actual references/review/scope pending; ADR-050 applies only to disposable target              |
| Which explicit runtime quotas, pools, cleanup/queue budgets and configuration revisions apply within existing validated bounds?                | Unresolved                                                                                                                                     |
| Which allowlisted telemetry sink, access, retention, on-call roster and incident/release ledger apply?                                         | Manual private health/safe logs/metrics, project owner responds; signal path/coverage and ledger pending; no external sink selection requested |

Follow [CI trust/evidence](ci.md), [migrations](runbooks/migrations.md) and
[rollback](runbooks/rollback.md). Keep at least one release overlap and old handlers
until compatible active state/jobs no longer need them. An image rollback retains
additive schema and durable history/receipts; it does not authorize destructive
SQL, database replacement or replay of every queue/outbox item. Publication,
repository settings and live operator composition need their own explicit scope.

## OD-006 — Backup, PITR and recovery

**Personal staging outcome: supplied and accepted under ADR-050.** Do not request
backup schedules, PITR/WAL archive destinations, retention, encryption-key references
or recovery targets for this environment. No backup service/storage is provisioned.
All corresponding evidence remains excluded/unperformed, never passed. The normal
questions below are retained solely for future non-disposable/production use;
they are not outstanding personal-staging decisions.

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

**Personal staging outcome: manual monitoring and sole responder confirmed.**
Actual private-health/log/metric availability remains unverified. The following
final SLO/alert questions apply to normal production acceptance; do not request
an external platform, responder roster or automated notification policy as an
unanswered personal-staging decision. Preserve ADR-045/046 targets and ADR-048
exceptions, with no new performance or availability success claim.

For each proposed SLO, define eligible operations, numerator/denominator or timing
boundaries, percentile where applicable, measurement window, exclusions, signal
source and response owner. Record units with every target. Do not exclude failures
merely because telemetry is missing; identify coverage/freshness requirements.

| SLO to decide                                          | Approved target / window                                   | Approved definition / signal / owner                                   |
| ------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| Critical path availability: Auth → Room/Match → Finish | Unresolved                                                 | Unresolved                                                             |
| REST latency                                           | 17C normal load: p95 ≤ 300 ms                              | ADR-046; final operating window/signal/owner unresolved                |
| Match command commit and acknowledgement latency       | 17C normal load: acknowledgement p95 ≤ 300 ms              | ADR-046; final operating window/signal/owner unresolved                |
| Committed Match-event fanout latency                   | 17C normal load: dispatch-to-all-recipient p95 ≤ 500 ms    | ADR-046; exact staging signal/owner unresolved                         |
| Reconnect success and completion timing                | 17C normal load: success ≥ 99%; completion p95 ≤ 5 seconds | ADR-046; independent gates; final grace policy/signal/owner unresolved |
| Critical path correlation coverage and detection time  | Unresolved                                                 | Unresolved                                                             |

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

| Item                                                        | Boundary retained                                                                                                                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OD-001 — approved peak CCU, active Matches and commands/sec | Approved MVP: 1,000 concurrent users, 200 active Matches and 50 gameplay commands/sec; 2x stress is 2,000/400/100 under ADR-045.                                                               |
| OD-003 — session lifecycle                                  | Already resolved by ADR-014; preserve it. This worksheet chooses no replacement session strategy.                                                                                              |
| OD-004 — reclaim after Bot takeover                         | Existing MVP behavior stays unchanged; no reclaim decision is made here.                                                                                                                       |
| OD-005 — final retention/moderation/age/privacy             | Separate owner policy; temporary chat/statistics baselines do not resolve it. Coordinate backup/audit retention without silently choosing product retention.                                   |
| OD-008 — Coup rights                                        | Separate Product/Legal public-release decision; no clearance is supplied here.                                                                                                                 |
| Phase 7C — secured live game configuration                  | Pending; implement/verify the separately approved controls and gameplay readiness before live activation.                                                                                      |
| Phase 17C — capacity/reconnect/soak                         | Completed for MVP under ADR-048: mandatory local correctness/recovery gates pass; documented performance exceptions and strict measurement/optimization/staging/two-hour soak remain deferred. |
| Phase 19 — final readiness review                           | Blocked / hold: independent staging/activation/operating/privacy/rights evidence is absent; this worksheet supplies no production launch approval.                                             |

## Authorization record

Keep decision acceptance separate from permission to execute. Before each future
authorized operation, record the named operator, target account/environment,
approved change plan/resource and cost limits, data scope, time window, exact
artifact/config revisions, failure/rollback conditions and durable approval
reference. Recovery cutover and production release require their own scope.

| Authorization                                                                                                               | Current state                                                                                                                          | Approver / date / exact scope / reference                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Prepare this documentation worksheet                                                                                        | Authorized by owner; documentation only                                                                                                | Owner request, 2026-10-04; no operational scope                                                 |
| Local 18B3 project/development read/write, security remediation, builds/tests/scans and owned disposable migrations/commits | Authorized; prior repository read-only restriction superseded                                                                          | Owner request, 2026-10-07; ADR-049; no external production scope                                |
| Accept proposed operating decisions                                                                                         | Temporary host/origins/Bot/DNS and sole roles/disposable-data/no-backup/manual-monitoring decisions confirmed; concrete inputs pending | Project owner, 2026-10-07/08; ADR-049/050                                                       |
| Publish artifacts or change hosted CI/repository settings                                                                   | Not granted                                                                                                                            | Unrecorded                                                                                      |
| Provision staging resources/domains/access                                                                                  | Existing host/domains/DNS supplied by owner; further remote provisioning/access changes deferred                                       | ADR-049; additional bounded scope unrecorded                                                    |
| Migrate/deploy/run staging drills or change Telegram settings                                                               | Not granted; fully deferred                                                                                                            | Unrecorded                                                                                      |
| Enable live gameplay/admin controls                                                                                         | Not granted; 7C gate retained                                                                                                          | Unrecorded                                                                                      |
| Run local 17C tooling/smoke                                                                                                 | Authorized; actual evidence recorded                                                                                                   | Owner request, 2026-10-05; [capacity scope](../testing/capacity.md)                             |
| Proceed to Phase 18B3 after actual 17C completion                                                                           | Authorized assessment performed; execution Blocked by independent prerequisites                                                        | Owner instructions, 2026-10-05 and 2026-10-07; [ADR-048](../adr/048-mvp-capacity-acceptance.md) |
| Approve final production release                                                                                            | Not granted; separate phase gates retained                                                                                             | Unrecorded                                                                                      |

## Future staging acceptance evidence

This is an evidence collection checklist for a separately authorized 18B3, not
an executable deployment plan. Each row is currently unverified on staging.
Use dated restricted evidence references and safe scalar results/hashes; no raw
DB rows/dumps, chat, cards/decks/hidden state, RNG material or error/trace payloads
may be attached to this worksheet or public CI artifacts.

| Acceptance item                                                                                                          | Evidence reference / result                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Approved OD-002/006/007, origins/access/OPS and bounded execution authorization                                          | ADR-049/050 confirmed inputs/exception; concrete configuration and bounded external scope pending                |
| Exact clean source/current and rollback image identities, fresh scans, hosted protected CI and provenance                | Unrecorded / unverified                                                                                          |
| Private data DNS/network/TLS, real role grants/denials, ingress/egress and secret rotation/trust                         | Unrecorded / unverified                                                                                          |
| Compatible migration/redeploy, active Match pins and retained job-handler review                                         | Unrecorded / unverified                                                                                          |
| Actual HTTPS/WSS health, browser headers/origins, Telegram SDK/mobile WebView and authorized product smoke               | Unrecorded / unverified                                                                                          |
| Supervisor/ingress drain with accepted-work settlement, retry/reconnect and durable reconciliation                       | Unrecorded / unverified                                                                                          |
| Actual candidate-to-previous staging rollback preserving schema/history/receipts                                         | Unrecorded / unverified                                                                                          |
| Selected backup/PITR isolated restore, measured recovery point/time against approved RPO/RTO and reconciled durable data | Excluded by ADR-050 for personal disposable staging — not performed, not passed; production gate retained        |
| Approved SLO definitions/signals, monitoring freshness/aggregation and notification drill                                | Manual personal monitoring/responder supplied; coverage unverified; normal production alert/SLO evidence pending |

Local 18B1/18B2 implementation and rehearsal evidence remains recorded in the
plan; it cannot fill these staging rows. MVP 17C completion satisfies the
sequencing condition, so 18B3 was assessed immediately. Unapproved operating
choices and the explicit staging deferral still block execution. Phase 19 remains
the separate final-readiness review; neither phase supplies launch approval.

**Current outcome (2026-10-08):** worksheet reconciled with supplied owner decisions
and next-phase prerequisites assessed. Phase 17C is Completed for MVP with mandatory-gate evidence and explicit
performance exceptions. Original production capacity/SLO targets remain future
optimization/staging validation targets; they were not declared met. Temporary
host/region/origins/Bot/DNS are confirmed and local write/remediation is authorized.
Sole roles, disposable synthetic data, manual monitoring and the scoped omission
of backup/PITR/WAL archives/offsite storage are confirmed under ADR-050. Recovery
evidence is excluded/unperformed, not passed. Concrete private topology/access/TLS/
role-file/runtime inputs, applicable 7C and actual signal coverage remain missing.
Production recovery/final SLO policy remains separate. Actual 18B3 staging
acceptance is Blocked; no remote provisioning/deploy/migration/TLS/Telegram action
has begun. Phase 19 readiness remains hold, not production release approval.
