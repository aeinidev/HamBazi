# Kahroba Phase K4A readiness report

Date: 2026-10-13, Asia/Tehran. **Local implementation and preparation only. No deployment is authorized or performed. Production HOLD remains.**

## 1. Implementation summary

Kahroba is now composed through the actual API/Worker main entry points and the actual Web app. The optional composition reuses existing Auth/Users, Games facade, Rooms/start, Match transactions/receipts/outbox, safe resync, distributed admission, Socket.IO/Redis delivery, presence and v1/v2 statistics. No new infrastructure, dependency, database schema or migration was added.

Independent registration/runtime/routes/admission flags fail closed. Default application behavior is unchanged. Local mode is restricted to loopback and two to four controlled synthetic identities in a mode-0600 file. The dormant staging profile requires existing owner/tester admission, exact staging origin, existing personal gameplay, production TLS and capacity two. K4A does not install that profile anywhere.

Private Web entry supports create/join/invite/host-start/ready/table, shares a server-issued memory session with an isolated transport/store/cache, and binds peer display names through a membership-authorized public names response. Display names are not claimed Telegram usernames. Own public handle has no greeting. Ambiguous room/start/ready/join retries retain one captured ID/version. Gameplay intent authority remains entirely server-side; turn duration and timeout policy remain null.

See [ADR-067](../adr/067-kahroba-restricted-runtime-and-rollout.md) and [runtime architecture](../architecture/kahroba-runtime.md).

## 2. Actual runtime findings

Before K4A, the actual API composition had trusted Auth/Users/profile/catalog, optional REST Rooms and personal Coup/Anarchist ports; K2's generic Kahroba gateway existed only in explicit composition. Worker already supported K2 v1/v2 results through existing outbox/statistics facilities. K4A adds only the missing trusted runtime wiring.

Private REST uses `/v1/kahroba`; Socket uses namespace `/kahroba-v1`, path `/v1/kahroba/socket.io`. The public catalog remains Coup-only. A stored `DISABLED` Kahroba Game is validated by Games' private facade, never publicly enabled by this runtime. Chat/matchmaking are denied. Both personal and Kahroba transports are tested on one real HTTP listener; the HTTP composition supplies original production/trusted-proxy enforcement and narrowly rejects unknown upgrade paths.

The ordinary human Match path does not enter the Worker's personal automation filter. No human turn timeout, takeover, fallback or automatic pass policy was activated. Existing Coup/Anarchist pins, v1 contracts/history and K1/K2 Kahroba view/result versions remain. Match-bounded names are read through Users' public port after snapshot authorization, with no network I/O inside a transaction.

## 3. Full locally tested multiplayer workflow

`pnpm test:kahroba:local --runtime` starts fresh owned PostgreSQL/Redis and applies only the fifteen existing schema migrations to that disposable database. It starts the actual Worker main **before** the actual API main, waits for private readiness, authenticates real HMAC-signed synthetic Telegram initData through the unmodified verifier/session service, and runs the actual Web Vite application in two browser contexts. These are automated synthetic human seats, not two real Telegram users or native-device acceptance.

Both Chromium and WebKit passed private entry → create → invite-code join → host start → both ready → twelve market cards/three nobles → alternate token collection → blind reservation → explicit UI purchase → API restart → reconnect → finish/result dialog. Peer snapshots contain no reserved identity or deck fields. Foreign roster reads return NOT_FOUND. The same committed command ID/version replays without another engine transition, including after restart. Closing new admission rejects new room creation while preserving active play. Browser local/session storage remain empty. Durable result-v2/per-player rows and one statistics application are checked through the live Worker.

Three- and four-player games use the same actual process entry points and private lifecycle, with controlled synthetic identities and server-side setup. They finish naturally using a public-view action generator in the test runner, not runtime Bot takeover. Final verified games played 78 and 108 turns. Two-browser games played 54 and 62 turns. A labelled restoration-valid synthetic shared-final-round arrangement executes real final commands and credits both winners through the actual Worker.

Separate fresh K2 service tests cover invalid actions, atomic state/event/outbox/receipt persistence, stale/duplicate commands, concurrent writes, projection privacy, reconnect, database restoration, node drain and Redis pause/recovery. Worker tests redeliver finish events, restart the consumer, rebuild mixed Coup-v1/Kahroba-v2 history and assert identical statistics/truth, including both shared winners. This proves deduplicated logical effects under at-least-once delivery; it does not claim transport exactly-once delivery.

