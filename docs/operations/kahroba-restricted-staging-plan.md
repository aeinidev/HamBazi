# Kahroba K4B restricted rollout and rollback plan

**Review-only. K4A does not authorize this procedure to execute. Production HOLD remains.**

**Subsequent security-only approval, 2026-10-13:** The owner approved the exact public-revision false-positive remediation; see [ADR-068](../adr/068-exact-public-provenance-secret-scan-exception.md) and its [verification report](../security/kahroba-gitleaks-remediation.md). Only the pending scanner decision in the historical preflight amendment below is superseded. Clean source, required regressions, fresh operational evidence and separate K4B approval remain prerequisites. No staging action or containment renewal is authorized.

## K4B preflight amendment — 2026-10-13

The focused [security/operational preflight](../security/kahroba-k4b-preflight.md) recommends **NO-GO**. Both Gitleaks matches are verified public-revision false positives, but the unmodified machine gate still blocks and no new allowance is approved. Three pre-existing Bot failures and the legacy preview failure independently reproduce and affect required CI/release checks; no documented waiver applies. Existing permitted Moderate zlib handling is preserved.

Required sequence before deployment approval: approve/validate the narrowly bounded detector disposition; separately authorize a reviewed clean-source commit on an isolated release branch; resolve required regression gates or an explicitly permitted staging-only policy decision; restore the existing owner SSH context locally or obtain sanitized checks from the sole operator; verify fresh target/configuration/scan/containment/rollback evidence. Never bypass clean-source controls, relabel dirty artifacts, waive machine results implicitly, request credentials in chat or alter server access as a workaround.

Strict-key/noninteractive SSH reaches the known host but offers no public key: this session's agent is empty and default private-key files are absent. Server outage/firewall/key revocation is not established. Current recorded expiry remains **2026-10-13 13:18:23 UTC / 16:48:23 Tehran**, mathematically unexpired at the 08:54:20 UTC review; actual installed-timer state is unverified. Public Web 200 is not private operational readiness. Prefer the latest binding's recorded paths over older runbook examples, then read them back on target. No window renewal is authorized.

ADR-058 preserves the existing two identities for ordinary personal features; it does not silently extend ADR-050 recovery acceptance to two-human Kahroba. Confirm that exact disposable scope before activation. Verify a v2-capable rollback pair; keeping the old Worker after shared-result history is not a rollback solution. All detailed safeguards and consumer-before-producer/admission-last ordering below remain mandatory.

## 1. Target, source and evidence

Target is the previously approved ParsPack Germany staging VPS `185.110.191.104`, recorded Docker daemon `342f251a-9e56-4353-af12-a32429b7a2e7`, Linux amd64. This identity must be read back by the authorized operator; public HTTPS cannot prove it. Existing development Bot is `Hambazidev_bot`, Mini App `https://staging.hambazi.top/`, API `https://api-staging.hambazi.top`.

Current local base HEAD is `11c2a53036b6cb4bce14cc040a95e31a208e592c`. K1–K4 changes are uncommitted. Exact local artifact/source/build identities are recorded in the K4A evidence inventory once built; they are **dirty local review candidates**, not a clean staging release. Existing acceptance/renewal controls require clean source. Do not deploy them by relabelling `sourceDirty`, skipping a gate or inventing a future revision. A separately authorized clean-source commit/revision, reproducible rebuild, exact artifact inventory and fresh scans are a release prerequisite. K4A created no commit or PR.

Historical installed API/Bot/Worker revision is `1bfc42e50c6f7b3f1a27168df22c99018356ab18`; Web is `685d9f6683fef8e06197622b4c695a145c7b8c94`. Exact existing images are in the preserved `infra/docker/staging/staging-test-user-current.json` and K4A `staging-audit.json`. Do not infer that they are still installed from those records alone.

At 2026-10-13 08:07:31 UTC, read-only TLS-verified HEAD probes returned Web 200 and private Kahroba capabilities 404. SSH returned permission denied. Fresh timer/container/admission/database/webhook/rollback evidence is unavailable. Recorded advisory expiry is **2026-10-13 13:18:23 UTC / 16:48:23 Tehran**. Historical renewal is not permission to renew again. If expired, containment stays in place until a separately authorized, fresh-gated operation.

