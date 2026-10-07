# ADR-048 — MVP completion acceptance and deferred production performance

- **Status:** Accepted by explicit owner decision; completion evidence recorded in Phase 17C
- **Owner:** HamBazi owner
- **Date:** 2026-10-07
- **Supersedes:** the performance/environment requirements for **MVP Phase 17C completion** in ADR-045/046 and the implementation plan; their workload and production validation targets remain unchanged
- **Related:** ADR-023/024/027/036/045/046/047; architecture sections 1.4, 22 and 27.4

## Context

The owner explicitly directed completion of 17C under an MVP acceptance policy,
followed immediately by the next authorized phase. Remaining local latency,
reconnect timing, dispatch delay and throughput limitations are accepted MVP
limitations, with optimization deferred until after MVP completion. Open-ended
local performance tuning must stop. This changes phase acceptance, not measured
results, game semantics, security guarantees or authorization to activate staging.

The latest ordinary normal/stress diagnostic
`6131a2aa-8b2c-4692-8d2a-5ed5bc3cae5d.json` completes both offered-load windows
but fails stress catchup. Its interrupted terminal reconciliation covers
24,460 of 29,205 acknowledged commands. The remaining commands were not audited
before disposable teardown. This is an evidence gap, not proof of data loss or
proof of zero loss. Historical failed artifacts remain unchanged.

## Decision

Accept 17C as **Completed for MVP, with documented performance exceptions** only
after the current checkpoint passes the mandatory implementation gates below.
Use actual atomicity, concurrency, recovery, privacy and real-service reconciliation
evidence. A failed/partial large-capacity run does not become a passing run because
the acceptance policy changed.

| Mandatory gate                     | Required evidence                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Correctness and data integrity     | Locked, version-checked atomic state/event/receipt/outbox writes; contiguous event history and deterministic replay/result; rollback on failed writes                                                  |
| Idempotency and ambiguous outcomes | One effect for the original actor-bound action ID, including concurrent retries after a lost commit acknowledgement; no duplicate result/statistics application                                        |
| Authorization and isolation        | Current session/user, membership, host/capacity/state/turn checks; foreign and Bot-replaced actors denied; existing Serializable/owner boundaries retained                                             |
| Recovery                           | Durable PostgreSQL truth after restart, Redis/queue reconstruction and Worker failure; reconnect/timeout epoch guards and irreversible spectator return; accepted work settles before fixture disposal |
| Security and privacy               | Safe PlayerView/SpectatorView, validated inputs, distributed abuse controls, bounded work, safe diagnostics and existing scan/CI policy; no accepted security exception                                |
| Workload accounting                | Every acknowledged command in a completed correctness run has a matching durable receipt; final result and statistics reconciliation passes; unsent missed offers are separately counted               |

These are mandatory for the implemented MVP, not a promise that arbitrary load,
an untested production environment or every interrupted historical run passed.
No correctness or data-loss defect may be relabeled as a performance exception.
Known security findings still follow the unchanged security remediation/risk gate.

The following work is explicitly deferred after 17C completion:

| Deferred work                                   | Retained observation or target                                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sustained normal capacity/turnover              | Target 1,000 concurrent users / 200 active Matches / 50 commands/sec; latest window accepted 12,744 of 15,000 offers at 42.467/sec, with 2,256 busy misses and minimum 995 clients / zero active Matches during turnover |
| Sustained 2x capacity                           | Target 2,000 / 400 / 100; latest window accepted 13,461 of 30,000 offers at 42.165/sec including settlement, with 16,539 misses and minimum 1,994 clients / 202 active Matches                                           |
| Actual acknowledgement measurement/optimization | Normal target p95 ≤ 300 ms; current logical-intent p95 upper bound 2,000 ms includes setup/recovery/retries and is not an isolated RPC measurement                                                                       |
| Committed fanout measurement/optimization       | Target p95 ≤ 500 ms; current intent-to-all-recipient proxy p95 upper bound 5,000 ms does not isolate commit-to-delivery                                                                                                  |
| Reconnect backlog and timing                    | Normal 1,000/1,000 first-wave success, observed maximum 10,241.391 ms and histogram p95 upper bound 60,000 ms; the ≤ 5-second target did not pass. Stress first wave 1,200/2,000, with 800 failures                      |
| REST/staging SLO confirmation                   | Retain p95 ≤ 300 ms; latest local normal histogram upper bound 100 ms is not production-like acceptance or proof of sustained target population                                                                          |
| Production-like capacity/fault/soak acceptance  | Accurate normal/stress measurement, reconnect storms, fault recovery at target demand, complete receipt reconciliation and at least two-hour soak remain future validation                                               |

Normal SLOs remain targets at normal load; no equivalent latency target is added
at stress. Do not change timeouts, attempts, quotas, pools, workload targets or
SLO values to obtain completion. Keep the full capacity command's existing
performance/soak gates and all reports' `releaseApproved: false` unchanged.
17CT measurement work remains Pending and explicitly deferred, not implemented
or falsely completed. Remaining 17CQ performance investigation is closed for
this MVP scope with its unresolved observations retained.

Proceed to 18B3 without another generic phase-approval question. Its independent
owner decisions and environment prerequisites still apply: provider, region,
origins/access, backup/PITR/RPO/RTO/retention, final operating SLOs and secured 7C
activation are unresolved. Staging provisioning/activation remains fully deferred.
Assess the next phase and report its concrete blockers; this ADR supplies no
provider choice, deployment/publication, legal clearance or production launch approval.

## Alternatives

- Continue local performance tuning indefinitely: contradicts the owner's MVP priority.
- Declare the original production SLOs met: contradicts the measurements and missing staging evidence.
- Waive integrity/security/recovery checks: contradicts the explicit mandatory-gate policy and architecture.

## Consequences

The usable local MVP and portable preparation can move forward independently of
performance optimization. Capacity limits, reconnect failures and slower delivery
can affect user experience under larger load; accepted exceptions must remain
visible in handoff and production-readiness review. Production acceptance still
requires actual approved staging/recovery/security evidence and explicit owner
decisions. Local correctness probes do not replace those release gates.

See the [17C acceptance record](../testing/capacity.md),
[phase plan](../implementation-plan.md) and
[staging decision worksheet](../operations/staging-operating-decisions.md).