Actual-main evidence is in `test-results/kahroba-k4a/runtime-{3,4,shared}.json`, both `*-runtime-e2e.json`, `runtime-verified.log`, two `*-real-runtime-375.png` captures and `k2-services.log`. No native staging game was played.

## 4. Tests and security evidence

Commands below were executed through RTK; logs are retained under the ignored `test-results/kahroba-k4a/` directory. Timestamps in cached Turbo output are historical replayed log timestamps; current uncached suite starts and timestamped proof JSON identify new execution. The workstation interruption discarded earlier `/tmp` logs; results below use retained post-interruption evidence.

| Command / verification                                               | Actual result                                                                                                                                                                                   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                     | Passed, pinned pnpm 12.4.1 / Node 24.20.0, no lockfile update                                                                                                                                   |
| `pnpm typecheck`                                                     | 24 tasks passed; 20 cached on the recorded run                                                                                                                                                  |
| `pnpm lint`, `pnpm check:architecture`                               | Passed; architecture 15 workspaces / 280 source files                                                                                                                                           |
| `SECURITY_SCANNER_DIR=... pnpm test`                                 | 2,035 workspace tests passed; 37 tasks / 31 cached; infrastructure **130 passed, zero skips**, including actual scanner canary                                                                  |
| `pnpm --filter @hambazi/api test`                                    | 973 passed / 54 files, including private registration and transport coexistence                                                                                                                 |
| `pnpm test:kahroba:local --runtime`                                  | Fresh DB foundation 17; actual main runtime 5; Worker mixed-v1/v2 suite 3; all passed                                                                                                           |
| `pnpm test:kahroba:local --kahroba-only`                             | Fresh DB 17; Kahroba API integration 11; Worker integration 3; all passed                                                                                                                       |
| `pnpm test:kahroba:local --bot-regression`                           | DB 17 and sessions 62 passed; **Bot delivery 3 passed / 3 failed**, overall exit 1                                                                                                              |
| `pnpm --filter @hambazi/api contract:check`                          | All original contracts, v2 result and new private runtime v1 baseline passed                                                                                                                    |
| `env -u GIO_MODULE_DIR pnpm --filter @hambazi/web test:kahroba`      | **38 passed**, Chromium/WebKit, no skips                                                                                                                                                        |
| Existing platform `test:browser` with pinned local official SDK file | **30 passed**; initial upstream-fetch run had 19 passed / 1 SDK-fixture failure / 10 not run, retained accurately                                                                               |
| Midnight `table.spec.ts lobby.spec.ts`, both browsers                | **66 passed**, including all 30 Coup/Anarchist table cases; no teardown failure after fixture-order fix                                                                                         |
| Existing `test:preview`                                              | **1 passed / 1 legacy English-label failure**, same K3-classified expectation at `preview.spec.ts:33:66`                                                                                        |
| `pnpm build` / normal Web build                                      | Verified local builds; ordinary no-feature build restored after the simulated-origin Midnight build                                                                                             |
| Asset/reference audit                                                | All 17 source/archive/output hashes and sizes verified; 26 K3 capture hashes retained; originals untouched                                                                                      |
| `node infra/scripts/security-scan.mjs dependencies`                  | Passed, zero advisories at all severities                                                                                                                                                       |
| Pinned Gitleaks history + candidate tree                             | **Blocked: one history and one current finding**, no suppression/exception added                                                                                                                |
| Pinned Trivy local PG/Redis                                          | Passed policy: zero HIGH/CRITICAL/UNKNOWN; one visible Moderate zlib advisory each                                                                                                              |
| Local application candidate build/scan/reproducibility               | Two candidate builds produced identical source/build identity and four image references; all four app scans passed policy. Exact ledger below; dirty local candidates are not staging approval. |

### Retained failures and investigation

Bot failures independently reproduce at `bot-delivery.test.mjs:196:36`, `216:31`, `243:31`. They assume immediate account creation where existing onboarding prompts for a valid name. K3's clean pre-Kahroba baseline reproduced the same failures; K4A independently reproduced the current tree. Bot/Auth/Users behavior and expectations were not changed or waived.

