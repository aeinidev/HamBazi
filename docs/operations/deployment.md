# Portable deployment preparation

[ADR-043](../adr/043-portable-deployment-preparation.md) covers Phase 18B2.
This prepares application assets and local evidence. It does not approve a
provider, region, domain, access model, backup/PITR, recovery objective, retention
or SLO, and it does not activate staging. OD-002/006/007 remain open.

The owner-confirmed temporary ParsPack Germany host and exact staging origins
are recorded in [ADR-049](../adr/049-temporary-parspack-staging-preparation.md).
Local remediation/preparation is authorized. [ADR-051](../adr/051-private-manual-staging-preparation.md)
records the later bounded VPS runner/network/private-file/image-transfer and
manual-observation preparation scope; it does not authorize activation or migrations.

[ADR-050](../adr/050-disposable-personal-staging-exception.md) records the owner's
sole-operator/tester/secrets/responder roles, disposable synthetic data, manual
monitoring and explicit omission of backups/PITR/WAL archiving/offsite storage.
For this personal target, recovery gates are excluded by that temporary exception,
not passed. Production recovery requirements and all other release gates remain.
The worksheet now distinguishes these supplied decisions from actual missing
`prepare.mjs` values and private references. No Mini App short name is required
by the portable input schema or Bot HTTPS Web-URL configuration.

## Inputs and validation

Read the actual manifests/workspace/task graph; install with the declared frozen
lockfile command. Preparation imports the config package's compiled public
surface and observation allowlists, so run their declared builds when output is absent:

```sh
pnpm --filter @hambazi/config build
pnpm --filter @hambazi/shared build
pnpm --filter @hambazi/observability build
node infra/release/prepare.mjs /absolute/private/inputs.json /absolute/new/private/prepared
```

Use `infra/docker/release/inputs.example.json` as the base input schema. Its null
values deliberately fail validation. Supply references only after the relevant
operator decisions are approved; no values in test fixtures constitute decisions.
Use new mode-0700 output and mode-0600 input/role/inventory/scan files outside the
checkout, with no symlink path components. Preparation refuses existing output.
It reads the actual adjacent `images.json.scan.json`, requires unchanged scanner
thresholds/fresh advisory data and binds all four ordered digest/source/policy
identities. Dirty candidates are reviewable locally; they cannot satisfy clean
release provenance. Public policy remains part of the image identity.

The four raw role files use literal single-line `KEY=value`, including literal JSON
for signing-key sets. There is no shell evaluation, dotenv expansion, quoted value
syntax, shared role file or inherited `.env`. Unknown/cross-role fields, Node TLS
or startup overrides, migration credentials, deferred gameplay/export settings,
duplicate keys and non-production profiles are rejected. The only optional Node
trust input is the matched fixed-path data-CA reference described below. Use the required inputs
from these existing owners; numeric bounds are validation, not approved policy:

| Role   | Configuration owners and explicit prerequisites                                                                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API    | `runtime`, `auth-runtime`, `profile`, `catalog`, `transport-admission`, `bot-internal`, `bot-service`, `operations`; API-only DB/Redis identities, approved HTTPS CORS origins/session keys/quota policy/private Bot listener and peer |
| Bot    | `bot-runtime`, `operations`; scoped service key matching API's verifier, private API HTTPS address/trust, Bot HTTPS listener, synthetic or separately approved Bot identity/Web URL; no database/Redis/session signing authority       |
| Worker | `runtime`, `onboarding-worker`, `operations`; different DB/Redis identity and password, explicit cleanup/queue/pool policy; no API/Bot/migrator authority                                                                              |
| Web    | Production profile, explicit static/health ports and `0.0.0.0` container bind; policy is immutable in the image, no credential input                                                                                                   |

All role ports must be distinct within the role and unprivileged. Backend health
ports are explicit and remain loopback-only. Stop grace is explicit and must
exceed existing drain + reporting + hard-exit budgets; it is not a final SLO.
Gameplay/Room/statistics/outbox/external-report activation is excluded from this preparation
allowlist. Their reviewed composition and policies remain 7C/staging work.

For the owner-authorized private manual profile, add
`operatorMonitoring: "private-manual-v1"` to the input object and set the three
existing API/Bot/Worker metrics flags to `true`. Preparation requires those flags
for the profile; without it, enabled metrics still fail. The rendered definition
uses Docker local rotation (`10m`, three files, compression) and no published
health/metric ports or external sink. See the [private operator procedure](runbooks/private-operator.md).
Its read-only CLI never starts an inactive application and does not persist scrapes.
Manual monitoring coverage on the real target remains activation evidence.

