# ADR-046: Phase 17C normal-load latency and reconnect targets

- **Status:** Accepted for the owner's 17C targets; OD-007 remains partially open
- **Owner:** HamBazi owner
- **Date:** 2026-10-05
- **Related:** ADR-045; architecture sections 1.4, 22 and 28.2

**Acceptance update (2026-10-07):** [ADR-048](048-mvp-capacity-acceptance.md)
accepts documented local performance exceptions for MVP 17C completion. The
targets below remain future optimization and production-like staging targets;
they are not declared met, and mandatory integrity/security gates are unchanged.

## Context

The owner approved the complete OD-001 workload and specific normal-load SLOs.
They explicitly excluded the same latency requirements from 2x stress acceptance
unless separately approved. The existing fixture incorrectly applied one latency
gate to stress/soak and conflated reconnect success with completing within a time.

## Decision

At **1,000 concurrent users, 200 active Matches and 50 gameplay commands/sec**:

| Measure                                               | Approved target |
| ----------------------------------------------------- | --------------- |
| REST complete-response latency p95                    | ≤ 300 ms        |
| Gameplay command acknowledgement latency p95          | ≤ 300 ms        |
| Committed event dispatch-to-all-recipient latency p95 | ≤ 500 ms        |
| Reconnect success rate                                | ≥ 99%           |
| Reconnect completion time p95                         | ≤ 5 seconds     |

Measure reconnect success and completion p95 separately. Record first-wave failures
even if later retries restore a client. Separate normal-load latency samples from
stress, intentional failures, setup and final reconciliation. At 2x workload,
prioritize correctness, recovery and stability; record all latency and offered/
accepted/missed traffic without enforcing normal-load latency SLOs. No new stress
latency threshold is approved.

The local driver measures command dispatch to every recipient's observed accepted
version. This is a conservative upper bound including command processing, rather
than isolated commit-to-fanout timing. Passing that stronger bound supports the
approved target; exceeding it does not alone establish a commit-to-fanout failure.
The report must disclose the measurement and retain that instrumentation gap.

This approval does not finalize availability/error-budget windows, alert routing,
all monitoring/coverage targets, backup/recovery or hosting policy. OD-007 is
partially resolved for the named 17C normal-load targets only. No product quota,
engine timeout, client contract, live activation or production release is changed.

## Alternatives

- Apply normal SLOs at 2x: contradicts the owner's explicit stress scope.
- Count only reconnects finishing within five seconds as success: conflates the
  99% success requirement with the separate p95 timing requirement.
- Treat loopback evidence as deployed production-like acceptance: does not prove
  the public ingress, Telegram WebView or operational environment.

## Consequences

Use the approved [MVP profile](../testing/capacity-profile.mvp.json). The fixture
first validates the normal workload and reconnect wave, then scales to 2x load,
failure/recovery and the minimum two-hour stress soak. Failed normal acceptance
stops before spending two hours on stress. Report schema version 2 separates
normal reconnect and stress latency scope; historical version-1 evidence remains
historical. Actual staging, remaining 7C/18B3/19 decisions and release gates remain
necessary. Later growth changes need a new owner workload/SLO record and retesting.