The Midnight teardown race allowed route callbacks to use an already disposed APIRequestContext. An auto fixture now depends on both page and request and waits for intercepted routes to settle before either built-in fixture is torn down. All four Midnight specs use that same fixture; product behavior is untouched. The related 66-case suite now passes. This improves teardown order; no claim is made that every future timing flake is impossible.

The legacy preview still expects English `Your cards`/`AMBASSADOR`/`declare income` in the Persian Coup UI. Fresh K4A reproduces it; K3 previously reproduced it on clean HEAD. It remains an outstanding test mismatch.

Early local runtime iterations caught a four-player driver version conflict caused by presence changes, an entry link covered by fixed navigation, foreign-membership status expectation (404, following existing concealment), and browser interaction before its latest public snapshot. The harness now waits for the displayed public state version and retries only an explicitly rejected version-conflict intent; ambiguous committed retries keep their original identity. Final actual-main run passed all five cases. Earlier failed logs are retained, not described as passed.

The SDK-fixture failure followed an upstream fetch, not a changed production SDK. Reusing the repository's identical pinned official bytes through the existing fixture-path input passed all 30 tests; digest enforcement was preserved. WebKit runs unset only the inherited Snap `GIO_MODULE_DIR`; no sandbox or product security control was disabled.

### Secret finding

The generic-api-key rule matches `application.roleSourceCommits.api` in the existing staging binding (history line 41). Private redacted investigation verified that matched value is a reachable public Git commit; current field equals that verified historical revision. No credential was identified. The actual scanner still reports **blocked**. No ignored directory, inline allowance, policy exception, binding edit or matched-material logging was introduced. A narrow review decision remains a release gate. `secret-review.json` records metadata/classification without sensitive matched output.

Moderate zlib `CVE-2026-85091` remains visible in local data images and is allowed by existing severity thresholds. It was not fixed or suppressed. Local advisory database UpdatedAt `2026-10-13T06:41:11.035783622Z`, DownloadedAt `2026-10-13T08:17:43.758683607Z`; local freshness does not renew the installed staging timer. Actual target image identities and fresh eight-image target scans require operator access.

## 5. Visual comparison

All **26 original K3 captures** were reviewed against the supplied image. The [visual review](../design/kahroba-k4a-visual-review.md) lists every capture category and classifications. Layout order, original palace/category art, twelve market slots, bonus-icon nobles, English card numerals and assistant controls are present. Quieter ornament/glow, taller narrow cards, compact gems/portraits, five nobles for four players and vertical scrolling are intentional differences. Narrow text/cost density, browser-native input cosmetics and cropped scrollable sheet contents are minor. No blocking layout defect was identified from this evidence and no redesign was performed. Exact parity and native safe-area/keyboard acceptance are not claimed.

## 6. Staging governance

The preserved binding was checked historically at 2026-10-12 19:14:11 UTC. Approved provider/region, four role images, development Bot, owner + tester `@devtest98`, numeric read-only admission, no admin/public access and production HOLD are recorded. Historical same-container reopening was expressly approved at 19:11:40 UTC; recorded deadline is Oct 13 13:18:23 UTC / 16:48:23 Tehran. Neither that approval nor its scan is a new K4A operational authorization.

At Oct 13 08:07:31 UTC, Web returned 200 with validated TLS and preserved security/no-store headers; Kahroba capabilities returned 404. SSH was denied. Thus current daemon/container/role/admission/containment/database/webhook state is **unverified**, not assumed healthy or modified. Historical two-user/47-match/zero-active/15-migration counts remain historical only.

ADR-050's disposable staging exception omits backup/PITR/WAL/offsite/restore; recovery was not passed and no RPO/RTO is promised. Applicability to the bounded two-human Kahroba scope needs explicit confirmation before K4B; no backup service was provisioned. The existing named Mini App short name is also unverified; local synthetic `play` is not a staging value.

## 7. Artifacts, compatibility ordering and plan

The [restricted rollout/rollback plan](../operations/kahroba-restricted-staging-plan.md) defines exact target/reference identities, configuration deltas, private path allowlist, security/health gates, migration-free dormant DML, native acceptance and failure handling. Exact local candidate identities are in the final artifact ledger below. Dirty local candidates are review evidence: existing clean-source acceptance/renewal controls are not waived, and a future clean revision is not invented. No commit was authorized or created.