For the reviewed private data issuer, add `tlsFiles.dataCa` and the exact
`NODE_EXTRA_CA_CERTS=/run/hambazi/tls/data-ca.pem` to both API/Worker files.
Preparation requires all three references together, currently valid CA constraints
and PostgreSQL `sslmode=verify-full`. It mounts that certificate read-only into
those two roles; Bot trust remains separate. Node's normal hostname/certificate
verification remains enabled. Static CA validation cannot prove endpoint TLS,
private DNS, role grants or actual denial tests; those require later authorized services.

Supply existing separately named private and controlled Bot-egress bridge networks.
Preparation checks the private network is internal, addresses fit its actual IPv4
subnet, and egress is a different non-internal network. It neither creates networks
nor connects to data services. API/Worker data URLs must retain production TLS and
separate identities; private DNS resolution/firewalls and actual grants are staging
acceptance. DB usernames retain the existing `hambazi_api`/`hambazi_worker` grants,
Redis uses the existing `api`/`worker` ACL identities, and decoded passwords must
differ. Supplied public numeric data addresses and unsupported IPv6 literals are
rejected by this IPv4 preparation path. The application
definition provisions no PostgreSQL/Redis or host ports. A later approved ingress
must reach only intended public/API/Bot listeners, preserve WSS/CORS/CSP/HSTS and
exclude privileged Bot/health ports. Docker networks alone do not prove that policy.

Supply separate API/Bot TLS keys/certificates and the API issuer/trust certificate.
The verifier checks key/cert agreement, private-IP SANs, validity and API signature
against that trust certificate. Individual read-only mounts use fixed `/run/hambazi/tls`
paths; no directory containing role credentials is mounted. Host keys need private
permissions and runtime UID 1000 readability. Actual TLS chain/trust, secure secret
delivery/rotation and provider access must still be rehearsed in staging.

The CLI writes `compose.yaml` and `preparation.json`, executes real `docker compose
... config --quiet` with `/dev/null` as its env file, and emits a scalar success
record. It never starts services. Do not print resolved Compose config, Docker
inspect environment, raw startup diagnostics or private input files. Preparation
records hashes and checkout migration/contract/grant fingerprints, with explicit
`compatibilityApproved`, `activePinsReviewed` and `retainedJobsReviewed` false.
Preparation now records 17C MVP completion under ADR-048 separately from pending
production capacity/SLO/fault/soak acceptance. Production release and 7C/18B3/19
gates remain unapproved. These are review inputs, not proof those checkout files belong to an arbitrary
image. Source matching and release-pair review are required before activation.
Validation is point-in-time. External role/TLS references are private operator
files, not immutable secret storage; rotate/version them through the approved
mechanism and repeat preparation after a change. Do not reuse stale validation.

## Release and drain sequence

1. Record clean source, exact candidate and rollback digests/scans, approved public
   policy/config revision, migration/grant fingerprints and evidence references in
   the restricted release ledger. Compare both source trees and compiled artifacts.
   Review every active engine/state/ruleset pin, API/event version and queued job/
   consumer version against both artifacts. Do not approve by tag or file hash alone.
2. Follow [Migrations](runbooks/migrations.md). Establish approved recovery evidence
   first, or record ADR-050's narrow disposable-target exception without claiming
   recovery passed. Apply only compatible expansion/grants through the separate migrator;
   pause on failure, drift, missing grants or incompatible previous code. Preserve
   old consumers/state adapters and at least one release overlap. No contract or
   destructive operation runs alongside application deployment.
3. Prepare/validate the definition. Staging must additionally verify private DNS,
   data TLS/grants, network/firewall/egress, runtime key access, approved ingress,
   origin/header/SDK behavior and protected evidence provenance. An origin-less
   packaging Web image denies API connections/framing; rebuild with approved public
   policy before usable staging. No staging origin is inferred here.
4. Under the approved supervisor, stop new ingress/admission/claims and signal
   SIGTERM. Readiness becomes NOT_READY before accepted handlers/jobs settle and
   resources close. Observe settlement, stopped lifecycle and exit status; timeout,
   force-kill or exit 137 is failed drain. Preserve idempotent recovery evidence.
   Stop Bot before its API dependency; keep database/Redis available through drain.
5. Replace the exact application digests/config, preserving data services/volumes,
   queue namespace, original IDs and prior compatibility handlers. Reopen consumers
   and API/Bot/Web only after private readiness and approved external smoke/retry/
   reconnect/outbox reconciliation. Provider-specific traffic/supervisor commands
   remain 18B3; these assets do not automate live replacement.
