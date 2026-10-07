# ADR-045: Initial user peak and capacity-test scope

- **Status:** Accepted; OD-001 MVP targets fully approved on 2026-10-05
- **Owner:** HamBazi owner
- **Date:** 2026-10-05

**Acceptance update (2026-10-07):** [ADR-048](048-mvp-capacity-acceptance.md)
supersedes the requirement to meet performance/staging targets before MVP 17C
completion. These workload values remain approved future validation targets,
not measured guarantees. Production-like capacity/soak acceptance is deferred.

## Context

The owner resumed Phase 17C on a temporary laptop server and specified an initial
peak of 1,000 users, increasing as the product develops. The architecture requires
twice the approved peak and a minimum two-hour soak. Active Match count and game
commands per second are independent OD-001 inputs and have not been supplied.

## Decision

The owner explicitly confirmed **1,000 concurrent users**, **200 active Matches**
and **50 gameplay commands/second** as the OD-001 MVP normal targets. The 2x stress
workload is **2,000 concurrent users**, **400 active Matches** and **100 gameplay
commands/second**. This completes OD-001's initial MVP workload decision; these
are acceptance inputs, not measured capacity guarantees or permanent limits.

The earlier provisional concurrent-user interpretation and missing Match/rate
fields are superseded by this explicit owner clarification. Normal-load latency
and reconnect approval is recorded separately in ADR-046. A successful idle
connection probe cannot pass the gameplay/load/soak gate.

## Alternatives

- Treat 1,000 as registered accounts: does not define concurrent test traffic;
  apply this interpretation only if the owner clarifies it.
- Infer active Matches and command rate from CCU: rejected because idle users,
  table sizes and turn frequency vary independently.
- Fix the initial target permanently: rejected; later growth requires a revised
  workload decision, sizing and repeated evidence.

## Consequences

The disposable fixture can request up to 2,000 clients with explicitly reported
transport headroom. Linux loopback clients use distinct bound source addresses
and retain real authentication and its existing 300/IP/minute and 30/identity/
minute limits. This does not measure shared NAT authentication throughput.
Fixture quotas do not change production quotas or the public laptop runtime.

OD-001 is resolved for this MVP target. Final hosting, the remaining OD-007 policy,
production-like acceptance and at least two hours of real game load still need
evidence before 17C completion. All remaining implementation phases are now
authorized in dependency order; their operating decisions and acceptance evidence
are not implied by that authorization.
