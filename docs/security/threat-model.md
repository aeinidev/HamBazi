# HamBazi security review — Phase 17A

Reviewed on 2026-10-03 against `bac9c3c` plus the Phase 17A1/17A2/17A3P/17A3 candidate. This is an
implementation review with bounded local evidence, not a penetration-test or
public-release approval. Architecture sections 16/21/22 and accepted ADRs remain
authoritative. Follow-ups are in [the risk register](risk-register.md).

## Assets and trust boundaries

| Asset / boundary                      | Owner and current protection                                                                                                                                                                                | Remaining evidence                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Telegram identity → Auth              | Raw bounded initData, HMAC constant-time comparison, freshness, minimal verified projection; `auth/infrastructure/telegram-hmac.ts`                                                                         | Live controlled Telegram/WebView ingress                                               |
| Session → Users/application ports     | Local-key HS256 allowlist; durable metadata/expiry/revocation/ACTIVE eligibility; ADR-014; explicit pre-auth admission; ADR-036                                                                             | Production quota/ingress approval                                                      |
| Bot webhook → private API             | Verified TLS/secret, strict update DTOs, scoped rotating service credential, direct private peer checks, receipt/lease dedupe; ADR-016                                                                      | Real private ingress, certificates and webhook smoke                                   |
| Browser → REST                        | Bounded requests, strict owner schemas, bearer-derived identity, known-origin CORS, proxy IP/CIDR trust, HTTPS production guard; guarded integrity-pinned SDK and generated/enforced local CSP, ADR-037/038 | Approved production origins/edge and real Telegram/mobile WebView evidence; OD-002     |
| Engine.IO/Socket → application        | Strict handshake, Redis IP/user admission, durable bound identity/expiry, recipient rechecks, bounded connections/work/subscriptions; ADR-025/026/036                                                       | Production quotas, edge policy and load/reconnect/soak evidence                        |
| Match writer → PostgreSQL             | Matches-owned locked single writer; expectedVersion and actor-bound actionId, atomic state/events/receipts/outbox; ADR-023                                                                                  | Broader repeated fault/release suites in 17B                                           |
| Engine → public player/spectator view | Deny-by-default projection; no other hands/deck/private continuation; irreversible takeover role downgrade                                                                                                  | Existing deterministic/golden/property tests remain mandatory                          |
| PostgreSQL → outbox/Redis/BullMQ      | Post-commit at-least-once wakeups, state/text/token-free jobs, fenced claims, idempotent consumers                                                                                                          | Trusted private network/ACL and deployment drills                                      |
| Chat → persistence/browser            | Current member read, player-only send, plain text, NFC/resource limits, atomic content-free wakeup, escaped rendering; ADR-029                                                                              | OD-005 final retention/moderation/age                                                  |
| Application → Pino/metrics/Sentry     | Shared allowlist, fixed bounded dimensions, manual fixed HTTPS reporting, no raw errors/payloads; ADR-031/033                                                                                               | Actual export access/retention and monitoring deployment                               |
| Operator → admin/trusted ports        | Public mutation routes remain absent; separate MFA/RBAC/private-access/append-only-audit design, ADR-039; trusted terminate/rebuild ports remain composition-only                                           | Owner provider/role/network decisions and verified 7C implementation before activation |
| Registry/Git → installed code/images  | Frozen integrity lockfile, strict policy, exact image digests, pinned scanner gates and hash-locked local derivative; ADR-034/035                                                                           | CI installation in 18A, app images/provenance in 18B                                   |
| Legacy local PostgreSQL → new image   | Refuse physical adoption; marker only after verified fresh UTF8 bootstrap; logical transfer preserves source; ADR-035                                                                                       | Authorized real-data transfer, custom locale/extension and full Compose connectivity   |

## Attacker operations and controls to verify

| Attempt                                                                                     | Required denial/effect                                                                          | Current evidence / next review                                                                                                       |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Forge userId, Telegram identity, bearer/key source or Bot service scope                     | Identity established only by Auth; no client authority                                          | Auth HMAC/session/service/onboarding adversarial suites                                                                              |
| Access another room or start as non-host / exceed capacity                                  | Owner checks current member/host/state/capacity                                                 | Rooms domain, HTTP and real race suites; 17A2 matrix consolidation                                                                   |
| Reuse a command, change its intent, use stale version or wrong turn                         | At-most-once durable effect or stable conflict                                                  | Matches/Engine replay/idempotency integration                                                                                        |
| Cancel while match commits / replay old reservation                                         | One durable winner; no guessed Redis compensation                                               | Matches admission and Matchmaking races                                                                                              |
| Reconnect after irreversible Bot takeover                                                   | Spectator-only public view and no human command                                                 | Lease races, membership/resync, Coup information-flow tests                                                                          |
| Read hidden state through snapshots, catch-up, jobs, errors or telemetry                    | Recipient projection and fixed scalar exports                                                   | Coup view tests, resync/integration and Observability hostile-input tests                                                            |
| Send markup/bidi/control payload or overwhelm Chat                                          | Strict plain-text validation, membership/rate denial                                            | Chat domain/Socket/PostgreSQL/browser suites; final product policy gated                                                             |
| Exhaust CPU/DB through invalid HTTP or connection/event floods                              | Admission before expensive work; bounded queue/counters                                         | Explicit HTTP/Engine.IO/user budgets, two-node Redis tests and queue/subscription/drain cases; [17A2 matrix](transport-admission.md) |
| Smuggle absolute-form targets around middleware                                             | Both canonical and absolute-form targets reach scoped middleware                                | Patched Nest/Fastify raw-TCP regression in 17A1                                                                                      |
| Inject credentials through redirects, URL/storage or mock-preview bundle                    | Error redirects, memory-only token, production preview exclusion                                | Real-SDK native storage/legacy/reload/logout/failure tests and production bundle checks under CSP, ADR-037/038                       |
| Run inline/eval scripts, load an unreviewed SDK tag or exfiltrate through resources/framing | Exact SDK hash/SRI, self scripts, exact connect/frame origins, denied attributes/eval/resources | Built Chromium denial tests, polling/WS upgrade, permitted Telegram ancestor styling; actual edge/WebView evidence remains external  |
| Leak secrets through scanner logs or suppress findings                                      | Safe aggregate output; verified tools; no ambient ignore config                                 | 17A1 scanner assessment, integrity, snapshot and real generated-canary tests                                                         |
| Activate a game or call trusted termination with a player session                           | No public operator route; separate future admin authority                                       | Actual HTTP denials with valid player/service-shaped bearer; ADR-039 design only, 7C gate retained                                   |

## Scope and decisions

The 17A2 review did not redo completed implementation. The subsequent 17A3
assessment stopped on an earlier Web bootstrap privacy defect: the real official
SDK cached raw initData before HamBazi ran, outside the existing synthetic tests.
The owner explicitly authorized the narrow 17A3P correction, implemented under
ADR-037 with real-SDK and built-production privacy evidence. The owner then resumed
17A3: ADR-038 adds a generated browser policy, actual enforced-CSP compatibility
and denial checks, while ADR-039 supplies the separate administrative design.
No operator mutations were implemented and no other earlier phase was reopened. Required product and
transaction authorization remain in their existing modules; no business logic
moves to adapters or Shared. Deployment/external network controls require OD-002;
privacy/safety and Coup rights require OD-005/008. No numeric production quotas,
admin identity provider, final retention, capacity target or launch acceptance is
selected here. Review this model during 7C/17B/18B and before Phase 19 launch
assessment. Local browser enforcement is not deployed edge or real WebView evidence.