6. If smoke fails, keep ingress closed and follow [Rollback](runbooks/rollback.md).
   Retain additive schema and queue/history/receipts. Revalidate prior digests and
   original config/keys; never rewrite active state or drop unfamiliar jobs. Record
   rollback time/identity and acceptance before returning traffic.

## Owned local rehearsals

The implemented entry points below accept candidate inventories, never existing
database credentials/volumes, staging URLs or project names. Provision the existing
verified SDK fixture for Chromium. Use two independently built/scanned compatible
inventories; the runner rejects identical image pairs and mismatched Web policy.
Fresh scans must still pass. Do not overwrite their exclusive scan files.

```sh
node infra/release/test-definition-local.mjs /absolute/private/current/images.json
TELEGRAM_SDK_FIXTURE_PATH=/absolute/private/verified-tools/telegram-web-app.js node infra/release/test-local.mjs /absolute/private/current/images.json --rollback-to /absolute/private/previous/images.json
```

The definition drill supplies synthetic production configuration, temporary TLS
and task-owned private/egress networks, validates the generated asset, then starts
**only production Web** through that exact Compose definition. It checks actual
hardening, no published ports, internal networking, CSP/cache/health, SIGTERM and
same-image redeployment. Synthetic backend endpoints deliberately do not exist.
This is not production backend networking/TLS acceptance.

The image drill uses the existing owned PostgreSQL/Redis fixture and backend `test`
profile (Web remains production). After candidate smoke, it replaces candidate
with previous, previous with candidate, and candidate with previous while retaining
the same DB/Redis and role/session/service configuration. At each transition an
actual accepted HTTP request waits on an owned database lock: SIGTERM makes health
NOT_READY while the process remains alive, then releasing the lock allows its
successful response and exit zero. Each replacement repeats the declared forward
migration/grants command, reaches private readiness, preserves original account
intent and existing session, and rechecks Web policy. Success is printed only after
cleanup. No down migration or restore occurs.

The unchanged declared `pnpm test:auth-http:local` harness separately verifies
populated old-schema expansion, all migrations/redeploy/grants/restart, atomic Match
idempotency/pins/private views, v1 job retry and accepted-worker drain with distinct
roles. Supply its documented installed PostgreSQL binary/share/library paths. These
local suites support preparation; they are not staging or arbitrary-version rollback
proof. Backup/PITR restore against approved objectives remains deferred.

## Required staging acceptance

For the actual temporary personal VPS, use the bound
[owner-only staging execution plan](staging-execution-plan.md) and
[exact binding](../../infra/docker/staging/execution-current.json). The approved
owner/disposable-data/manual-monitoring profile is deployed from clean `48ff852`
in exclusive `prepared-20261009-native-accepted-02`. Owner enrollment is resolved,
not a startup blocker. Private data/TLS/grants, compatible migrations, firewall/
SSH, public TLS, Auth/full personal bot game, private observability and exact
current/previous application rollback pass. The owner confirms real iPhone native
acceptance on previous `a8b97f8`; the UI/deadline successor has separate current
browser/VPS evidence. No new migration or Telegram setting is changed.

The [18B3 operating-decision worksheet](staging-operating-decisions.md) preserves
approved decisions and distinguishes passed evidence from remaining full rotation,
protected hosted CI/publication/E2E, production-like validation and broader recovery.
ADR-050 backup/PITR recovery is excluded/unperformed, never passed. Ordinary Admin/
Room/Main invitations/Telegram Web and later phases remain gated. Normal fresh
scans are required before expiry (Oct 9 22:35:21 Tehran); full 18B3 is incomplete.

- OD-002 provider/region and explicit domains/access/provisioning authorization.
- OD-006 backup/PITR, RPO/RTO, retention, secure archive access and actual recovery
  rehearsal for the normal release scope. ADR-050 excludes these for the personal
  disposable staging only, with recovery unperformed. Manual monitoring ownership
  is confirmed; actual signal availability and final production OD-007 remain separate.
- Clean immutable release/registry provenance, fresh scans and hosted protected CI;
  actual current/previous active-pin/queue compatibility and migration/grant review.
- Approved private DB/Redis/TLS credentials, Bot trust/peer policy, ingress/WSS/
  browser headers, Telegram/mobile WebView smoke and measured staging rollback.
- Applicable 7C live composition/security/admin activation before enabling gameplay.
- 17C is **Completed for MVP with performance exceptions** under
  [ADR-048](../adr/048-mvp-capacity-acceptance.md). Production-like 2x approved peak,
  reconnect storm, at least two-hour soak and complete durable reconciliation
  remain deferred validation; no production performance acceptance is claimed.

Parent 18B cannot complete on these local results. No provider-specific staging
provisioning/activation is authorized by a successful preparation file.
