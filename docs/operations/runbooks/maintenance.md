# Exploit containment and planned maintenance

**Owner:** Backend on-call. **Severity:** SEV1 for suspected rule/hidden-data exploit;
SEV2 for planned interruption or telemetry collection failure.

1. Identify the environment, deployed immutable release and affected capability.
   Record fixed error codes, safe request/Match IDs and time window. Restrict access
   to incident evidence. Do not record private views, hidden payloads or secrets.
2. For a suspected exploit, stop new game admission immediately through the approved
   ingress/supervisor. The target behavior is Coup MAINTENANCE with matchmaking off.
   The current catalog remains unplayable, but has no dynamic mutation/Admin route.
   If a live environment later enables games without a reviewed per-game switch,
   contain the whole affected API admission path and drain its processes. Stopping
   only new matchmaking does not stop an exploit in an already ACTIVE Match.
   Do not improvise a database status update or enable a feature to test the exploit.
3. For planned work, confirm compatible artifacts/job handlers, DB health, active
   Match/socket counts and accepted-work budget. Remove the node from new ingress,
   then deliver SIGTERM using its approved supervisor. ADR-032 sets NOT_READY before
   stopping new requests/intents/claims. Allow the configured drain budget plus the
   supervisor margin; watch stopped/failed events and exit status. A caller deadline
   is a failure even if background work subsequently settles. Do not kill DB clients
   ahead of accepted work or delete shared queue schedules.
4. For telemetry collection failure, check scrape locality/configuration, fixed
   dependency probes, DB pool waiters and collection_success. A stale gauge is not
   a healthy zero. Reduce/stop the scraper if aggregate reads contribute to overload;
   disabling export does not change product authority. Do not expose raw diagnostics
   or turn on SDK automatic capture to debug the exporter.
5. Patch and test the exploit through a separately authorized implementation phase.
   Check pinned active engine/state/ruleset versions, safe views, deterministic replay
   and transactional/idempotent effects. Preserve event logs and outbox/commands for
   restricted audit. Termination of individual Matches uses the separate recovery
   approval in [Match recovery](stuck-match.md).
6. Reopen only after reviewed containment/repair, healthy dependencies, approved
   feature permissions and staging smoke. Verify absence of unexpected command
   failures and replay gaps; obtain the commander's decision before resuming traffic.

Local evidence: health/drain tests cover NOT_READY before admission stop, rejection
of new work, accepted handler/transaction/job settlement and failure deadlines.
No production exploit switch, ingress drain or live maintenance drill was executed.
7C and 17A/18B remain activation/authorization/deployment gates.
