# Phase 12A realtime contract and gateway

The API's `realtime` public surface exports `createRealtimeGateway` and the
generated v1 event catalog. `createHttpApplication` accepts this adapter's
dependencies as an opt-in input and attaches Socket.IO to its HTTP server at
`/v1/socket.io`, namespace `/v1`, using the same API process. The factory requires
Auth sessions, Rooms, Matchmaking, Match processing, Match membership, an
allowed-origin list, a clock and a distributed rate hook. It does not select
production rate budgets or start itself. The catalog is generated into
`docs/contracts/realtime.events.json`; `realtime.v1.baseline.json` freezes the
existing names, request schemas, handshake and acknowledgement framing.
`pnpm --filter @hambazi/api contract:check` fails on a breaking v1 drift.

| Event                                                            | Owner call                            | Result                                           |
| ---------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------ |
| `room:subscribe`                                                 | Rooms `read`                          | Member-only room snapshot and local subscription |
| `room:join`, `room:leave`, `room:start`                          | Rooms application port                | Durable command acknowledgement                  |
| `matchmaking:search`, `matchmaking:status`, `matchmaking:cancel` | Matchmaking application port          | Current ticket view                              |
| `matchmaking:found`, `matchmaking:admit`                         | Matchmaking credential/admission port | Requester-only credential or admission result    |
| `match:subscribe`                                                | Matches membership port               | Role and local subscription; no state            |
| `match:ready`, `game:command`                                    | Matches processing port               | Atomic Match acknowledgement                     |
| `presence:ping`                                                  | Transport only                        | Versioned liveness acknowledgement               |

Each client event must carry exactly one payload and an acknowledgement callback.
Unknown event names and invalid payloads receive stable error envelopes if an
acknowledgement is supplied. The handler will not invoke a mutation without one.
Credentials, invite codes, raw game intents and Match state are never logged or
broadcast. A session is authenticated again on each event; revoked/expired
sessions are disconnected. Redis rate-hook failure denies further operation.
The connection-level origin check and packet-size cap apply before application
calls. Do not put credentials in a query string or depend on `userId` in payloads.

Server event names for rooms, match delivery, presence and chat are reserved in
the catalog but have no emitter or safe payload schema in 12A. The local Socket
room names are implementation details; a later fanout must revalidate current
membership and build a recipient-specific PlayerView or SpectatorView. No
`match:event` may contain internal `game_events.payload_jsonb`. Delivery,
`seq`/gap recovery and Redis multi-node behavior belong to 12B. Durable
connection epochs, timeout/takeover and chat belong to 13/15. This adapter
factory is tested over a real loopback Socket.IO connection but is not enabled
by `startApi` while production gameplay remains disabled by 7C and the absent
runtime Matchmaking/rate configuration. See [ADR-025](../adr/025-versioned-realtime-gateway.md).

## Phase 12B delivery boundary

See [ADR-026](../adr/026-realtime-delivery-and-resynchronization.md). The added
incoming intents are `match:snapshot {schemaVersion:1,matchId}` and
`match:catchup {schemaVersion:1,matchId,afterSeq}`. Both require an acknowledgement,
the current session and rate control; Matches rechecks membership. Snapshot
acknowledgements return `{ok:true,value:<snapshot>}`; catch-up returns
`{ok:true,value:{schemaVersion:1,mode,events,snapshot}}`. A prior subscription is
not required for these authorized reads.

When a catch-up cursor equals the checkpoint read under the Match writer lock,
Matches returns `mode:EVENTS` with an empty tail without querying events or
receipts. It still reads the current roster, derives the recipient role and
constructs a fresh pinned PlayerView/SpectatorView. This is not a cached response:
concurrent commands and committed takeover remain visible through that lock.

On each connection, subscribe then request catch-up (or an initial snapshot).
Listen before subscribing. `match:event` contains a durable ID, seq, originating
stateVersion and empty invalidation payload. `match:snapshot` contains the pinned
versions, role, lifecycle status, stateVersion, lastEventSeq and validated view
(null before initialization). A pushed snapshot callback must receive exactly
its lastEventSeq, even when the snapshot is already applied. Do not acknowledge
an unvalidated or wrong-Match payload. Acknowledgement is delivery confirmation,
not authority to change game state.

