# Durable reconnect and takeover boundary

Phase 13A implements `createMatchReconnectPort` through the public Matches
surface. It is opt-in and server-only. ADR-027 records the owner-approved
multi-socket policy. No gateway, heartbeat loop, BullMQ handler or bot runner is
activated by this factory; those are the explicit Phase 13B gate.

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

Only ACTIVE Matches accept new lease operations in this foundation. 13B must
register already-subscribed sockets when a Match becomes ACTIVE and recover
never-connected active seats. FINISHED/TERMINATED Matches and replaced humans
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
SpectatorView. Engine automation remains 13B: this port does not make bot moves.

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
values or capacity claim is selected. Redis presence, queue reconstruction,
worker retries, actual crashed-node transport tests and automated bot/timer play
are Phase 13B acceptance requirements. There is no declared gameplay E2E script
or configured staging environment. Phase 7C, live activation and launch gates
remain unchanged.
