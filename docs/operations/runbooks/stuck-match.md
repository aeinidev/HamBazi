# Stuck Match and reconnect failure

**Owner:** Backend on-call. **Severity:** SEV2 for an isolated stuck Match; SEV1 for
widespread command failures, exploit or inconsistent durable state.

1. Correlate safe Match/action IDs, stateVersion, fixed error codes and server time.
   Check postgres/redis readiness, command latency/conflicts, delivery failure,
   connection events, queue/outbox lag and enabled automation. A slow client or
   subscribe failure is not proof that the durable Match is stuck. Do not fetch or
   paste hidden state/event payloads into logs, dashboards, Sentry or client tools.
2. Verify authorized PlayerView/snapshot and lastEventSeq through existing owning
   resync/membership ports. Retry the original intent/actionId and expectedVersion
   for ambiguous acknowledgements. A stale expectedVersion calls for a fresh safe
   snapshot, not resetting state_version, rewriting events or bypassing the writer.
3. If disconnected, inspect guarded lease/timeout processing and recorded reconnect
   or Bot takeover counts. Delayed jobs retain version/connection-epoch guards;
   committed REPLACED_BY_BOT stays spectator-only. Do not manually restore a seat,
   change hidden cards or bypass pinned engine/state/ruleset versions.
4. Remedy the underlying dependency/queue/release problem using its runbook. If the
   Match cannot safely continue, obtain explicit separate operator authorization
   to terminate that Match. Record the incident reason outside the telemetry payload.
   There is no public Admin route or authorized recovery CLI in this repository.
5. In the approved trusted composition, the existing public Match processing port's
   `lifecycle` accepts `{ schemaVersion: 1, matchId, actionId, expectedVersion,
operation: "TERMINATE" }`. The composer supplies the current registered/pinned
   game adapters, explicit clock and existing public Users port. Acquire current
   metadata through approved owner access, never a client-supplied identity/version.
   Reuse the same actionId for retry and evaluate its machine-readable outcome.
   The normal atomic row lock/version/idempotency writer commits state/events/outbox.
   Do not issue an ad-hoc UPDATE or delete records. A conflict requires renewed
   metadata/review, not automatic termination with an invented version.
6. Confirm TERMINATED and increasing stateVersion/seq using authorized safe reads;
   preserve append-only events, commands and outbox. TERMINATED grants no completed
   plays/wins. Check remaining Matches and asynchronous delivery/reconciliation;
   reopen admission only under the incident commander's decision and 7C gate.

Local evidence: integration tests cover lifecycle termination/idempotency, rollback,
version races, delayed guards, safe reconnect views and Bot takeover. An authorized
Admin RBAC/MFA/network route and real incident-operator drill remain 17A/18B work;
this runbook does not turn a trusted orchestration port into a public API.
