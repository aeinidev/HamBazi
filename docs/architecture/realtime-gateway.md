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