## 2. Approval prerequisites

Before any server mutation, obtain K4B bounded deployment approval and satisfy these gates:

1. Preserve and read back provider/daemon, actual images, role config/mount hashes, volumes/networks/TLS, approved owner and `@devtest98` numeric admission hashes, production HOLD, maintenance routes, containment service/timer and deadline.
2. Identify current active/historical engine pins, all pending/delayed/failed queues, outbox backlog and DB connection budget. Neither Redis flush nor queue purge is allowed. Preserve the current role pool/admission values unless an explicit reviewed delta is necessary.
3. Review the retained Gitleaks public-revision finding and its narrow treatment through the established review process. No blanket ignore, bypass or unreviewed rule suppression. Preserve the three Bot regression failures and legacy preview mismatch; any restricted exception or fix requires owner decision. A clean overall gate is not claimed.
4. Bind a clean reviewed source revision, exact four app images, Web private flag/browser policy and contract/migration hashes. Fresh hash-pinned Trivy must scan these exact images and **actual target PostgreSQL, Redis, ingress and ACME images**, eight total. UpdatedAt and DownloadedAt both must be within normal 24h policy. HIGH/CRITICAL/UNKNOWN block. Retained Moderate zlib `CVE-2026-85091` is visible and allowed by existing severity policy; it is not fixed or suppressed. Do not reuse a historical scan as new evidence or renew a timer implicitly.
5. Verify rollback images/readers support all existing Coup/Anarchist pins, retained v1 and Kahroba v2 history/jobs. Retain a v2-capable rollback Worker and API. The old installed Worker is not that artifact.
6. Review the dormant [Game registration DML](kahroba-registration.proposed.sql). There is **no new schema migration or backfill**. The existing schema must already have all fifteen migrations. The proposed DML is a separately recorded target write and remains unexecuted. A mismatching existing row aborts, never overwrites.
7. Confirm the existing disposable/no-backup policy's applicability to this bounded two-human Kahroba test. ADR-050 was personal staging and excludes backups/PITR/WAL/offsite/restore; scope expansion is not silently approved. If the owner does not extend/confirm that exception, recovery policy is a separate approval gate. Do not provision backup infrastructure during this phase. No RPO/RTO or successful backup restore is claimed. Preserve actual existing durable data in either case.
8. Verify the existing named Mini App short name for Room deep links. No short name is inferred from the main Mini App URL. Initial validation can use the private entry plus copied opaque invite code. Do not change BotFather/menu/webhook/username resolution as a workaround.

## 3. Configuration delta to review

Retain production mode, separate credentials, verify-full PostgreSQL TLS, Redis TLS, private CA mounts, trusted proxy, exact CORS origin, transport limits, existing owner/Bot policy/mounts and `PERSONAL_GAMEPLAY_PROFILE=owner-bots-v1` in API/Worker. Bot configuration is unchanged. No synthetic identity or local admission file can be copied to staging.

API/Worker additions:

```dotenv
KAHROBA_RUNTIME_PROFILE=restricted-staging-v1
KAHROBA_ENGINE_REGISTERED=false
KAHROBA_RUNTIME_ENABLED=false
KAHROBA_ROUTES_ENABLED=false
KAHROBA_ADMISSION_ENABLED=false
KAHROBA_QUEUE_NAMESPACE=<exact-existing-WORKER_QUEUE_NAMESPACE>
KAHROBA_RECONNECT_LEASE_MS=30000
KAHROBA_RECONNECT_GRACE_MS=30000
```

The last two are **proposed transport lease/grace values for approval**, not human turn durations and not a Bot takeover policy. Kahroba rule `turnDurationMs` and `timeoutPolicyVersion` remain null. The production profile limits capacity to two; local capacity four is forbidden. Namespace is a verified existing private input, not a newly invented queue or infrastructure service.

