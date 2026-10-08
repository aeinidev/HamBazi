# Temporary owner-only staging execution plan

**Updated:** 2026-10-09 Tehran. **Status:** Owner-only Web/Auth/personal Coup are open,
real iPhone native acceptance is recorded as user-reported, and the applicable
bounded rollback/availability/renewal checks pass. **Phase:** 18B3 remains In Progress.
ADR-050/052/053/054/055 and the owner's explicit deployment scope remain binding.
No Telegram setting, production, paid resource, destructive operation or later phase.

## Current configuration and accepted native lineage

Clean app source: `48ff852ba6b732ae51d239f6cf875186d64d588a`.
Build: `da3c1d62e59ce7df219ce92d02e9cb320dc19c31c2a507184216abf8f7321b0b`.
Preparation: `/opt/hambazi-staging/private/prepared-20261009-native-accepted-02`.
Compose SHA-256: `b799cdbcd6336de8767df6a87d87f0343d2bf45ac5af00950b46f4a7fc7c5921`.
The [current binding](../../infra/docker/staging/execution-current.json) records
all four exact images, inventory/scan/preparation/runner hashes, current patched
`d6eb25b` ingress/ACME and private evidence references. Previous candidates and
failed attempts are retained. Four apps are READY; no active synthetic game remains.

The owner's real iPhone confirmation applies to `a8b97f8` and
`prepared-20261008-native-02`, as **user-reported native acceptance**. No direct
agent observation, client version or separate full-game count is invented.
The original reported failure remains historical; its exact cause is unproven.
Temporary native-01 display is removed per ADR-055. The successor keeps SDK bytes,
SRI, storage guard, query/fragment launch preservation and signature/freshness/
constant-time exact owner admission unchanged. Its own six actual-network
Chromium/WebKit launch/Auth/privacy cases pass separately; no new native owner
retest is claimed or required merely for removing the display.

## Applicable staging checks completed

- Real paused Redis revealed a stalled already-written transport admission reply:
  node-redis removes its AbortSignal listener after write. `48ff852` enforces the
  existing one-second reply deadline through the public observability primitive.
  Late replies cannot grant a timed-out request; quotas and fail-closed sensitive
  issuance/writes/WSS remain. Five meaningful regression cases, 181 targeted API
  tests, typecheck/lint/boundary/contract checks and 275 isolated real HTTP/PG/Redis
  integration executions pass. No new dependency, migration or policy.
- Four fresh exact application scans pass, and unchanged exact PG/Redis/ingress/ACME
  evidence remains normally fresh. High/Critical/Unknown are zero; each app and
  data image retains one allowed Moderate zlib finding. No suppression, scan skip
  or historical 48-hour extension. Private archive hash and both Docker identities,
  all four `/app` byte/mode/path/symlink fingerprints and new exclusive prepare pass.
  OS-layer fingerprints are not claimed.
- Current → previous native-accepted → current application rollback passes **71**
  controls with unchanged live data, roles, TLS, networks and all 14 migrations/12
  contracts/grant fingerprints. Existing session, active Match pins, monotonic
  snapshot, original command receipt, exactly one processed command and contiguous
  events survive. Idle stops are graceful within approved 45 seconds; ordered
  API → Worker → Bot → Web startup passes. No migration/reset/purge is executed.
  Compatibility is only `48ff852 ↔ a8b97f8` with current patched components and
  healthy data services; previous a8 retains the Redis-stall defect. Keep maintenance,
  check Redis/readiness/Auth and preserve the current patched ingress on rollback.
  Historical nine HTTP/15 accepted WSS drain checks remain separately bound to a8;
  unchanged drain handlers/config and actual pair compatibility justify reuse.
- Real PG/Redis pause drills pass **31** controls with automatic 30-second unpause
  guards and still-paused assertions. PG loss closes readiness while liveness remains;
  Redis loss produces API DEGRADED/Worker NOT_READY and private metrics reflect it.
  Existing sessions/logout remain available, fresh issuance fails closed with zero
  durable effects, revocation survives recovery and all four return READY. This is
  service availability evidence, never backup restore/PITR/provider failover proof.
