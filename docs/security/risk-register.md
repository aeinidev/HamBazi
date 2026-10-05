# Security risk register — Phase 17A

Date: 2026-10-03. No Critical/High vulnerability is accepted or suppressed.
“Closed locally” means the cited candidate checks passed, not that production is
safe. Review remaining items at each owning phase and before public release.
[Threat model](threat-model.md) · [scan policy](scanning.md).

| ID     | Finding / impact                                                   | Status and evidence                                                                                                                                                                                                                                                                                                                                   | Owner / required gate                                                                                                            |
| ------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| SR-001 | Known npm supply-chain advisories                                  | Closed locally: full audit initially three High/five Moderate; patched candidate reports zero in every severity. Aligned Nest 12.0.3, Fastify 5.12.5, brace-expansion 5.0.12 and fast-uri 3.1.8/4.1.5; frozen install and regression gates                                                                                                            | Tech; fresh audit in 18A/release                                                                                                 |
| SR-002 | Local service image vulnerability exposure                         | Closed locally: approved Redis Alpine security update and locked PostgreSQL Alpine derivative report zero in every severity. Fresh pinned scan, 218 integration cases, 29-table restore and cross-base transfer pass; [ADR-035](../adr/035-local-service-image-remediation.md). No exception                                                          | Tech; reproduce build and fresh scans at each change/release; 18B production inventory                                           |
| SR-003 | Invalid HTTP/token/Engine.IO floods before expensive authorization | Closed for local implementation: explicit Redis IP/user budgets, canonical trusted peers, production profile/HTTPS gates and bounded HTTP/transport/authentication work; shared two-node quotas and outage cases pass. No production values selected; [ADR-036](../adr/036-transport-admission-and-bounded-work.md)                                   | Tech/owner; approved numeric policy and ingress before deployment; 17B/17C capacity evidence                                     |
| SR-004 | Queued Socket intents / subscriptions under sustained abuse        | Closed for local implementation: bounded per-socket/process work and subscriptions, coalesced heartbeat, reserved disconnect cleanup; malformed/unacknowledged events admitted before DB work. Accepted commands survive saturation/drain                                                                                                             | Tech; 17B fault/race and 17C capacity evidence; explicit deployment work bounds                                                  |
| SR-005 | Static Mini App browser/edge policy                                | Closed for local implementation: generated exact-origin CSP/headers, SDK hash/SRI, no inline/eval scripts, interpreted browser validation, verified build/preview artifact and real browser resource/framing/HTTP/WS checks; [ADR-038](../adr/038-mini-app-browser-policy.md). No edge deployment is claimed                                          | Tech/owner; approve origins and apply/verify headers at OD-002/18B edge, including real Telegram/mobile WebViews                 |
| SR-006 | Privileged operations / live game activation                       | Design delivered, implementation gated: separate MFA/RBAC/private access/append-only audit, owner-port transactions and retry/outcome recovery in [ADR-039](../adr/039-administrative-security-design.md). Actual HTTP tests confirm operator mutations remain absent for player/service-shaped credentials                                           | Tech/owner; provider, roles, ingress and session/audit policy review; verified 7C implementation before activation               |
| SR-007 | Chat/profile/result/event retention and user safety                | Open owner decision: temporary ADR-029/030 baselines do not select final erasure/export/retention/moderation/age policy. Growth remains unbounded by approved deletion policy                                                                                                                                                                         | Product + Legal; OD-005 before public beta                                                                                       |
| SR-008 | Coup name, rules and asset rights                                  | Open owner decision; provisional engine rules/versioning do not constitute clearance                                                                                                                                                                                                                                                                  | Product + Legal; OD-008 before public release                                                                                    |
| SR-009 | Capacity, flood recovery and external operational security         | Unproven: no final peak/provider/SLO, staging ingress, partition/reconnect-storm/soak or authorized admin drill                                                                                                                                                                                                                                       | Tech + Product; OD-001/002/007, 17B/17C and 18B                                                                                  |
| SR-010 | Secret exposure in source/history/scanner reporting                | Closed for reviewed local candidate/reachable refs: no secret matches after one exact normative prose false-positive exception. Pinned tool/canary/output tests pass. This excludes ignored runtime files, remote un-fetched refs and unreachable objects                                                                                             | Tech; fresh full-checkout scan in 18A/release; secret-manager/rotation evidence at deployment                                    |
| SR-011 | Hidden game/chat/auth payload entering client or telemetry         | Local transport and browser matrix verified: recipient expiry/membership/takeover projections, Coup view/replay and safe telemetry regressions, SDK launch/reload/logout/error privacy under enforced CSP. Browser reports/referrers remain disabled; Admin is design-only. External collector access/retention is unproven                           | Tech; 7C operator privacy/grant tests, OD-002/005 and monitoring activation                                                      |
| SR-012 | Hosted enforcement and production application-image acceptance     | CI implemented locally in 18A; 18B1 adds four non-root local application candidates and real CI build/scan/runtime gates. Hosted required-check settings, publication, signed provenance and actual production/staging image acceptance remain unverified/deferred; local candidates do not authorize release                                         | Tech; verify hosted enforcement after authorized publication, reviewed immutable deployment inventory and 18B staging acceptance |
| SR-013 | Local Compose host connectivity on the tested Docker version       | Unverified: disposable image tests use separate loopback-published bridges. The tested internal network suppressed host port publication; existing Compose remains internal. No networking change or full Compose host-connectivity claim                                                                                                             | Tech; separate local infrastructure review before relying on host-run clients; OD-002 for deployment                             |
| SR-014 | Official Telegram SDK persists/restores raw launch credentials     | Closed for local implementation: guard precedes execution, deletes accessible legacy caches and blocks native launch-cache reads/writes; integrity rejects changed SDK bytes. Actual-SDK launch/reload/logout/error tests pass against development and built output, now also under enforced CSP; [ADR-037](../adr/037-telegram-bootstrap-privacy.md) | Tech; SDK updates require real-SDK privacy/CSP gates; controlled HTTPS/mobile WebView evidence under OD-002                      |
| SR-015 | Browser policy artifact differs from deployed headers/origins      | Deployment gap: local build/preview verify the complete artifact and SDK pin; public policy environment/.env inputs affect Turbo cache. Shipping JSON alone does not apply CSP, and loopback-test artifacts must not deploy                                                                                                                           | Tech/owner; 18B actual edge/fallback/error headers, profile, origin inventory, HTTPS/WSS, access-log redaction and cache checks  |