API also needs explicit Rooms policy/target: `ROOM_TTL_SECONDS`, `ROOM_READ_LIMIT`, `ROOM_CREATE_LIMIT`, `ROOM_INVITE_LIMIT`, `ROOM_BOT_USERNAME=Hambazidev_bot` and the verified `ROOM_APP_NAME`. Proposed local validation values were 900s/300/30/300; these are **not automatically staging limits**. Seal reviewed staging values from actual policy/budget before preparation. Existing public Room routes stay held; the runtime mounts the private prefix only.

Worker requires `STATS_ENABLED=true`, explicit `STATS_CONCURRENCY` and `STATS_DRAIN_TIMEOUT_MS`; `MATCH_OUTBOX_ENABLED=true` and explicit existing outbox interval/batch/lease/retry/backoff/max-backoff/publish-timeout policy. Determine them from actual operating bounds; no human turn policy is inferred. New role-field parsers validate the complete profile, shared namespace and paired controls. `prepare.mjs` remains the only role/TLS/network/scan preparation path; it has no deployment authority.

Web build input is `VITE_KAHROBA_RUNTIME=true`, exact existing staging Web/API origins and existing frame ancestors. It is included in candidate build identity; changing it requires a new Web artifact/scan. It exposes only a private affordance after a server-authorized capabilities response. Public catalog/navigation, admin, voice, matchmaking and chat remain held.

## 4. Private ingress delta

Create a new proposed configuration from **the actual current runtime routes**, preserve every existing allow/deny/security/trusted-header rule, and add only these API-host paths:

| Path                                 | Methods                                                   |
| ------------------------------------ | --------------------------------------------------------- |
| `/v1/kahroba/capabilities`           | GET, OPTIONS                                              |
| `/v1/kahroba/rooms`                  | POST, OPTIONS                                             |
| `/v1/kahroba/rooms/{uuid}`           | GET, OPTIONS                                              |
| `/v1/kahroba/rooms/{uuid}/invite`    | GET, OPTIONS                                              |
| `/v1/kahroba/room-invites/resolve`   | POST, OPTIONS                                             |
| `/v1/kahroba/matches/{uuid}/players` | GET, OPTIONS                                              |
| `/v1/kahroba/socket.io/`             | Socket polling GET/POST/OPTIONS and WebSocket GET upgrade |

Forward only existing allowlisted request headers, authorization/origin/content type and canonical proxy TLS/peer headers. Socket location must explicitly retain that trust boundary plus the WebSocket upgrade headers, as in the personal transport; do not let a location-level `proxy_set_header` erase inherited trust headers. Keep short bounded proxy timeouts consistent with transport leases. API still authenticates/admission-checks every request; path availability is not identity permission.

Validate the complete new Nginx configuration offline and on the identified target before authorized activation. Do not modify the original routes file, domain, port/firewall, Bot ingress, private health/admin/internal routes or ordinary gameplay deny rules. No routing delta was installed in K4A. The exact operator render/hash cannot be certified without reading current target configuration and private inputs.

## 5. Consumer-before-producer execution sequence (unperformed)