- Current Auth passes **35** controls, including signed non-owner/forged/expired
  denial without durable effects, CORS/private-route isolation and policy revocation.
  Complete personal game passes **37** controls, **15** owner commands/**27** turns,
  own-PlayerView isolation, normal command validation, no fake Telegram User,
  idempotency/reconnect and cleanup. Six actual public-network Chromium/WebKit
  fragment/query/non-owner cases pass exact preserved launch in Auth, owner 200,
  non-owner 401, URL cleanup/logout/no credential storage/no sensitive console.
  Eight public route checks, SDK SRI/trusted TLS and external data-port denial pass.
  One earlier probe incorrectly required SDK.initData for guarded query fallback;
  corrected probe passes without product change and its failure is preserved.
- Current exact ACME dry-run and normal no-due renewal pass. Two transient issuer
  `rateLimited / service busy / Retry-After 3` failures are retained; a delayed third
  dry-run succeeds. Old/new ACME filesystems match. Public certificate remains valid
  until **2027-01-06T06:11:04Z**. Actual future due renewal is unperformed, not passed.
- Private SSH/operator health, safe logs and metrics pass; unknown log lines omitted
  are zero. Existing compressed local rotation is 10m × three files. Public private
  health/metrics/Admin/Room/catalog/webhook routes remain 404; PG/Redis have no public
  ports. TLS/least-privilege role separation/firewall/SSH are unchanged and retained.

Normal advisory evidence expires **2026-10-09 22:35:21 Tehran**. The installed timer
applies canonical maintenance and a 45-second app stop at that expiry. Installed
state passes; future execution is unperformed. Refresh scans before expiry, and
never keep traffic open by extending the old exception without an explicit decision.

## Exact remaining items and consequences

| Item                                                                  | Disposition and consequence                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hosted protected CI/provenance/publication and protected staging E2E  | Unperformed; actual VPS/browser tests do not prove hosted promotion protection. No production release readiness claimed.                                                                                                                                           |
| Allowed Moderate zlib findings                                        | Unremediated in four app and two data images; allowed by the preserved thresholds, not suppressed or claimed fixed.                                                                                                                                                |
| Full authority secret rotation/recovery drill                         | Unperformed; current separate credentials/TLS/trust pass. Telegram settings remain separately scoped.                                                                                                                                                              |
| Production-like load/reconnect storm/two-hour soak/SLO validation     | Deferred/unproven; approved targets/thresholds are unchanged. Personal success is not capacity acceptance.                                                                                                                                                         |
| Redis queue storage loss/bulk reconciliation/provider failover        | Unperformed; bounded pauses cover availability, not deleted queues or lost storage.                                                                                                                                                                                |
| Ordinary Admin and full 7C activation                                 | Disabled pending separate auth/RBAC/MFA/network/audit and retained activation controls. Personal admission is not Admin authorization.                                                                                                                             |
| Room/Main invitations and ordinary multiplayer/chat/stats/matchmaking | Disabled; Main personal launch works without an invented short_name, but the link builder and response schema require appName; a reviewed Main link variant and native invitation launch/join proof are missing. Personal bot games produce no competitive result. |
| Personal outbox fanout                                                | Wake-ups retained pending; acknowledged two-second snapshots provide the personal view, not accepted event fanout.                                                                                                                                                 |
| Telegram Web                                                          | Current frame-ancestors none blocks iframe embedding; native-only policy unchanged.                                                                                                                                                                                |
| WebKit permission-policy introspection                                | One existing case skipped because document.featurePolicy is unavailable; Chromium permission-denial assertions pass.                                                                                                                                               |
| Future due renewal/advisory expiry and automatic host recovery        | Future triggers are unperformed; restart=no requires maintenance-first scan/identity/TLS checks and manual ordered restart after reboot. Owner-confirmed manual reboots are not automatic-recovery proof.                                                          |
| Backup/PITR/WAL/restore/RPO/RTO                                       | ADR-050 accepted exception: excluded, unperformed, never passed; disposable data has no recovery promise.                                                                                                                                                          |

No additional owner policy or private reference is missing for the implemented
personal flow. No current deployment blocker remains. The next operating action
is refreshing exact scan evidence before the normal expiry; full-phase evidence
above is retained for review, without reopening settled decisions or starting Phase 19.

The following sections are historical and do not supersede this final binding.

## Historical Web/Auth checkpoint (superseded)

The immutable historical preparation at
`/opt/hambazi-staging/private/prepared-20261008-02` is preserved. Its older images
are not the current owner-only candidate. The exact current release/configuration
binding is [execution-current.json](../../infra/docker/staging/execution-current.json).
Application source is clean `6fa2bdc1f851d2663f82dc0f915ec1f1b3be5e81`, build
`695b5353018e358a11b24613c8e591c0e7747e31e85c2ef0c6282c241ed28771`;
all four exact target digests/source/build/UID identities passed. Ingress and ACME
are separately bound clean `fcfac0a` artifacts. The reviewed runner archive is
`b9448d2fd81c0394be679d980f1913c7197aee46`, SHA-256
`0eed5761cdecc239cc9dd08f8a268ddb2cefa4f285b053b838c12b1ea9149022`, at
`/opt/hambazi-staging/private/runner-b9448d2`; private `runner-current` points there.
The archive has no Git metadata; do not interpret that as repository drift.

| Actual check    | Evidence and boundary                                                                                                                                                                                                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DNS             | 56 local/VPS parent, authoritative SOA/A/AAAA/CAA and resolver checks; all 12 Cloudflare/Google A results match `185.110.191.104`. Parent NS is tornado/rainbow. No DNS mutation. No AAAA or restrictive CAA found.                                                                                                                                      |
| Security        | Retained scans passed unchanged High/Critical/Unknown gates at their original execution: one Moderate zlib per app/data image and zero findings in patched Nginx/Certbot. They expired **2026-10-08 11:08:55 Tehran**. Fresh empty mirror/GHCR downloads still return the expired advisory update; current activation is blocked. Gitleaks remains zero. |
| Private data    | PG `.20`, Redis `.21`; no published ports. Actual TLS 1.3 verifies chains/SANs; wrong CA/SAN/password/plaintext denied. API/Worker separate credentials, DDL/foreign DB grants and out-of-namespace/dangerous Redis commands denied; health only PING and default Redis user disabled.                                                                   |
| Migration       | 13 reviewed migration and 11 contract fingerprints plus grants match; separate migrator deploy/grants and repeat deploy pass on the empty new PG18 cluster. Lock/statement limits 5s/60s. No active durable pins/retained jobs existed. No reset/down migration.                                                                                         |
| Firewall        | Owned IPv4/IPv6 chains, Docker forwarding and actual bridge peer controls applied; independent second key-authenticated SSH passed before cancelling the owned rollback timer. Boot unit retains filtering. External private ports and Web-peer data access denied.                                                                                      |
| Public TLS      | One Let's Encrypt HTTP-01 SAN certificate for all three approved hosts, valid to `2027-01-06T06:11:04Z`. Both local/VPS trust/hostname/TLS/503 checks pass. Hold-only maintenance command and owner-route parser pass.                                                                                                                                   |
| Renewal         | Actual fresh-scan dry-run and normal no-due renewal pass. Daily 03:00 UTC plus ≤15-minute systemd scheduling jitter; fixed safe journal outcomes, no raw Docker logs, ≤7 safe scan records and bounded private ACME logs. Scan failure/staleness blocks ACME. Certbot's own random sleep is replaced by the bounded timer jitter.                        |
| Web             | 64 unit tests, typecheck/build, 26 browser/privacy tests and exact final production-artifact account/logout/no-realtime/no-invite browser smoke pass. Synthetic browser transport does not count as native Telegram or actual owner admission acceptance.                                                                                                |
| New preparation | Actual owner enrollment, four real mode-0600 role files, config bounds, private TLS references and exact candidate identities pass. Real `prepare.mjs` rejects expired scan evidence; no new prepared output or application is started.                                                                                                                  |

Private execution/evidence is under
`/opt/hambazi-staging/private/execution-20261008`, mirrored safely in the laptop's
`~/.cache/hambazi-18b3-activation-20261008`. Do not publish raw role/credential,
owner ID, launch, SQL diagnostic or gameplay contents. Required private logs,
loopback health/metrics and compressed 10m × 3 app retention are configured;
actual app readiness/monitoring/fault/drain acceptance still awaits startup.
Recovery is **excluded/unperformed under ADR-050, never passed**. No compatible
scanned previous owner-scoped release pair exists; hold containment is not version
rollback acceptance. Full 7C/game/Room/Main invitation and native-client gates
remain explicitly deferred.

**Owner enrollment follow-up, 2026-10-08:** the original private nonce message
matched exactly one human sender in the same private chat. Read-only `getUpdates`
used no `offset`; no backlog was acknowledged or raw response persisted. The
exclusive regular policy is now at
`/opt/hambazi-staging/private/execution-20261008/owner-admission.json`, 0600,
UID/GID 1000. No personal ID, token, raw launch or policy-content hash enters this
binding or telemetry. Four role files, config bounds, private leaf/key/IP SANs,
exact target image source/build/UID identities and migration/contract fingerprints
were revalidated. The old preparation stays unchanged.

At 07:56 UTC, 56 local/VPS parent, authority and public checks pass, including all
12 Cloudflare/Google A answers. At 07:57 UTC, both data services still verify TLS
1.3 with no published ports; all 13 reviewed migrations and three separate
non-superuser roles remain present. The three trusted public TLS endpoints still
return 503. Zero application containers run.

**Actual blocker:** ordinary Trivy download retained the recently downloaded
cache despite expiry; [Trivy 0.74.0's update logic](https://github.com/aquasecurity/trivy/blob/v0.74.0/pkg/db/db.go)
has a one-hour download guard. Preserved that cache, then separately downloaded
into empty private caches from the default mirror and direct official GHCR. Both
successful downloads still contain `UpdatedAt=2026-10-07T07:38:55.515026687Z`.
The unchanged 24-hour gate therefore rejects them. Fresh download timestamps do
not extend the advisory update age. The official
[06:10 UTC DB workflow](https://github.com/aquasecurity/trivy-db/actions/runs/37736159029)
and its preceding 00:15 UTC run failed; the latest failed step is `Login to Docker
Hub`, with an expired upstream organization access token. This is upstream
publication failure, not a staging credential, DNS or download timeout. No
metadata rewrite, suppression, skip or policy exception was used. The attempted
new application scan did not reach image scanning and does not count as fresh
successful evidence. A direct call to the real `prepare` implementation also
rejects the retained expired report before creating any output.

**Exact next executable action:** obtain an actually fresh official advisory
update, scan the unchanged exact four app images plus PostgreSQL/Redis and
Nginx/Certbot on the verified target daemon, and retain new successful evidence in
an exclusive private release directory. Preserve all old/failed reports; update
`execution-20261008/owner-inputs.json` only to bind successful new evidence. Then,
from `runner-current`, execute
`node infra/release/prepare.mjs /opt/hambazi-staging/private/execution-20261008/owner-inputs.json /opt/hambazi-staging/private/prepared-20261008-owner-01`.
No additional owner enrollment or policy decision is missing for this bounded
Web/Auth preparation. The upstream freshness blocker must clear first.

After successful preparation, continue API → Worker → Bot → Web with actual
readiness, real private privileged TLS and manual observer checks. Keep public
503 while testing the limited owner routes through an unpublished exact ingress
composition. Require owner success, signed non-owner refusal with zero durable
effects, forged/expired/duplicate authentication, current-session revocation,
proxy spoofing, CORS/CSP/rates/private-route isolation and a real graceful drain/
containment observation before opening only the reviewed Web/Auth routes.
Bot's public routes remain withheld until separately authorized Telegram setting
work. Native Telegram owner flow remains an explicit manual acceptance item.

The sections below retain the reviewed historical baseline and ordered gate
requirements. Their older Caddy candidate and preparation-only wording do not
supersede this current checkpoint or ADR-052.

## Historical binding and read-only observations

Target: existing ParsPack Germany VPS `185.110.191.104`, linux/amd64. Require Docker
daemon ID `342f251a-9e56-4353-af12-a32429b7a2e7` and local Unix socket context;
do not accidentally execute against the laptop daemon. Runner is
`/opt/hambazi-staging/private/runner-5ba416b`, source
`5ba416bb1cff0a91ace9006596dc137654e06261`, Node 24.20.0 / pnpm 12.4.1.

| Bound artifact                          | SHA-256                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| Prepared `compose.yaml`                 | `fa51354d1c1e78a6fe919bd2d2c4840b4b7d9578e9ac4f242435c7c0712e4780` |
| Prepared `preparation.json`             | `87122983ef810f343247314d3a3d9f54a2af3fbfbb0ead9d26d9afdb9e69761b` |
| Private release `images.json`           | `6ce70141f8e4ae947cb195afb41046a29d6d8aee098d91ea54f6fe4a342a6be5` |
| Private release `images.json.scan.json` | `c65d96cc0443c8900a6f151a4703a34ce9b3c6933cb1cb9919230b16735c888b` |

Application source is `65ff180168ddbdbead1d9921ce67fde5f768dd79`; build input is
`1322facec551f16f84b67bb6c031e06fdba79fdd890dd89630c9f9fb55cdf73c`.
All four references have the literal prefix
`hambazi-candidate/<role>:65ff180168ddbdbead1d9921ce67fde5f768dd79-1322facec551f16f@sha256:`
and the following digest suffix. Never select by tag alone.

| Role   | Digest suffix                                                      |
| ------ | ------------------------------------------------------------------ |
| API    | `461332510191c0e72f52fa611cc78a0cce0b8eb1b35e98701083eb38d41fa934` |
| Bot    | `8c5d7b72eba66a54da123060f48b064622889555dd1555ea3257304301a1c2df` |
| Worker | `9bc102a10877956b37e94f7839b36d6693daf69a86303d2a2a2701636d38360a` |
| Web    | `f12dffa01ac33da71c01ea53016b4e692b0cf5a2112ef8f2786900459517e374` |

At `2026-10-07T22:48:00Z`, read-only target checks reconfirmed those hashes,
digests, source/build labels, linux/amd64 and UID `1000:1000`; zero containers run.
The existing validator accepted the unchanged four-image scan: no
High/Critical/Unknown; one Moderate zlib finding per image. Advisory update is
`2026-10-07T07:38:55.515Z`; the earliest 24-hour expiry is
**2026-10-08 11:08:55 Asia/Tehran**. This is freshness revalidation, not rescanning.
Revalidate immediately before every execution/replacement; after expiry retrieve
fresh advisories and rescan exact application and data/ingress artifacts. Download
time alone cannot renew evidence; no skip, suppression or severity change.

Private verification evidence is retained at
`~/.cache/hambazi-18b3-execution-plan-20261008/`, mode 0700 / files 0600.
Existing API/Bot and data leaves expire `2026-11-06T21:30:44Z` and
`2026-11-06T21:30:45Z` respectively. SANs are API `.10`, Bot `.11`,
`postgres-staging`, `redis-staging`; actual endpoint handshakes remain unperformed.
UFW is inactive; Docker currently has an empty DOCKER-USER chain. SSH listens on
TCP 22 IPv4/IPv6. Existing private/egress networks are empty. These observations
are not firewall or isolation acceptance.

## Identity and owner-only admission

`getMe` proves the Bot's identity, not the owner's Telegram user ID. Never use the
Bot ID, a fixture, username, phone number, client-supplied ID or first visitor as
the owner. The actual owner-ID file does not yet exist.

The proposed collection procedure is: generate a one-time random nonce privately;
the owner sends it manually to `@Hambazidev_bot` in a private chat. First inspect
`getWebhookInfo` privately. Only if there is no webhook, read `getUpdates` without
advancing `offset`, without deleting pending updates and without persisting raw
responses. Select only an original private message matching the nonce, where
`from.is_bot=false` and `from.id=chat.id`. Retain just the positive safe-integer
decimal user ID; discard message/nonce/update content from memory. Do not
acknowledge unrelated backlog. With an existing webhook or ambiguous result, use
an owner-controlled offline personal-data reference and reconfirm against fresh,
server-verified Mini App `initData`; do not change the webhook to collect identity.
No secret or numeric personal ID needs to be sent in chat with the coding agent.

Store the confirmed decimal string in
`/opt/hambazi-staging/private/owner-admission.json`, exclusive regular file mode
0600 in the mode-0700 private root. Proposed strict schema: version 1, purpose
`temporary-owner-only`, `telegramUserIds` containing exactly that one ID. Mount
only the reviewed admission reference read-only into roles needing it; keep the
ID out of Git, browser bundles, telemetry and general deployment metadata.

**Current images do not enforce this policy.** Required implementation belongs to
Auth's public admission boundary, after signature/freshness verification and
before any account/session/onboarding receipt write. Deny missing/malformed policy
and all other identities. Recheck current admission on session authentication,
HTTP writes and Socket handshake/events/reconnect; removed admission must revoke
existing access. Bot must reject an unapproved original sender before backend
effects or replies; the privileged backend must independently enforce admission.
Player, Bot service and Admin authorities remain separate. CORS, ingress IPs and
webhook secrets cannot replace this identity check. Prove non-owner denial with
zero durable effects, retries, old sessions, policy loss/revocation and safe logs.
Extend the reviewed config/prepare schema instead of adding an unsupported flag.
Build/scans/tests and a **new private preparation** are required; the present
binding cannot be relabeled as an owner-gated candidate.

## Activation prerequisites and client coverage

Private data/TLS validation can precede game activation after its own bounded
authorization. Public product traffic additionally requires the implemented
owner gate and evidence above. A limited account/profile/read-only catalog smoke
must explicitly retain disabled gameplay; it is not full MVP staging acceptance.

Before any playable Room/Matchmaking/Coup activation, complete the separately scoped
7C gate in [ADR-039](../adr/039-administrative-security-design.md) and
[Admin design](../security/admin-security-design.md):

- Distinct private TLS Admin listener, approved issuer/audience/keys and operator
  subject; deny player/Bot credentials and unsolicited key-source URLs.
- Provider-verified phishing-resistant MFA and recent step-up, explicit per-action
  RBAC, private network/peer access, current revocation/authority checks on retries.
  Sole human ownership does not merge authentication domains or waive controls.
- Append-only durable admission audit before effects; audit outage produces zero
  effects. Owning ports atomically commit effects, stable actor-bound receipts and
  content-free outcome outbox; deduplicate/reconcile outcomes after crashes.
  Actual credentials must deny audit UPDATE/DELETE/TRUNCATE and foreign writes.
- Games revision/idempotency/readiness guards, maintenance denying new admission,
  explicit pinned active-Match behavior, and authorization/race/failure/grant/
  contract/drain/rollback validation. No direct SQL enablement or CLI bypass.

Provider/MFA claim mapping, Admin subject/capabilities and private access, session/
step-up bounds, approval semantics and audit retention/access require a concrete
7C owner review. They are not reopening the already supplied operator roster.
This plan neither implements nor starts another phase.

The prepared production API does not compose the implemented realtime/Matchmaking/
Coup path; prepared Worker configuration does not activate the corresponding
outbox/reconnect/statistics composition. The prepare allowlist also excludes Room
configuration. Review and wire those owning ports in a separately authorized
prerequisite change with versioned jobs, active pins and contract checks. Turning
on SQL flags cannot make this candidate playable.

Main Mini App presence is verified, its configured URL/mobile flow is not. The
approved Main URL is `https://staging.hambazi.top`. Ordinary Main launch needs no
short name. Room config/link builder/response schema currently require a named
app; add compatible explicit Main/named targets and test Main invitations
`https://t.me/Hambazidev_bot?startapp=room_<opaqueInviteCode>`. Do not invent
`short_name`. Until that implementation and native launch/join evidence exist,
Room invitation acceptance remains blocked.

Current immutable Web policy has `frameAncestors=[]`, hence
`frame-ancestors 'none'`: retain it for initial native Telegram WebView testing.
Telegram Web iframe embedding is denied. Native success cannot prove Telegram
Web compatibility. To support Web, inventory actual Telegram Web embedding
origins, approve an exact HTTPS ancestor list, retain exact Web/API CORS and
SDK-integrity/privacy rules, rebuild the Web policy/image, rerun positive/negative
iframe and privacy checks plus fresh scans, and prepare a new binding. No wildcard
or blanket removal of CSP is proposed.

One owner Telegram identity cannot represent two human seats in a capacity-2-to-6
Room acceptance test. Full multiplayer smoke needs a reviewed Bot-seating path or
an explicitly approved second owner-controlled test identity. Local synthetic
integration remains local evidence; forged staging Telegram auth is not a substitute.

## Proposed infrastructure assets and decisions

The [staging draft assets](../../infra/docker/staging/compose.proposed.yaml) are
separate from the immutable application Compose. All services require an explicit
profile, have restart disabled and are **not authorized** by that profile. Data
ports are unpublished. The default ingress draft returns 503; it never switches
to application routes automatically. No asset was applied to the VPS.

| Additional proposal          | Recommendation and consequence                                                                                                                                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data and edge addresses      | PG `.20`, Redis `.21` on the existing private subnet; ingress egress `10.89.19.3`. Keep approved ingress `.2` and app `.10`–`.13`. Recheck collision/route/daemon identity; no new paid resource.                                                                                            |
| Data resource bounds         | PG `max_connections=32`, `shared_buffers=128MB`; Redis `maxmemory=256mb`, `noeviction`, `maxclients=64`. API/Worker pools remain 5/3; API admission ceiling 32 is a separate setting. Bounds contain this small VPS; Redis exhaustion fails writes rather than silently evicting queue keys. |
| Data bootstrap and migration | Independent `hambazi_staging_bootstrap`, existing `hambazi_migrator`, Redis `health`; private bootstrap/migrator/health references below. New PG18 volume only; migration lock/statement bounds proposed 5s/60s, tested before use. No DDL authority in apps.                                |
| Public TLS and firewall      | Let's Encrypt ACME HTTP-01 on exact three hosts; automatic renewal, TCP 80/443 only, preserve SSH 22. No DNS credentials, AAAA change, paid service, HTTP/3, Caddy Admin listener or raw access logs.                                                                                        |
| Initial client coverage      | Retain current native-only framing; Telegram Web requires the separately reviewed exact ancestors/new image. This limits coverage, without weakening the frame policy.                                                                                                                       |

The concrete proposed ingress artifact is
`caddy:2.11.7-alpine@sha256:173b26306d711395accaeba8b67afcaad2a085ccb1e6bf26010bfe8c095a5229`.
Local pinned-scanner execution found Moderate zlib `CVE-2026-85091` and
**Unknown `GO-2026-5932` in `golang.org/x/crypto` v0.57.0, no fix reported**.
Unknown is blocking; the strict assessor also rejects the unsupported artifact
and advisory grammar. No accepted scan report exists for this image. Preserve raw private
evidence, investigate/remediate or review a safe replacement and rescan through
the same gate. Do not suppress/reclassify to approve it. Both proposed Caddyfiles
pass local `caddy adapt` parsing only; no runtime provisioning, public TLS or
network isolation is proved. Caddy is not eligible even for the hold service yet.

Data references are the existing scanned PG18 image
`hambazi-local/postgres:18.6-alpine3.24-v1@sha256:18f4eaef9fda255d3b10a16c62c72a92864b69a6b4eb4ded1145b349f06d514a`
and Redis
`redis:8.10.2-alpine3.23@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0`.
Check their actual target-daemon presence/provenance/fresh scans before private
transfer; preparation verified the four app images, not these target imports.

The non-secret [plan binding](../../infra/docker/staging/execution-plan.proposed.json)
records exact baseline identities and hashes of the proposed assets. Prepared
Compose binds private environment references, not their current contents. At
`2026-10-07T22:53:05Z`, the existing real-role parsers/bounds and all 76 non-secret
approved fields match, files remain regular mode 0600, and all four leaf signatures
verify against their supplied private issuers. Recheck these inputs before execution;
never record token hashes or environment contents as evidence. Chain/SAN/file
checks still do not prove a real TLS handshake.

## Ordered execution after the applicable authorization

Every step stops on a failed prerequisite; the operator records fixed outcomes,
times and hashes in a private execution ledger. No secret environments, raw
responses, SQL diagnostics or gameplay payloads are evidence artifacts.

1. **Preflight.** Recheck host key/SSH, daemon, image labels/digests, prepared hashes,
   runner versions and fresh scan gates including data/ingress and any replacement
   candidate. Review protected CI/provenance gaps explicitly. Recheck parent
   delegation, authoritative SOA/A and Cloudflare/Google from laptop and VPS:
   all three A records must be `185.110.191.104`; inspect AAAA/CAA and port ownership
   before ACME. Preserve DNS settings. Confirm only synthetic disposable data and
   the exact reviewed 13 migration/11 contract/permissions fingerprints; unknown
   existing clusters, drift or unreviewed active pins/jobs block execution.

2. **Private bootstrap references.** In a new mode-0700 execution directory under
   `/opt/hambazi-staging/private`, create exclusive mode-0600
   `postgres-bootstrap.env`, `redis-bootstrap.env`, `migrator.env` and health
   credential reference. Reuse the existing API/Worker data credentials privately;
   generate independent bootstrap/migrator/health values with CSPRNG. Proposed PG
   user/DB are `hambazi_staging_bootstrap` / `hambazi`; set the existing image's
   PG18 `PGDATA=/var/lib/postgresql/18/docker` and
   `POSTGRES_INITDB_ARGS=--locale-provider=builtin --locale=C.UTF-8 --encoding=UTF8`.
   Existing `10-roles.sh` creates
   the separate NOSUPERUSER/NOCREATEDB/NOCREATEROLE API/Worker/migrator roles;
   migration permissions are applied by the database-owned command.
   Verify actual data-image runtime UIDs before making release-scoped mode-0600
   readable private-key copies. Preserve original keys and bind only needed files;
   no whole secrets-directory mount. Prepare private writable ACME/config dirs for
   ingress UID 1000. These extra private references currently do not exist.

3. **Firewall before public port publishing.** Preserve current SSH configuration,
   host key and key authentication. Use a new owned INPUT chain: permit loopback,
   ESTABLISHED/RELATED, necessary ICMP, TCP 22 and approved 80/443; deny other new
   Internet input. Retain TCP 22 without guessing a changing owner source-IP
   allowlist. Check the provider firewall from its actual configuration. Current
   Docker uses iptables: use a separate owned DOCKER-USER chain for forwarded
   traffic; UFW alone does not protect Docker-published ports. After DNAT allow
   only ingress TCP target 8080/8443 with conntrack original destination
   `185.110.191.104:80/443`, plus established traffic; deny other new Internet
   forwarding. Verify actual eth0/bridge names instead of hardcoding stale IDs.
   No blanket Docker-chain flush/backend switch. Check bridge filtering before
   claiming private peer isolation; enforce/test the documented peer matrix with
   HBA, TLS and ACLs independently. Restrict egress to required DNS/HTTPS for Bot/
   ACME; app/data services have no egress network. Handle IPv6 explicitly with
   established/loopback/ICMPv6/SSH preservation and other new input denied until
   reviewed; no unreviewed IPv6 publishing. Before changes, schedule removal of
   only the owned hooks/chains after five minutes; keep the existing SSH session
   and prove a second key-authenticated login, then cancel that rollback. Do not
   restore a stale complete Docker rules snapshot.

   Intended private connections are ingress `.2` → API `.10:8080`, Web
   `.13:8080`, Bot `.11:9444`; Bot `.11` → API `.10:9443`; API `.10` / Worker
   `.12` → PG `.20:5432` and Redis `.21:6379`; host migrator gateway `.1` → PG.
   Container-loopback health/metrics has no bridge/public route. Shared bridge
   membership is not proof that other peer connections are impossible: observe
   and test denied paths, actual bridge filtering and service HBA/ACL/auth before
   declaring isolation. Root SSH/Docker operator access is a separate host trust
   boundary, not player or Admin authority.

4. **Private data startup/TLS.** Start only PG/Redis from the reviewed platform
   definition, no app or ingress. No published 5432/6379 and no Redis plaintext
   listener. Proposed HBA permits only TLS/SCRAM API `.10`, Worker `.12` and
   one-shot host migrator `.1`; bootstrap uses an unshared container Unix socket.
   Keep fsync/full-page writes on; archive off per ADR-050. Redis uses the existing
   hashed role ACL policy, default user off and health PING only; the new TLS
   helper is needed because the local Redis launcher ignores extra arguments.
   Real API/Worker client probes must validate chain and DNS SAN (`verify-full`,
   `rediss`, prepared data CA). Test wrong CA/SAN, plaintext, wrong passwords and
   prohibited role/peer operations. Record only handshake/protocol/result scalars
   and safe `pg_stat_ssl` evidence. Running containers or `SELECT 1` alone do not
   prove grants/ready. Ingress-to-Bot and Bot-to-API likewise require real trusted
   TLS with IP SANs; no `tls_insecure_skip_verify`.

5. **Compatible migrations/grants.** Review every SQL/fingerprint and the retained
   adapter/job compatibility, with separate migrator authority. For the existing
   host runner, a proposed temporary owned `/etc/hosts` entry maps
   `postgres-staging` to `.20`; preserve other entries and remove only this entry
   when finished. Privately provide `MIGRATION_DATABASE_URL` with `sslmode=verify-full`
   and explicit `sslrootcert=/opt/hambazi-staging/private/tls/data-ca.pem` so the
   Prisma engine also verifies trust; do not assume Node CA environment applies
   to that engine. Check declared Prisma tooling/engines before running it.
   Apply tested migrator role lock/statement bounds through private bootstrap,
   then use exactly `pnpm --filter @hambazi/database db:migrate`. It deploys schema
   and then grants; either failure holds apps closed even if schema committed.
   Repeat deploy to prove no duplicate migration, check safe drift/checksums and
   real API/Worker DDL/foreign-access denials. No reset, destructive down SQL,
   ad-hoc resolve or backfill invention. Expansion stays through rollback/overlap.

6. **Private application startup.** For the unchanged baseline use only its exact
   prepared Compose/project `hambazi-preparation`, `--env-file /dev/null` and
   selected role with digest verification/`--pull never`; keep all ports private.
   Start API after data/grants; require both public-private HTTP readiness and
   private Bot TLS listener checks, then Worker cleanup/queue readiness, then Bot
   authenticated backend/Telegram transport readiness, then Web immutable-policy
   health. Verify the existing private loopback LIVE/READY/metrics through the
   operator CLI. Redis DEGRADED is not full readiness acceptance. No ordinary
   Compose `up` of every service to skip ordering; no owner-public traffic or game
   activation for this baseline. A changed owner-gated candidate must have its own
   exact new prepared output and use that directory, never overwrite `-02`.

7. **Public TLS in hold mode.** Only with a passing ingress artifact and explicit
   public-TLS/firewall scope, start the hold definition for the three exact hosts.
   HTTP-01 requires TCP 80; ACME handles challenges and other HTTP redirects to
   HTTPS. Persist restricted `/data` ACME account/certificate state; automatic
   renewal uses the same port/DNS/issuer prerequisites. Verify trusted chains,
   each hostname/SAN, HTTP redirect, HTTPS 503 and private upstream isolation from
   laptop and VPS. Check renewal configuration and expiry privately; never
   provoke repeated issuance as a test. Owner can inspect expiry during existing
   manual monitoring; select the concrete reminder cadence before routing opens.
   Caddy Admin API/HTTP3/raw edge logging stay off. Restart/replace it against the
   reviewed file; no public management endpoint or automatic traffic promotion.

8. **Public owner smoke.** Only after the new owner candidate passes, switch to
   the reviewed owner route definition. Web GET/HEAD to `.13:8080`; API `/v1/*`
   to `.10:8080`, private routes denied, ingress overwrites trusted forwarded
   identity; Bot only POST `/v1/telegram/webhook` to TLS `.11:9444`, strips proxy
   headers the Bot rejects and preserves its secret header for backend validation.
   All other Bot routes and browser-Origin requests deny. Health/metrics/internal/
   Admin stay unpublished. Web/API HTTP upstreams are on the approved internal
   bridge; privileged Bot/API and data hops use verified TLS. WSS/Socket.IO routes
   require the reviewed production realtime composition and separate 7C/game
   gate; do not advertise WSS smoke as passed with today's absent listener.
   Check native owner login/profile/catalog, fresh/forged/expired initData,
   non-owner denial/no effects, logout/re-auth, rates, CORS/CSP/security headers,
   spoofed proxy headers and public private-route denial. Do not archive initData,
   session tokens, screenshots with private launch data or Bot responses.
   Bot live updates require separately authorized webhook registration; until
   then registration/delivery/dedupe/chat acceptance remains unperformed.

9. **Gameplay acceptance only after prerequisites.** With completed 7C/Main invite/
   production composition and approved test identities, run protected staging
   create → invite/join → start → real Coup → finish → stats, duplicate original
   commands, reconnect/gap recovery, Bot takeover/privacy and durable receipts.
   Preserve engine/state/ruleset pins and old job handlers. Actual WSS/browser/
   Telegram mobile evidence must identify its tested client. Keep deferred strict
   production load/soak/fault/SLO coverage explicit. No subsequent phase starts.

## Manual monitoring, failure and rollback

From the reviewed runner, use the existing [private operator CLI](runbooks/private-operator.md):

```sh
node infra/release/operator.mjs /opt/hambazi-staging/private/prepared-20261008-02 api live
node infra/release/operator.mjs /opt/hambazi-staging/private/prepared-20261008-02 api ready
node infra/release/operator.mjs /opt/hambazi-staging/private/prepared-20261008-02 api metrics
node infra/release/operator.mjs /opt/hambazi-staging/private/prepared-20261008-02 api logs
```

Repeat the appropriate commands for Bot/Worker and Web health; Web has no metrics
endpoint. A replacement uses its new prepared directory. These are reads of
already-running containers. Logs remain local compressed 10m × 3 per role, CLI
last 200 allowlisted stdout records. Check timestamps, collection success,
dependency latency/availability, pool waiters, backlog and fixed errors; stale
gauges are not healthy zeros. Observe startup, each smoke/incident/drain, renewal
expiry and after reopen. No automatic notification/continuous response claim;
test the owner's manual observation during an approved bounded dependency failure.

Any failed gate holds routing at 503, stops further steps and records safe evidence.
Follow [DB degradation](runbooks/database-degradation.md),
[Redis loss](runbooks/redis-loss.md), [maintenance](runbooks/maintenance.md) and
[stuck Match](runbooks/stuck-match.md) within their existing owning-port scope.
No Redis flush, counter/version reset, hidden-state inspection, manual outcome
rewrite or undocumented recovery command. ADR-050 supplies no lost-data recovery
promise; a lost disposable dataset does not permit silent reset during this run.

For application failure, switch ingress to hold first; prove new admission stops,
then SIGTERM the affected app/Worker/Bot. Require NOT_READY before new claims stop,
accepted-work/transaction/job settlement and exit evidence within approved drain
budgets and 45-second supervisor grace. A timeout/forced exit is a failed drain.
Preserve PG volume/schema, append-only events, action/command IDs, results,
receipts, outbox and queue schedules. Retry ambiguous effects with original IDs.

For a version rollback, preapprove a compatible previous image/config set with
fresh scans and the same owner gate, active pins/job handlers and expanded schema;
replace app roles only, recheck private readiness/original-ID retries/reconnect/
truth, then reopen under operator approval. Follow [rollback](runbooks/rollback.md).
No such production-compatible staging pair currently exists. Older vulnerable
`a212cd4` is blocked; ungated `65ff180` cannot be public fallback for an owner-gated
release. First-run **hold + stop apps + preserve data** is containment, not evidence
of candidate-to-previous rollback. The real rollback-pair drill remains an 18B3 gate.

## Historical authorization review — superseded by ADR-052

The next independent preparation step is local investigation/remediation of the
blocked ingress scan. The first target execution step after explicit bounded
authorization is the read-only identity/hash/scan/network preflight in step 1;
it is not `compose up`. Do not interpret plan approval as waiver of a failed scan
or 7C gate.

Use separately identifiable scopes, all limited to the existing temporary VPS:

1. Private owner-ID verification/storage with read-only Bot queries and no Telegram
   settings/backlog changes. The existing local read/write authorization already
   covers focused Auth/Bot admission/config/test/new-candidate work; this turn
   prepares its plan only. No repeated permission for routine repository edits
   is requested. Public owner routing waits for the resulting evidence.
2. Accept the additional proposed infrastructure values and authorize exclusive
   private bootstrap/key-copy/volume work, private PG/Redis startup, TLS/grant
   validation, **only reviewed compatible migrations**, private app startup and
   failure containment. Name the final passing artifacts/prepared directory;
   preserve `-02` and all original evidence. The migration/host-entry and data-
   service mutations require explicit scope despite disposable data.
3. Once ingress scans pass, authorize SSH-preserving owned firewall changes,
   TCP 80/443 publication and Let's Encrypt issuance/renewal for exactly the three
   supplied hosts, initially 503 only. After owner-gate smoke and readiness, name
   a separate account/profile/read-only catalog traffic switch, keeping games off.
4. Request a separate prerequisite-work scope for 7C/Room Main/production game
   composition before full gameplay. No automatic phase transition. Later Bot
   `setWebhook` must have its own explicit authorization for
   `https://bot-staging.hambazi.top/v1/telegram/webhook`, private existing secret,
   reviewed allowed updates and `drop_pending_updates=false`; no token/menu/Main
   settings change or backlog deletion is included here.

Owner-ID evidence, owner admission, passing ingress, actual compatibility/grants/
trust, 7C/Main/composition, multiplayer proof, rollback pair and protected staging
CI evidence remain blockers at their respective gates. Approval never makes their
evidence passed. Preparation success remains preparation; 18B3 is not complete.

## Historical plan preparation validation

Local Compose `config --no-env-resolution --quiet`, both Caddyfile adaptations,
Redis helper `sh -n`, proposed-definition invariants/seven asset hash checks,
root formatting, diff checks and all 113 local documentation references pass.
`SECURITY_SCANNER_DIR` is supplied with the verified pinned tool directory:
`pnpm test:infra` passes all 110 tests, including the real secret-scanner canary.
Fresh hash-pinned Gitleaks scans reachable history and all 673 current candidate
files with zero findings. These are preparation checks, not live TLS/firewall/
migration/drain/Telegram tests. Product runtime is unchanged and its suites are
not rerun for this plan; new runtime prerequisites will need their own full gates.

Primary operational references: [Telegram Bot API](https://core.telegram.org/bots/api),
[Caddy TLS](https://caddyserver.com/docs/caddyfile/directives/tls),
[Caddy proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[Docker firewall chains](https://docs.docker.com/engine/network/firewall-iptables/),
[PostgreSQL TLS](https://www.postgresql.org/docs/current/ssl-tcp.html),
[Redis TLS](https://redis.io/docs/latest/operate/oss_and_stack/management/security/encryption/).