New Worker v1/v2 consumers and durable readers must be ready before any Kahroba API producer. Bot internal contracts remain compatible; its existing image can remain. Web private flag is pinned into image identity. Admission activates last, only for the existing two identities. Rollback closes new admission first, preserves active matches/routes/pins until finish, and retains v2 readers/consumers/statistics rebuild forever for historical shared results. Old Worker rollback after any v2 truth is unsafe even when queues are drained. Emergency containment preserves state/jobs and enables no invented timer, termination or takeover.

## 8. Exact K4A source files

**Created:**

```text
packages/config/src/kahroba-runtime.ts
packages/config/tests/kahroba-runtime.test.ts
apps/api/src/composition/kahroba-http.ts
apps/api/src/composition/kahroba-local-admission.ts
apps/api/src/composition/kahroba-runtime.ts
apps/api/src/games/application/private-registration.ts
apps/api/tests/games/private-registration.test.ts
apps/api/tests/integration/kahroba-runtime.test.mjs
apps/api/tests/realtime/kahroba-coexistence.test.ts
apps/api/scripts/kahroba-runtime-contract.mjs
apps/web/src/games/kahroba/runtime.ts
apps/web/src/games/kahroba/screens/application.tsx
docs/contracts/kahroba.runtime.v1.baseline.json
docs/contracts/kahroba.runtime.v1.json
docs/adr/067-kahroba-restricted-runtime-and-rollout.md
docs/architecture/kahroba-runtime.md
docs/design/kahroba-k4a-visual-review.md
docs/operations/kahroba-registration.proposed.sql
docs/operations/kahroba-restricted-staging-plan.md
docs/testing/kahroba-k4a.md
```

**Modified:**

```text
packages/config/src/index.ts
apps/api/package.json
apps/api/src/composition/http.ts
apps/api/src/composition/runtime.ts
apps/api/src/games/index.ts
apps/api/src/games/module.ts
apps/api/src/games/infrastructure/repositories/catalog.ts
apps/api/src/realtime/gateway.ts
apps/api/src/realtime/personal-gateway.ts
apps/api/src/rooms/infrastructure/rooms-http.ts
apps/worker/src/composition/runtime.ts
apps/web/src/app.tsx
apps/web/src/main.tsx
apps/web/src/platform/realtime.ts
apps/web/src/platform/runtime.ts
apps/web/src/games/kahroba/index.ts
apps/web/src/games/kahroba/screens/match.tsx
apps/web/src/games/kahroba/screens/table.css
apps/web/tests/midnight/fixture.ts
apps/web/tests/midnight/lobby.spec.ts
apps/web/tests/midnight/table.spec.ts
apps/web/tests/midnight/telegram-presentation.spec.ts
apps/web/tests/midnight/visual-revision.spec.ts
infra/scripts/test-kahroba-local.mjs
infra/docker/apps/Dockerfile
infra/release/build.mjs
infra/release/prepare.mjs
infra/tests/deployment.test.mjs
infra/tests/packaging.test.mjs
turbo.json
docs/implementation-plan.md
```

K1/K2/K3 uncommitted work and the user's existing staging binding/containment incident were preserved. No K4A edit was made to the pure engines, Bot/Auth/Users/profile logic, schema/migrations, dependency pins or existing public contract baselines. The pre-interruption initial SHA ledger in `/tmp` was lost; no unsupported claim that all initial 110 file hashes were reverified is made. Retained K3 screenshot/asset hashes and tracked protected-source diffs provide narrower verification. Build/log/scan/gallery files are ignored local artifacts; artifact inventories are not commits.

## 9. Remaining gates and stop

K4A local runtime implementation/validation is complete subject to the recorded broader release failures and artifact results. K4B requires explicit deployment approval plus clean pinned source/artifacts, Gitleaks review, Bot/legacy regression disposition, fresh operator target/admission/containment/queue/rollback checks, exact target scans, sealed private configuration/route/DML review, disposable-data exception applicability and named-app/native two-human acceptance. No new real identities, production changes, migrations, staging restart/deploy/timer renewal or public activation occurred.

## 10. Final artifact and verification ledger