Use `createMatchSequence` from `@hambazi/contracts` per identity/Match. Validate
wire schemas first. Render a snapshot only on `APPLY`; a contiguous event is an
invalidation, not a renderable state. A gap or reconnect requests catch-up using
the last applied snapshot cursor. Buffer no private internal events. A catch-up
snapshot covers its included events; large gaps use `mode:SNAPSHOT`. On transport
failure retry with bounded client backoff and resync; application mutations retain
their original action IDs. Later Mini App integration owns that UI lifecycle.

Optional composition order:

1. Create the Match resync port with the same pinned game adapter registrations.
2. Connect `createRealtimeRedisAdapter` with private credentials and deployment
   namespace; pass it and resync/ackTimeoutMs in gateway `delivery` dependencies.
3. Wait for gateway `ready()` (includes completed Redis subscriptions); include
   it in activation-time readiness. Start `createRealtimeConsumer` with the same
   outbox queue namespace and `publish: gateway.publish`.
4. During shutdown stop/await the consumer, close/drain the gateway, close its
   Redis adapter, then close HTTP/database resources. Do not destroy Redis while
   an intentional drain is waiting for acknowledgements.

Each subscriber node must have the same namespace and registered versions.
The consumer processes only `MATCH_CHANGED_V1`; result and matchmaking queues
retain their own consumers. Failed fanout retries under existing queue policy;
queue exhaustion needs operator redrive. Redis Pub/Sub does not persist packets,
and an offline recipient always recovers from the Match read port. No Socket.IO
connection-state-recovery claim is made. Failure latches the affected process
unhealthy and reconnects its clients; restart it before readmitting traffic.
All gateway/realtime composition remains disabled in `startApi` pending the
existing activation and production configuration gates.

Phase 17CQ adds optional `concurrency` (integer 1–100, default 1) to the consumer
factory. The disposable capacity composition explicitly uses four Match delivery
workers after a one-worker queue reached approximately ten seconds of age while
publication service p95 stayed at or below 200 ms. A withheld recipient ACK also
reproduced blocking of unrelated tables in a real BullMQ/Socket regression.
This setting overlaps independent delivery jobs; each socket retains its existing
serialized work queue and acknowledged cursor. Match writes and projections keep
their existing row locks, authorization, version checks and recipient views.
Retry counts, deadlines and transport admission bounds are unchanged. Drain
awaits all admitted parallel jobs before closing connections. Production
composition remains opt-in; this local setting does not select provider sizing
or final operational policy.

Phase 17CQ also records each socket's **acknowledged** sequence, state version
and role. An older or duplicate wakeup may omit projection and transmission only
when that checkpoint covers both counters and live session and Match membership
checks still succeed with the same role. Checks run inside the existing socket
tail. A newer counter, changed role, missing ACK or reconnect uses the full
locked, recipient-safe read and existing post-projection session check. Membership
loss still removes the subscription and closes orphaned Presence transports. No
cached view or shared private state is introduced; v1 delivery remains at least once.

The gateway delivers and validates the covering pushed snapshot acknowledgement
before emitting its content-free invalidations in ascending sequence order. The
current Mini App otherwise requests another locked catch-up read as soon as each
invalidation arrives, even though the covering view is already in flight. A
32-socket regression reproduces 32 redundant reads before this ordering repair
and none afterward. Snapshots still require live authority before transmission;
missing/invalid acknowledgements fail delivery and leave the cursor unchanged.
An invalidation without a covering snapshot still triggers normal gap recovery.

Optional `execution.intentConcurrency` and `execution.disconnectConcurrency`
pace work already admitted within the unchanged socket/global pending budgets.
Compatible defaults use the existing pending and connection bounds. The capacity
fixture selects four for each after observing 55 simultaneous Match transactions
and pool admission waits beyond two seconds. Both 32-socket bursts reproduce
unbounded execution before this repair and four concurrent operations afterward.
Intents retain their arrival order in a separate per-socket chain. They enter the
transport tail after an execution slot becomes available, with the same atomic
tail recheck as maintenance; waiting intents cannot hold up recipient delivery.
If intervening fanout is still active when a slot becomes available, the task
waits without holding that slot and retains its original queue position. Once
eligible, it precedes newer queued work in that scheduler; active operations are
never preempted. This prevents repeated demotion under overlapping delivery.
Live authentication, rate and owner guards run when execution starts. Disconnect
cleanup joins that ordered chain after all admitted intents and retains its reserved admission and
drain tracking. FIFO execution adds no new rejection code, retry, deadline or
quota. These local composition settings do not approve production sizing.