## Remediated npm advisories

- Nest path-scoped middleware absolute-form bypass: [maintainer advisory GHSA-9c5c-9qcx-q35q](https://github.com/nestjs/nest/security/advisories/GHSA-9c5c-9qcx-q35q). Maintainer recommends 12.0.3; raw-TCP regression denies both request forms.
- Fastify HTTP/2 trailer exception: [maintainer advisory GHSA-4mh8-r7rc-xpvc](https://github.com/fastify/fastify/security/advisories/GHSA-4mh8-r7rc-xpvc); patched 5.12.5.
- fast-uri host case normalization and mailto field-name injection: [maintainer advisories](https://github.com/fastify/fast-uri/security/advisories); compatible patched major lines are independently pinned.
- brace-expansion recursive/quadratic denial of service: GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p and GHSA-q2hr-2g5m-vwhr; pinned 5.0.12 covers all initial findings.

No “not reachable” assessment substitutes for remediation or accepts a known
High/Critical issue. Future risk decisions must record exact advisory/artifact,
owner approval, evidence, expiry and planned correction. Changing any pin
requires new frozen-install/audit and compatibility evidence; do not regenerate
wire baselines or relax install/scan policy to make a gate pass.

## Local-image evidence and guarded transition

A fresh schema-2 DB and verified Trivy 0.74.0 scanned both exact Compose images.
The original PostgreSQL pin reported 16 Critical/105 High/10 Unknown and the
original Redis pin 3 Critical/60 High/2 Unknown package findings. Updating only
the digests to official rebuilt images of the same PostgreSQL 18.6/bookworm and
Redis 8.10.1/trixie versions reduced the combined result to **16 Critical, 150
High and 8 Unknown package findings**. Counts are per vulnerable package entry,
not unique CVEs, an exploitability verdict or evidence of application compromise.
The sanitized historical IDs/packages and DB timestamps remain in
[local-image-findings.json](local-image-findings.json). That result exited 1 and
stopped work pending a scoped owner decision.

The owner approved local remediation and locale/data/role compatibility checks.
[ADR-035](../adr/035-local-service-image-remediation.md) selects official Redis
8.10.2/alpine3.23 and a reproducible PostgreSQL 18.6/alpine3.24 derivative. The
derivative removes the vulnerable Go privilege-drop helper in favor of signed,
hash-pinned Alpine `su-exec`, and patches the HTTP/2 library. Both final digests
now report **zero findings at every severity**, with no ignores, VEX, risk
exception or reachability shortcut. The latest gate exits 0.

The exact image/bootstrap passes 218 existing DB/API/Worker integration cases
and the 29-table logical restore drill. The independent Debian-to-Alpine
rehearsal passes 17 legacy foundation cases, reconciles all 29 tables,
constraints, triggers and grants, checks Unicode/JSONB and least privilege,
and preserves source data. Repeated uncached builds reproduce the pinned local
digest on the documented Linux amd64 builder.

The new local UTF8/builtin `C.UTF-8` default is not a physical-volume migration
or a production locale decision. Legacy populated volumes are refused with exit 78. Real local data needs an authorized logical transfer into a different fresh
volume under [the runbook](local-image-transition.md); do not forge its marker,
delete its source or assume arbitrary collation/extension compatibility. Direct
HTTPS artifact fetching timed out in this environment; pre-provisioned archives
and the configured HTTPS proxy passed the same hash/signature/digest gates. Full Compose host connectivity,
other platforms/builders, image signatures and production deployment remain
unproven. 17A1/17A2 and the owner-resumed 17A3 have local evidence; parent 17A is
complete locally with the external risks and 7C activation gate retained.
