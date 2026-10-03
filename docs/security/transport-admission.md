# Transport admission and authorization

Phase 17A2 implements [ADR-036](../adr/036-transport-admission-and-bounded-work.md).
The production profile has no defaults. These are required numeric configuration
fields, not recommendations; all nodes must use the same quotas and issuer
namespace. Explicit test values live only in test fixtures.

| Environment field            | Resource                                                                                                              | Valid range                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| ADMISSION_HTTP_PER_MINUTE    | Origin-accepted public HTTP requests per canonical peer                                                               | 1–1,000,000                              |
| ADMISSION_ENGINE_PER_MINUTE  | Engine.IO HTTP/upgrade requests and namespace attempts per canonical peer                                             | 1–1,000,000                              |
| ADMISSION_CONNECT_PER_MINUTE | Accepted authentication attempts per user, across sockets/nodes                                                       | 1–1,000,000                              |
| ADMISSION_EVENT_PER_MINUTE   | Incoming Socket messages per user, including invalid/unacknowledged traffic                                           | 1–1,000,000                              |
| ADMISSION_HTTP_IN_FLIGHT     | HTTP work per process; client abort does not release an active handler                                                | 1–100,000                                |
| ADMISSION_ENGINE_IN_FLIGHT   | Concurrent Engine.IO admission checks; separately, namespace authentication work                                      | 1–100,000                                |
| ADMISSION_CONNECTIONS        | TCP connections on the public HTTP server; separately, Gateway Engine.IO transports plus pending initial reservations | 1–100,000                                |
| ADMISSION_PENDING_PER_SOCKET | Running/queued incoming or outgoing Socket work                                                                       | 1–10,000                                 |
| ADMISSION_PENDING_TOTAL      | Running/queued Socket work per process                                                                                | 1–100,000; at least the per-socket limit |
| ADMISSION_SUBSCRIPTIONS      | Total room, Match and Chat subscriptions per socket                                                                   | 1–1,000                                  |

The adapter uses a fixed window from the first accepted attempt, with an atomic
counter capped at its limit and a 60-second TTL that rejected requests cannot
extend. A new window is not a permanent identity record. IPv4-mapped forms and
equivalent IPv6 forms are canonicalized; UUID case is normalized. Hashes are only
of IP/UUID and namespace, never initData, tokens, signatures, text or game state.
The Redis client rejects offline work, caps its command queue at 256 and bounds
connect/command waits. No new Redis ACL grant is needed.

## Failure and draining behavior

| Boundary                    | Exhausted quota/local work capacity                           | Quota-store unavailable                                                                                                         |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Public HTTP                 | 429 RATE_LIMITED + Retry-After before expensive work          | GET/HEAD and logout proceed under local bounds; owner-specific auth/read policies still apply. Other mutations receive safe 503 |
| Engine.IO polling/preflight | 429 RATE_LIMITED + Retry-After                                | Safe 503                                                                                                                        |
| WebSocket upgrade           | Transport closed before namespace auth                        | Transport closed                                                                                                                |
| Socket namespace            | Stable RATE_LIMITED connect error                             | Stable INTERNAL_ERROR connect error                                                                                             |
| Socket incoming event       | Stable RATE_LIMITED acknowledgement when present; no mutation | Stable INTERNAL_ERROR; no mutation                                                                                              |
| Trusted outgoing fanout     | Publication fails and retries/resyncs from durable storage    | Existing Redis adapter readiness/transport closure policy remains                                                               |

Draining stops new HTTP/transport/namespace/event admission and preserves accepted
application outcomes. Pending quota checks/authentication are included in drain.
Per-connection disconnect cleanup has one reserved serialized slot; transport
pongs coalesce while one heartbeat is queued/running. Cleanup capacity is bounded
by admitted connections in addition to the ordinary work cap. Pending disconnect
cleanup retains Gateway connection capacity until it settles, preventing churn
from accumulating reserved work. Namespace reservations retain capacity through
the library's deferred connection callback; duplicate concurrent namespace
attempts on one transport are denied. No Redis error,
untrusted event name, payload or IP is added to telemetry.
Lost Match membership closes a Presence-enabled transport to clean up retained
lease subscriptions; ordinary authorized reconnect restores other subscriptions.

## Authorization matrix and evidence

| Surface / attacker intent                                          | Required authority / denial                                                                                | Verification                                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Forged bearer, Telegram identity, payload userId or namespace auth | Server Auth establishes eligible durable identity; strict DTO rejects extras                               | Auth/HTTP/onboarding and gateway suites; real session integration                                    |
| Unknown routes, bad JSON, invalid sid, polling/upgrade floods      | Canonical trusted peer budget before parsing/JWT/DB work; bounded connections/admission checks             | HTTP/transport unit cases and two-node Redis integration                                             |
| Unknown or unacknowledged Socket mutation                          | Count user budget, no owning mutation; bounded queued work                                                 | Gateway abuse and queue/drain tests                                                                  |
| Room read/join/start, non-host, full/started room                  | Rooms owner membership, host, capacity, lifecycle/version and idempotency                                  | Rooms domain/HTTP and real PostgreSQL race suites; gateway denial forwarding                         |
| Match ready/command, wrong participant/turn/version/action replay  | Matches single writer and engine own actor, state, rules, expectedVersion/actionId                         | Match processing/admission integration, Coup invariant/replay; gateway actor/denial tests            |
| Reconnect after takeover                                           | Membership/resync owner returns spectator; cannot regain human command authority                           | Reconnect/lease races, process-kill/two-socket integration, engine player/spectator information-flow |
| Snapshot/catch-up/subscription or admission token after revocation | Bound durable user/session/expiry before and after private reads; recipient owner projection               | Gateway queued identity/session and mid-projection revocation cases; real recipient resync           |
| Chat send/list/delivery, spectator/nonmember or revoked session    | Chat owner membership/role/text/rate; post-projection durable session check before local-only content send | Chat domain/real two-node delivery, mid-projection gateway revocation case                           |
| Grow subscriptions indefinitely / stale fanout membership          | Subscription bound with idempotent joins; owner denial removes Match cursor and room                       | Gateway subscription and membership-loss cases                                                       |
| Inspect other hands/deck/RNG or telemetry                          | Deny-by-default views; strict output/log allowlists, content-free wakeups                                  | Coup golden/information-flow, resync, Chat and Observability adversarial suites                      |
| Use player/Bot identity for operator mutations                     | No public admin surface or live activation                                                                 | Existing empty Admin/catalog activation boundary; 17A3/7C remain gated                               |

The Gateway never duplicates business permissions or reads another module's
tables. Stable schemaVersion-1 contracts and event baselines are unchanged.
Healthy quota exhaustion may temporarily affect users sharing a NAT, including
logout; owners must review concrete limits before production. IPv6 prefix
rotation and raw TCP/TLS floods still require ingress controls and capacity
evidence. Local bounds and TTLs are not a DDoS, load or launch-readiness claim.

Engine middleware coverage was checked against installed Engine.IO code and the
[Socket.IO middleware documentation](https://socket.io/docs/v4/middlewares/);
atomic script behavior follows [Redis scripting documentation](https://redis.io/docs/latest/develop/programmability/eval-intro/).
Public HTTPS/WebView ingress, production values/provider/SLO and load/soak remain
unavailable or later-phase gates. No 17A3 browser/admin work is included.
