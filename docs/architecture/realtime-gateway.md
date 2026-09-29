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
