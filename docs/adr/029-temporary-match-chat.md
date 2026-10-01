# ADR-029 — Temporary membership-protected Match chat

- Status: Accepted by project owner for Phase 15A; public activation remains gated.
- Owner: HamBazi project owner / implementation maintainer
- Date: 2026-10-01
- Supersedes: none

## Context

The owner explicitly approved the temporary Chat baseline proposed in the 15A
assessment. Architecture sections 13.1, 16.3 and 21.4 require membership checks,
bounded plain-text history and rate limits without content in telemetry. Final
retention, report/mute and age rules remain OD-005, due before public beta.

## Decision

Authenticated current Match members can read. Only PLAYER members can send;
Bot-replaced humans are read-only. Bots do not author chat, and public spectators
or a separate spectator channel are not introduced. Recheck membership on every
intent and recipient delivery through Matches' public port. Authorization admits
an in-flight operation at its last successful check, like ADR-025; later role
changes cannot undo that admitted write. Subsequent operations must use the new
role. No Match state/table access is granted to Chat.

Text is NFC, visible, nonempty plain text, supporting Persian, ZWNJ and emoji.
Reject malformed Unicode, control and bidi-formatting characters; preserve markup
characters as text and escape on rendering. Do not interpret HTML or auto-link.
Explicit runtime resource controls are at most 500 code points per message and
50 messages per page. Recommended explicit per-user fixed 60-second budgets are
10 sends and 60 history reads across sockets/nodes; smaller budgets are supported.
Retries consume the same budgets. Exhaustion returns RATE_LIMITED; unavailable
Redis denies send/list. These are provisional controls, not capacity evidence.

Chat owns an independent monotonically increasing sequence and actor-bound stable
command IDs. Matching retries return the same message; changed reuse conflicts.
Message, sequence allocation and content-free outbox intent commit atomically.
The common outbox adapter accepts an injected owner-event decoder; its original
Match decoder remains the default. Composition/Worker combines the public Match
and Chat schemas without adding a Matches-to-Chat dependency. Chat may only
INSERT into the common outbox via its repository; it cannot claim/read/update
outbox rows or access Match state. Worker gets no chat-content grants.

Redis jobs and cross-node wakeups contain only IDs/sequence/correlation. Each node
fetches content through Chat after recipient authentication/membership checks,
then writes directly to its local socket. No broadcast of text goes through the
Redis Socket adapter. Acknowledgement failure retries; history catch-up repairs
duplicates, gaps and missed delivery. Chat ordering never changes game sequence
or stateVersion. Bound browser messages to 200, erase them and drafts on logout
or Match change, and retain a stable send intent during ambiguous retry.

No automatic deletion duration or moderation/age behavior is selected. Retained
history/storage growth is a pre-beta policy gate, not an indefinite-retention
promise. Production Chat remains opt-in behind the existing activation gates.

## Alternatives

Allowing spectators to send changes post-takeover behavior. Process-local quotas
multiply across nodes. Best-effort broadcast alone loses committed messages.
Putting text in queue jobs duplicates user content outside its authorized store.
Coupling chat to game versions causes irrelevant game-command conflicts.

## Consequences

Sequence allocation serializes each Chat stream without locking the Match writer.
Additive nullable message metadata preserves legacy insert shapes; unversioned
legacy rows are retained but are not surfaced as version-1 Chat history. No
backfill invents command identities. A shared outbox deployment must include the
new decoder/publisher before Chat producers are enabled; old workers would
quarantine unknown events. Roll back by disabling Chat producers/consumers and
retaining schema plus compatible handlers until queued work drains. OD-005,
production settings/activation and load/soak remain separate gates.
