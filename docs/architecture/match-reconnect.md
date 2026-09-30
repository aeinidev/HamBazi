# Durable reconnect and takeover boundary

Phase 13A implements `createMatchReconnectPort` through the public Matches
surface. It is opt-in and server-only. ADR-027 records the owner-approved
multi-socket policy. The lease factory itself does not start transport or queues. Phase 13B adds the
opt-in Presence, gateway and Worker integration described below.

## Calls and authority

The factory requires the database, an injected clock and a complete versioned
policy `{schemaVersion: 1, leaseMs, graceMs, maxConnections}`. It pins the policy
on first use for an ACTIVE Match. There are no production defaults.

| Port         | Trusted input                                                            | Result                                                                             |
| ------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `connect`    | Match/player, fresh server connection UUID, authenticated session expiry | Adds one lease and advances epoch; duplicates never extend expiry                  |
| `renew`      | Same connection identity and authenticated expiry                        | Extends only a live unclosed lease, capped by session expiry                       |
| `disconnect` | Server connection identity                                               | Closes its lease; starts grace only if no valid lease remains                      |
| `reconcile`  | Match/player                                                             | Detects crashed/expired connections and returns a fresh guarded timeout descriptor |
| `timeout`    | Versioned Match/player/epoch/stateVersion/deadline descriptor            | Atomically replaces an expired human seat, or returns a no-op                      |

Every method accepts optional trusted `requestId`/`traceparent` as its second
argument. The validated correlation is copied to committed outbox wakeups.
No observer receives payloads. Errors use the existing stable error envelope.

Connect/renew callers must authenticate the current session, bind player identity
and expiry from that session and verify the live Match subscription. Never expose
these lease DTOs directly to clients or accept client-selected connection IDs.
Renewal after expiry requires a new authenticated connection identity. Closing
an old connection cannot close a new one. Revocation must stop renewal and close
the affected lease; lease expiry bounds a missing callback. Calls admitted before
revocation are not retroactively undone, consistent with the existing session ports.

Only ACTIVE Matches accept new lease operations. Presence registers previously
subscribed sockets on their next authenticated heartbeat after activation; the
Worker reconciles never-connected active seats. FINISHED/TERMINATED Matches and replaced humans
produce no new lease or transition writes. Unknown membership is denied.

## Transaction and recovery invariants

Each operation holds the existing Match row lock. Lease renewal leaves engine
state, stateVersion and event sequence unchanged. New connections advance epoch;
connection/disconnect/takeover transitions commit their seat changes, Match
checkpoint, restricted audit event, processed-command checkpoint and state-free
outbox wakeup atomically. Existing resync can map every new audit sequence to its
stateVersion and returns only invalidations and recipient-safe snapshots.

Grace begins at the final lease end (or activation for a never-connected seat).
Reconciliation after a crash uses that original timestamp, even when the deadline
is already overdue. Intervening gameplay invalidates expectedStateVersion, so
reconcile and schedule a fresh descriptor without changing the deadline. Every
stale/early/duplicate timeout is a no-op. Best-effort queue removal is not required
for correctness. A reconnect that commits before takeover can win after the wall
clock deadline; after takeover no connection can restore human control.

Takeover preserves the engine snapshot/deadline and changes only the durable seat
agent/status/replaced timestamp plus audit/checkpoint/outbox. Existing human
command authorization denies the seat, and existing resync downgrades to the exact
SpectatorView. The separate trusted automation port makes bot moves; the reconnect port does not.

## Migration, grants and rollback

Deploy additive migration `202609290003_match_reconnect` and the permissions file
before enabling this factory. Existing Match/seat insert shapes remain valid;
policy and deadline are nullable, and no existing row is backfilled. The lease
foreign key binds an existing seat. A closed lease cannot reopen, identity/expiry
cannot change, and a pinned reconnect policy cannot be replaced.

API may create/read leases and update only lease expiry/closure. Worker may read
leases but cannot create, renew or delete them; it invokes Matches ports for
reconciliation and takeover under its existing Match write grants. Other modules
cannot access the lease delegate. Neither runtime role may delete tombstones.
No automatic lease or audit retention policy is chosen.

Rollback before activation disables the opt-in factory and leaves expanded schema
in place. Once takeover has been enabled in 13B, retain a compatible worker until
all affected active Matches finish; reverting to a release without bot automation
could stall replaced seats. Never undo replacement flags or reset deadlines to
roll back. Preserve one-release schema overlap; no destructive down migration.

## Verification and limits

The isolated PostgreSQL/Redis harness includes two-client multi-socket and
reconnect/takeover races, duplicate operations, expiry/session bounds, version
refresh without deadline extension, atomic rollback, privileges, spectator privacy
and resync checkpoints. It compares lease rows together with Match data across a
real PostgreSQL restart. Unit tests cover strict inputs and safe failures.

Heartbeats incur database writes and contend briefly with gameplay. Runtime
heartbeat intervals must fit within the configured lease duration; no production
values or capacity claim is selected. The Phase 13B suites additionally exercise queue reconstruction, worker retries,
actual crashed-node transports and automated bot/timer play. There is no declared gameplay E2E script
or configured staging environment. Phase 7C, live activation and launch gates
remain unchanged.

## Phase 13B transport composition

Construct `createPresencePort` from Matches reconnect and resync ports. Supply it
as the optional gateway `presence.port`, with explicit `heartbeatIntervalMs`,
`heartbeatTimeoutMs` and `leaseMs`, and enable the existing `delivery` dependency.
Use the same lease duration as the configured/pinned policy. The transport requires
interval + timeout < lease; deployments must preserve this inequality for every
active pinned policy, including older Matches. No production values are selected.