After admitted work settles, graceful gateway shutdown closes one transport and
awaits its disconnect cleanup before closing the next. This avoids submitting
hundreds of durable disconnect transactions to the connection pool simultaneously.
The existing drain deadline, lease/grace guards and handling of lost processes are
unchanged. Natural disconnect and measured reconnect storms retain their original
behavior; this scheduling change applies to intentional shutdown.

`close()` keeps its existing deadline failure. A deadline does not cancel the
underlying drain: `settled()` lets the resource owner retain database/Redis
dependencies until admitted work and durable disconnect cleanup finish. The
release/capacity composition awaits settlement in `finally` before disposing
these resources, retaining a timed-out close as a failed cleanup. A 32-transport
held-cleanup regression covers a deadline expiring before resource disposal.

Optional `presence.heartbeatConcurrency` bounds concurrent transport-pong
reauthentication and renewal (integer 1 through the configured connection bound).
Omitting it preserves the previous concurrency. The capacity fixture explicitly
uses four to pace synchronized pong waves before database acquisition. One
coalesced heartbeat remains pending per socket; queued work rechecks connection,
drain state and the live durable session after acquiring its FIFO slot. Expired
or revoked authority and rejected leases still close the transport. All admitted
work remains in the existing socket tail and drain set. Engine.IO timing,
session expiry timers, lease/grace guards and admission quotas are unchanged.
Waiting maintenance reserves the same socket/global pending-work budget and is
tracked for drain immediately. It waits for the current socket tail before
acquiring a heartbeat slot, then rechecks the tail before appending. New socket
work arriving during the slot wait causes it to release the slot and wait again.
Busy socket tails therefore cannot reserve every heartbeat slot and starve idle
leases; waiting heartbeat slots cannot block commands or recipient delivery.
Once appended, renewal remains serialized with other socket operations;
disconnect cleanup retains its separate reserved capacity.

The tail map contains only unfinished work. Completed intervening fanout or
maintenance does not send a waiting intent/heartbeat to the back of the global
FIFO again. A real-socket regression holds one slot, completes fanout on the
older waiting socket, then admits a newer socket; the older intent keeps its
turn. The active-tail race still releases a slot before waiting for unfinished
socket work, and per-socket mutation/disconnect ordering remains enforced.

## Phase 15A Chat delivery

The optional Chat port implements `chat:send`, `chat:list` and the formerly
reserved `chat:message` payload. A Chat list authorizes and subscribes a local
socket; fanout reauthenticates and rechecks membership through Chat. An explicit
Chat queue consumer calls `publishChat`. Cross-node wakeups are content-free;
each node fetches authorized text and emits only to its local sockets. Chat has
its own sequence/catch-up and acknowledgements (`messageId`), independent of game
versions. The new Chat baseline is checked alongside the unchanged earlier
baselines. Production composition remains opt-in and disabled in `startApi`.
See [Match chat](match-chat.md) for policy, composition and recovery.

# Phase 17A2 transport admission

[ADR-036](../adr/036-transport-admission-and-bounded-work.md) requires an explicit
validated profile and public Redis IP/user admission adapter for opt-in Gateway
composition. Engine.IO middleware covers polling/preflight/upgrades; namespace
authentication and all incoming events are admitted before expensive work.
Canonical IP/CIDR trust and production HTTPS checks apply independently of
Fastify. Socket work/connection/subscription bounds, coalesced heartbeats and
reserved disconnect cleanup preserve accepted outcomes and safe drain. Private
reads and Chat projection revalidate durable identity/expiry before delivery.
See [policy and authorization matrix](../security/transport-admission.md) for
configuration, failure semantics, evidence and production gates. No wire schema,
business authority or production activation changes.

The fixed Redis window accepts a nonnegative TTL, including zero at the expiry
boundary. An exhausted live window remains rejected without renewing its TTL,
with a positive retry hint. Missing expiry/key, malformed counters, unavailable
Redis and out-of-bounds replies still fail closed; quotas and window length are
unchanged. Concurrent near-expiry Redis and response-boundary regressions cover
this Phase 17CQ correction.
