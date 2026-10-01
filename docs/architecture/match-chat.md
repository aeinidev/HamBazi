# Match text chat — Phase 15A

[ADR-029](../adr/029-temporary-match-chat.md) records the owner-approved temporary
baseline. OD-005 still gates final retention, report/mute and age policy before
public beta. No automatic deletion policy or public activation is introduced.

## Ownership and permissions

`@hambazi/api/chat` exposes `createChatPort`, `createChatRate` and the version-1
schemas. Chat owns its application service and PostgreSQL history repository.
It asks the public Matches membership port on each intent and recipient delivery;
it cannot read Match state or membership tables. Current authenticated members
read; PLAYER members send. A Bot-replaced human is a read-only SPECTATOR. There
are no Bot messages, public spectators or separate spectator channel. Terminated
Matches are denied by the existing membership port.

Admission checks membership before and after the distributed quota call. The
last successful check admits an in-flight operation, as in ADR-025; a later role
change does not undo an admitted write. Subsequent operations use the new role.
The gateway authenticates the bound session again before each intent/delivery.

## Contracts and text

| Socket intent/event | Version-1 shape / behavior                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `chat:send`         | `{schemaVersion, matchId, commandId, text}`; acknowledgement returns the stored message                                           |
| `chat:list`         | `{schemaVersion, matchId, limit?, beforeSeq?, afterSeq?}`; one cursor at most; authorized read also subscribes the socket locally |
| `chat:message`      | `{schemaVersion, matchId, messageId, userId, seq, text, createdAt}`; client acknowledges `messageId`                              |

Page acknowledgements carry `matchId`, `role`, `canSend`, `messageLimit`, ordered
`messages`, `lastSeq` and `hasMore`. No cursor yields the newest page; `beforeSeq`
loads earlier history; `afterSeq` returns ascending catch-up. Chat sequence is
independent of game event sequence and Match stateVersion. The generated event
catalog and new `realtime.chat.v1.baseline.json` freeze these shapes; existing
realtime baselines remain unchanged. `CHAT_CONFLICT` is a stable safe error for
changed reuse of an actor's command ID.

Text is normalized to NFC and trimmed. It must be visible and nonempty; controls,
malformed surrogate input and formatting characters except ZWNJ/ZWJ are rejected.
Persian and emoji work. Markup characters are stored as plain text and React
escapes them on display; the UI does not interpret HTML or auto-link content.

## Persistence and delivery

Migration `202610010001_chat` adds nullable `command_id`/`seq`, actor-bound command
uniqueness, Match sequence uniqueness and `chat_streams`. Its check constraint
requires both metadata fields together and a positive message sequence. Previous
insert shapes remain valid. Legacy unversioned rows are retained but excluded
from the new history; no retry identities are fabricated by a backfill.

A short serializable transaction allocates one Chat sequence, inserts the message
and a content-free `CHAT_MESSAGE_V1` outbox record. Bounded conflict retries and
the unique keys protect concurrent writers. An identical retry returns the same
message; changed normalized text conflicts. Failure rolls back all three writes.
No network call or Match state update occurs inside this transaction. Keyset
pages read the stream checkpoint and messages consistently.

The Chat database scope exposes chat messages/streams and only outbox `create`.
API role grants allow message inserts/reads and stream-counter updates; Worker
has no chat-content grants. Runtime and ESLint restrictions prevent Chat from
claiming or updating outbox events or querying Match tables.

The shared outbox scanner accepts an injected decoder. Its old Match decoder is
still the default; Worker composition now combines public Match/Chat schemas.
`chat-message-v1` jobs and `chat:wakeup:v1` inter-node packets carry only event,
Match and message IDs, sequence and validated correlation. Text never enters
the queue, Redis broadcast adapter or telemetry. Each node uses Chat's port to
read authorized content and emits directly to its local socket. Missing client
or node acknowledgements fail publication and trigger queue retries. The existing
gateway failure policy closes an unacknowledged local socket; it reconnects and
resubscribes before recovering history. Offline
clients recover from PostgreSQL history. Duplicate delivery is expected.

## Explicit opt-in composition

`parseChatConfig` accepts all four values together, or no Chat configuration:

| Setting              | Allowed values                                         |
| -------------------- | ------------------------------------------------------ |
| `CHAT_MESSAGE_LIMIT` | 1–500 Unicode code points                              |
| `CHAT_PAGE_LIMIT`    | 1–50 messages                                          |
| `CHAT_SEND_LIMIT`    | 1–10 sends per user per fixed 60-second window         |
| `CHAT_READ_LIMIT`    | 1–60 history reads per user per fixed 60-second window |

The approved recommended explicit values are 500/50/10/60. The shared Redis
limiter counts retries across sockets/nodes; exhaustion returns RATE_LIMITED,
unavailable Redis returns a safe failure and denies send/list. These are resource
guards, not production capacity measurements. Recipient delivery is not charged
to the user's history-read quota.

For an authorized activation composition: connect the Chat limiter; construct
Chat with database, public membership, clock and policy; pass
`chat: {port, ackTimeoutMs}` to the existing gateway. Require an acknowledgement
timeout of 100–30,000 ms. Alongside the existing Match consumer, create a realtime
consumer with `kind: "CHAT_MESSAGE_V1"` and `publish: gateway.publishChat` using
the same private Redis and queue namespace. Await consumer readiness and drain
it before gateway/Redis shutdown. Multi-node composition uses the existing Redis
adapter and readiness checks. `startApi` remains disabled for gameplay/Chat under
the existing activation gates; configuration alone does not enable it.

Deploy the decoder/publisher and additive migration/grants before enabling Chat
producers. Old workers quarantine unknown events. Roll back by disabling Chat
production, draining delivery and retaining schema plus compatible handlers for
queued events; do not drop retained content or change event IDs. Existing outbox
redrive recovers retained intents after queue loss; history also repairs missed
delivery. Storage growth remains an explicit OD-005 pre-beta gate.

## Mini App and verification

Match chat keeps at most 200 messages in memory, validates messages/pages,
deduplicates delivery and detects sequence gaps. It performs bounded catch-up,
refreshes history after reconnect and periodically repairs missed wakeups. A
history response overtaken by a live message cannot regress the cursor. Stable
captured send IDs survive ambiguous retries. Match changes/logout dispose the
feed and draft, and late send results are fenced after disposal; no browser persistence is used. Game snapshot invalidations do not reset Chat history or consume additional Chat reads. Read-only and disconnected states
disable sending. Earlier history is bounded by the same in-memory limit.

Unit and isolated PostgreSQL/Redis tests cover validation, membership/role changes,
shared quotas, duplicate/concurrent sends, rollback, keyset pagination, restricted
grants, restart durability, content-free BullMQ jobs, two-node fanout and failed
acknowledgement recovery. Synthetic Chromium tests cover escaping, ambiguous
send retry, reconnect/history, spectator state, storage clearing and accessibility.
These are local checks; live Telegram WebView/staging, production activation,
retention/moderation and capacity/soak remain separate gates.