The gateway generates a fresh Presence session for each authenticated socket.
Membership-authorized subscription registers that socket and emits the existing
recipient-safe `match:snapshot`, requiring the existing sequence acknowledgement.
Clients must install their snapshot listener before sending `match:subscribe`.
There are no new client authority fields or changed v1 acknowledgement schemas.
The existing `presence:ping` also renews subscribed leases after authentication.
Engine.IO **received pongs**, rather than outbound pings or an idle socket flag,
trigger periodic reauthentication and renewal. Revocation, expiry, failed lease
renewal or missing snapshot acknowledgement closes the transport. Pending
subscriptions are registered on the first healthy heartbeat after activation.

Per-socket work is serialized. Disconnect cleanup follows previously accepted
work, including an uncertain connection commit. Shutdown stops admission, drains
work, closes transports and waits for queued disconnect cleanup. A lost process
cannot perform cleanup; PostgreSQL lease expiry remains authoritative. Another
node's healthy socket continues renewing independently. Returning replaced users
subscribe normally but receive only the current SpectatorView and create no lease.

An optional `cancelTimeout` callback receives a pre-reconnect descriptor after a
successful reconnect. It can invoke the queue producer's `cancel` with a
`DISCONNECT` job. Failure to remove an active, absent or unavailable job is ignored;
epoch/version/deadline checks decide authority. This optimization is optional and
requires no API-to-Worker dependency.

## Worker jobs, recovery and engine execution

`createMatchAutomationPort` is a trusted Matches-only port exposing `recover`,
`plan` and `execute`. `recover` scans ACTIVE Match IDs in ascending UUID order with
an exclusive cursor and a validated page size of 1–100. `plan` reads the pinned
adapter and seats under the Match lock; it returns only human member IDs and an
automation descriptor. No internal snapshot, private view or command leaves the
port. `execute` uses the existing atomic writer and finish/outbox path. It checks
status/version and, for bots, seat type/connection epoch under that lock. The
pinned adapter checks engine revision and deadline. Stale/early/duplicate jobs
produce no events, receipts, version increments or outbox writes.

Coup projects exactly PlayerView before invoking its existing bot policy. Due
engine timeouts take precedence over bot moves. A queued bot move that crosses
the engine deadline becomes a no-op; recovery schedules the timer. Reconnect and
worker restart never reset engine deadlines. Full persisted transitions retain
the same replay, result mapping and recipient projection paths as human commands.

`startMatchAutomation` owns the separate `match-automation-v1` BullMQ queue under
`hambazi:jobs:<namespace>`. It does not compete with the realtime outbox consumer.
Version-1 `DISCONNECT` and `AUTOMATION` payloads contain only guarded descriptors
and optional validated correlation. A recovery-origin request ID is generated
when scheduling; retries carry it into committed outbox events. Stable descriptor
hashes deduplicate concurrent producers independently of correlation. Delay is
computed from the **original** persisted deadline; overdue work is immediately due.
Attempts (1–10), exponential backoff, scan interval, `drainTimeoutMs` (100–60000 ms) and batch size are explicit,
validated inputs. Job errors and event callbacks contain only fixed safe messages.
Completed/exhausted jobs are removed; the next scan can recover exhausted work.

The non-overlapping loop processes one bounded page per interval and wraps after
the final page. It reconciles human seats, schedules returned timeouts, then plans
engine work against the latest Match version. A failing Match does not block the
remaining page. Different workers may scan the same rows: queue identities and
transactional guards make duplicate work harmless. A timeout invalidated by
another seat/game write is rescheduled on a subsequent pass without extending
its grace. Recovery latency therefore depends on active Match count, page size,
scan interval, database/queue health and retries; it is not a production SLO.

The existing `startWorker` accepts optional resilience composition (registered
pinned games, reconnect policy and explicit queue settings). It constructs ports
using Worker credentials and drains the loop/consumer before disconnecting the
database. Shutdown stops fetch/scan admission, waits for admitted application
work up to the explicit drain deadline, then closes Redis connections even during
an outage. Unacknowledged jobs can be retried safely. A drain timeout is reported
as a failure; the owning runtime still closes its database pool. Independent
callers must also close their owned dependencies after a failed drain.
`startMatchAutomation` can also be composed independently. Runtime main
entry points do not enable this feature implicitly. Production catalog and 7C
activation gates remain unchanged; do not enable takeover without a compatible
bot/timer Worker and all active pinned adapters.

## Failure and recovery procedure

- On API-node loss, leave durable leases untouched; surviving nodes continue
  renewal. Recovery starts grace at the last original lease expiry.
- On Redis loss or deletion of this queue, retain PostgreSQL state. Restore the
  queue service and restart the worker; its paginated scan rebuilds work. Never
  rewrite disconnect/engine deadlines or reset epochs as a recovery shortcut.
- On database failure, transport renewal fails closed and jobs retry with safe
  errors. Once storage returns, recover from persisted leases and deadlines.
- For an incompatible active engine, restore its pinned adapter. The worker
  reports failure and continues scanning other Matches; do not reinterpret state
  using a newer engine or ruleset.
- For maintenance, drain API sockets and Worker jobs before database shutdown.
  Best-effort cancellation is not evidence that takeover was prevented. Inspect
  committed seat status and versions through Matches ports.
- During rollback, keep compatible version-1 job handlers and pinned adapters
  until queues/active Matches finish. Never undo committed Bot replacement.

No gameplay staging E2E script/environment is available. Production duration
selection, capacity/reconnect-storm/soak evidence and retention remain separate
release gates. Existing Redis Socket.IO membership handles ephemeral transport
routing; durable lease metadata alone decides seat ownership.