1. **Read-only preflight**, seal all identities/hashes and approvals above. If any differs, stop. Do not start with `compose up`.
2. Under approved maintenance/drain procedure, retain current DB/Redis/network/TLS/containment controls and capture existing safe counters/pins/job inventory. Let existing accepted writes settle. Never alter hidden state or active pin values.
3. Run only approved dormant Game registration DML if absent; verify row/hash and unchanged migration count. Do not enable public Game status.
4. Prepare immutable role artifacts with all Kahroba flags false. Deploy the **new v1/v2-capable Worker first**, retaining personal automation and the existing namespace. Verify private `/v1/health/live`, `/v1/health/ready`, dependency probes, outbox/statistics readiness and no quarantine/error drift. Review all retained job handlers. No API can produce v2 Kahroba until this is demonstrated.
5. Deploy the compatible API with four flags false. Verify existing signed owner/tester entry, Users/profile and personal namespace/retained pins; unknown/private Kahroba routes remain unavailable. Bot can remain its unchanged exact installed image if the retained internal API contract/credential/TLS checks pass; a rebuilt compatible Bot image is an available rollback artifact, not an unnecessary replacement.
6. Install the reviewed private ingress delta with admission closed, then set API/Worker registration/runtime/routes true, admission false using the approved private role preparation path. Verify both Socket namespaces coexist and active/history reads are safe. Worker remains v2 ready. Reject unapproved identities, wrong origins, identity injection and foreign match access without durable side effects. Avoid a manufactured real unauthorized account.
7. Deploy exact private-enabled Web. Verify actual HTML/JS/CSS/SDK/font/17 original WebPs byte hashes, CSP/HSTS/no-store, no preview/engine/dataset/RNG material, no browser storage credentials and unchanged ordinary catalog/personal behavior. Private capability maxPlayers must be 2, all turn policies null.
8. **Activate new admission last** for only the existing owner and `@devtest98`. Numeric-only read-only admission files and their hashes/counts stay unchanged. No admin role, username resolver or third real identity. Record the approved window without renewing/changing containment unless that separate action is explicitly authorized.
9. One bounded two-human native test: explicit registered Telegram launch → private entry → create → opaque invite join → host start → both ready → 12 cards/3 nobles → alternating collection, reserve, purchase → reconnect with private hand isolation → finish → persisted v2 truth and exactly-once shared-statistics path. A natural shared result is optional; no synthetic state is installed on staging to force it. Local restoration-valid shared edges provide that separate proof.
10. Record native Telegram client/OS, 320/375/390 or actual device dimensions, safe-area/back/fullscreen, background-resume/session expiry, keyboard/sheets and owner/tester feedback. Do not collect raw initData, tokens, deck/RNG/other private hand in telemetry. Three/four-player and fault/stress workloads remain local; no staging load/storm/soak test is authorized.
11. Close the bounded validation with safe service/results/queue/admission/scan/containment readbacks. Production HOLD and public gameplay restrictions remain unchanged. Any widening requires new scope approval.

## 6. Rollback and recovery

- **Before any Kahroba match exists:** close new admission; restore previous Web/ingress under approved maintenance. Old API/Worker can be restored only after checking no v2 truth, jobs, receipts or new pins exist. Retain the dormant Game row; there is no reason to delete durable catalog truth.
- **Active Kahroba matches:** set admission false first. Keep routes, pinned adapter, durable readers and v2-capable Worker alive so admitted players can finish. UI removal alone is not a valid rollback for those matches. No timeout, redraw, termination, winner reassignment or Bot fallback is approved.
- **Emergency containment or service failure:** use the established maintenance/drain controls after explicit authorization, preserve volumes/state/events/receipts/outbox/Redis jobs. Resume only the same pinned version or a tested compatible version after readiness/scans; do not rewrite state or fabricate a result. Redis reconstruction must redrive durable outbox truth and deduplicate, never reset the PostgreSQL match.
- **Finished v2 history exists:** keep v2 result readers, consumers and stats rebuild support permanently, even when queues are empty. The historical old Worker cannot safely process/rebuild shared victory. A compatible new Worker/API rollback artifact is mandatory. Restore old Bot/Web only after their retained contract/route behavior is checked.
- Before closing Kahroba routes, prove zero active/waiting Kahroba matches and no required subscriptions; drain accepted writes and outbox/finish jobs, check one statistics application per match/generation and all shared winner rows. History readers remain v2-capable afterward.
- Database restore, backup/PITR and provider failover are unperformed under the recorded temporary exception, not a successful rollback drill. No promised RPO/RTO. Preserve migration overlap and all existing Coup/Anarchist/v1 pins/history.

## Stop/approval rule

No staging/prod deployment, DML, migration, restart/replacement, route/firewall/port/domain change, timer renewal, admission expansion, Bot message or commit occurred in K4A. Plan approval cannot waive unresolved scanner/test/clean-source/fresh-target gates. The next explicit question is: **Approve Phase K4B restricted staging deployment?**