Final declared root `SECURITY_SCANNER_DIR=... pnpm check` **passed** format, lint, architecture, typecheck, 2,035 workspace tests, 130 infrastructure tests with zero skips, build and all contract checks. Its workspace test run reused 33/37 Turbo tasks; build reused 10/13 tasks. This declared root check does not include the separately recorded failing Bot integration/legacy preview or blocked Gitleaks gate; the complete release gate remains held.

Two actual runs of `infra/release/build.mjs` with `VITE_KAHROBA_RUNTIME=true`, the exact existing staging origins and `https://web.telegram.org` frame ancestor produced **identical complete manifests**, including all four immutable image references:

- Base HEAD: `11c2a53036b6cb4bce14cc040a95e31a208e592c`, `sourceDirty=true`.
- Source snapshot: `b73440ce332aea8cad80b601c87356ee62dca80c3ce9c0e9056bb4ca5debcaab`.
- Build input: `e5c94caa0d4683a837fc0c8871c697a544ac3531734145d822914aa780dfccbf`.
- Lockfile: `15003c3327b027641154dbeddd283f3a2bc50166fc3f4af4b66cf4e8bdac95ed`.
- Dockerfile: `448a8066aa0f5a7908d8e2eac66760f746134bd488f548b6436b70ec056de522`.
- Private Web build feature: `kahrobaPrivateRuntime=true`; server activation is separate and unperformed.

All references use `hambazi-candidate/<role>:11c2a53036b6cb4bce14cc040a95e31a208e592c-e5c94caa0d4683a8@sha256:<digest>`:

| Role   | Immutable manifest digest                                          |
| ------ | ------------------------------------------------------------------ |
| API    | `6430f391f82de368886603b4b6d843826111ab2ba948cb27e89892a1018b99a0` |
| Bot    | `5f7fd7210ebc36d171d58a464f2a3772106028e1475a0a440ac11d0fbd7762af` |
| Worker | `6701cbac9c157ffb36489123679d1be3ca07ae8f9e2e87ea0d38c92e38c9918c` |
| Web    | `cd973e6e82a3a342fad8bb120a60cf98a71db2fc65dc2ab84089aad1d461c89c` |

Manifests are at `/home/mehdi/.cache/hambazi-kahroba-k4a-release-{a,b}/images.json`; the retained review copy is `test-results/kahroba-k4a/artifacts.json`. The scan is `application-scan.log` plus the builder's `images.json.scan.json`. Container builds never pushed or deployed images. This reproduction reused BuildKit cache and verifies identical packaging for unchanged inputs; it is not an independent toolchain rebuild with all caches removed.

`infra/release/scan.mjs` scanned all four exact new app images with pinned Trivy and fresh normal-policy advisory metadata: **zero HIGH/CRITICAL/UNKNOWN**, one visible allowed Moderate zlib `CVE-2026-85091` in each. Together with the two local data images and two exact local historical ingress/ACME replicas, eight local scans pass existing policy. Ingress/ACME have zero findings. These replicas are not verified as currently installed target images; no target scan or timer renewal is claimed.

Four network-none, read-only, UID-1000 packaged smokes passed at **2026-10-13T08:33:36.316Z**: API loads all three pinned game adapters and the identical required MIT attribution; Worker loads consumer/processor/rebuild modules with Kahroba dormant by default; Bot's packaged entry exists; Web serves its actual security/no-store headers, private readiness and all seventeen WebPs with exact hashes and MIME types. This is package/static smoke; actual multiplayer was tested through host process entry points and disposable services, and native Telegram remains pending.

Final read-only TLS probes at **2026-10-13 08:37:14 UTC / 12:07:14 Tehran** again returned Web 200 and private Kahroba 404. They do not verify interior services or containment. Final Gitleaks scan still reports one history and one current finding across 925 candidate files, blocked; no finding was suppressed. The recorded staging deadline remains 13:18:23 UTC / 16:48:23 Tehran, with no renewal performed.

After the two equal builds, only this report was updated with final verification outcomes; implementation inputs are frozen at the recorded candidate snapshot. A clean authorized source revision/rebuild is still required for staging controls. Exact K4A source inventory is **20 created / 31 modified** files above. No new runtime dependency, version pin or migration was introduced.

**STOP at K4A. Approve Phase K4B restricted staging deployment?**
