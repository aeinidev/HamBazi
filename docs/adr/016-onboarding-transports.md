# ADR-016 — Authenticated onboarding transports and retry state

- **Status:** Accepted — implementation staged across Phase 6B2A and 6B2B
- **Owner:** HamBazi product owner (behavior/retention approval), HamBazi engineering (implementation)
- **Date:** 2026-09-20
- **Supersedes:** None; supplements ADR-014 and ADR-015

## Context

Phase 6B1 provides Users account creation but deliberately does not expose it to
untrusted Telegram IDs. Architecture sections 5.2, 6.1–6.3 and 16.2 require a
separate grammY Bot adapter, shared backend account rules, Mini App onboarding
and authenticated, deduplicated webhooks. The existing Bot is only a buildable
scaffold. There is no service-auth mechanism, onboarding state/receipt table or
approved metadata retention policy. Session auth only admits existing accounts.

The initial 6B2 assessment paused for material security, persistence and public
behavior decisions. The owner explicitly approved this profile with “Yes,
approved. Proceed with Phase 6B2.” This resolves the onboarding policy gate, not
any other architectural open decision. Implementation is divided into 6B2A
(Mini App transport) and 6B2B (Bot service identity/durable webhook workflow) to
preserve the one-reviewable-subphase-per-interaction rule.

Telegram documents webhook retries on unsuccessful HTTP delivery and update-ID
deduplication. IDs may restart from a random value after a week of inactivity;
a permanent highest-ID watermark is therefore not a safe dedupe design. grammY
does not supply webhook deduplication and does not promise exactly-once effects
for outbound messages. Account correctness and reply delivery need separate
guarantees.

## Decision

### Trust boundaries

Keep Bot as a separate process with no database credentials. Authenticate incoming
webhooks with HTTPS and constant-time verification of the configured Telegram
secret header before processing. Accept only explicitly supported private-chat
onboarding updates; derive identity from the authenticated update sender, never
from callback data, message text, or an arbitrary client identity field.

Use a dedicated, rotatable service bearer credential (at least 32 CSPRNG bytes)
for Bot-to-API HTTPS calls. Its scope is only the internal onboarding operations,
not player sessions, room admission or administration. Use internal-only ingress
and explicit trusted-proxy/network controls as defense in depth, not as a
substitute for authentication. Keep this credential separate from the Bot token,
webhook secret and session signing keys; accept explicitly configured current/
previous credentials only during controlled rotation. Never store credentials or
their hashes in PostgreSQL, Redis, request logs or error reports. Compromise of
this credential permits impersonation for onboarding until rotation; it is a
privileged secret, not a user access token.

Auth owns trust verification and backend onboarding orchestration. It calls only
Users' public ports for lookup/create; Users retains ADR-015's rules. Bot handlers
translate Telegram interactions into those versioned operations. No business rule
or direct table access moves into Bot.

### Minimal durable state and retention

Add Auth-owned PostgreSQL metadata through additive migrations and least-privilege
repository scopes: per-bot/update receipts, processing status/version/lease and
expiry, plus the current per-user private-chat onboarding step and prompt
correlation. Persist only IDs, timestamps, enumerated outcomes/reply intents and
required version guards; do not persist raw updates, draft display names, chat
text, credentials, initData or independent authentication material.

Use a **15-minute conversation lifetime** from explicit Create Account,
without extending it for duplicate deliveries. Expiry/cancel discards the pending
flow; the user restarts Create Account. Use **seven-day receipt retention**
from first acceptance, without extending it on duplicates. Expired metadata is
ineligible immediately and removed by a bounded cleanup path. This retention is
for onboarding metadata only, not a decision on chat, game events or backups.
Expiry and cleanup must be tested; completed account identity remains durable.

Serialize/fence competing transitions in PostgreSQL; use unique `(bot, updateId)`
receipts rather than process memory, Redis-only receipts or a global ID watermark.
Correlate name replies to the active prompt/flow so delayed text cannot silently
advance a different conversation. Account creation uses Users' natural identity
idempotency, allowing recovery if creation commits before a receipt is completed.
Do not claim an atomic cross-module transaction or hold DB locks during HTTP.
Receipt dedupe is bounded by retention; prompt expiry and create-only account
semantics remain mandatory protections beyond that window.

### Mini App contract and failure behavior

Add `POST /v1/auth/telegram-mini-app/account` as an additive v1 operation accepting
`schemaVersion`, UUID `commandId`, fresh raw `initData` and `displayName`. Derive
identity only from the existing verifier. Require explicit user creation intent;
do not silently create an account during session issuance. Return the safe Users
account projection and, when present, the verified bounded `start_param` as a
routing hint. The create-only logical result is keyed by verified identity per
ADR-015 even across different command IDs; retries never rename/reactivate it.
Do not persist initData or invite context. Session issuance remains a separate
existing operation; room resolution/membership stays in the Rooms phase.

Keep the existing session wire contract unchanged. Reuse the approved Mini App
IP/identity rate budgets across issuance and onboarding, rather than allowing
each route a separate budget. Bot webhook/internal-operation rate limits must
be explicit bounded runtime configuration with distributed Redis enforcement;
they do not establish launch capacity. Redis unavailability fails new onboarding
admission closed, and PostgreSQL unavailability cannot report creation success.

Commit backend state before sending Telegram replies. Use bounded outbound calls,
not webhook-response API shortcuts, so normal send failures are observable.
Completed duplicate updates do not repeat backend effects. Retry interrupted
work under guarded ownership, and resume pending replies on redelivery. Do not
acknowledge incomplete work merely because a handler timed out. No account effect
may depend on successful notification delivery.

Accept best-effort retryable Bot replies: an ambiguous send result/crash can cause
a duplicate prompt or acknowledgement, and exhausted Telegram retries can leave
a reply undelivered. Do not claim exactly-once messaging or guaranteed eventual
delivery. A repeated `/start` must recover the user's persisted account/current
onboarding state without repeating account creation effects. A durable outbound
notification worker is not silently added to this phase.

## Alternatives

- mTLS/workload identity instead of a service bearer: stronger process identity,
  but introduces certificate/issuer and deployment lifecycle requirements not yet
  established. Choose this if the owner requires it before Bot implementation.
- Redis-only conversation/receipt state: fewer schema changes, but Redis loss can
  reset prompts and forget processed updates; not the recommended durable design.
- Indefinite receipt retention: longer replay memory, but unbounded personal
  metadata retention/storage. Seven days bounds the approved operational record.
- At-most-once reply attempts: fewer duplicate notifications, but a crash can
  permanently suppress a reply. Retrying is recommended for onboarding recovery.

## Consequences and implementation gates

### Service-auth implementation profile (6B2B1, 2026-09-21)

Deliver 6B2B in three reviewable steps: B1 service-auth foundation, B2 durable
onboarding workflow/persistence, and B3 Bot runtime/internal HTTP/webhook delivery.
This sequencing does not change the accepted retention or messaging policy.

The API verifier accepts `Bearer <keyId>.<secret>` with a case-sensitive key ID
(1–64 ASCII letters/digits/underscore/hyphen) and canonical unpadded base64url
encoding of 32–64 CSPRNG bytes. Provisioning must generate randomness; parsing
cannot prove entropy. Configure one active key and optionally one previous key;
duplicates and reuse of Bot/webhook/session secret material are rejected.
Comparison of equal-length decoded secrets is constant-time. Errors do not
contain credentials. Authority is only `{schemaVersion: 1, botId, scope:
"bot:onboarding"}`; bot ID comes from trusted Bot-token configuration, never a
request. This is neither a player identity nor authorization for other scopes.

Configure 1–32 exact direct socket peer addresses, limited to loopback, RFC1918
IPv4 or IPv6 ULA. No DNS, CIDR wildcard, public peer or forwarded-header trust is
accepted by this verifier. IPv4-mapped IPv6 addresses are matched equivalently.
This is defense in depth, **not proof of internal-only exposure**: a shared public
proxy can also have a private address. B3 must establish dedicated internal-only
HTTPS ingress and reject public routing before enabling these operations.
The transport-free B1 primitive does not attest TLS or authenticate webhooks.

Rotation is an operator-controlled overlap: distribute both keys to every API
instance, switch the Bot sender to the active key, then remove the old key and
reconstruct/restart all verifiers. No automatic previous-key expiry is implied;
remove a compromised key immediately, accepting failed in-flight retries. Never
reuse key IDs. B1 does not wire configuration into startup, add a production
endpoint, deploy a credential or claim completion of the durable Bot workflow.

### Durable workflow implementation profile (6B2B2, 2026-09-21)

Auth owns two additive metadata tables: `bot_update_receipts` (unique bot/update)
and `bot_onboarding_flows` (unique bot/private-chat sender). There are no raw
updates, submitted names, arbitrary JSON payloads or secret columns. IDs use
BigInt-safe storage. Receipt/flow UUIDs and monotonic versions are coordination
metadata, not authentication credentials. API privileges cover only the required
columns; the Worker and Bot receive no access to these tables in this step.

Internal v1 operations are `process` and `acknowledge`, with strict DTOs and a
trusted service context. The eventual Bot adapter must supply only original,
authenticated private-chat interactions, with sender equal to private chat ID.
It must ignore edited updates and must not synthesize a different name when
redelivering the same update ID. Receipts bind sender, action, source message
and replied-to message IDs; text is neither stored nor hashed for deduplication.

Receipts progress `PROCESSING → CREATING (name only) → REPLY → DONE`, or directly
from processing to reply. A configurable 1–60 second lease is explicitly supplied
by composition; no production default is chosen here. Retry claims increment a
version and preserve the original seven-day expiry. A synchronous decision runs
inside a short Auth transaction, with receipt locking and conversation version
comparison. Time is rechecked after reads/lock waits and before completion;
deadline failure rolls back both changes. Conflicting flows are retried at most
four times internally; failures return `RETRY` for bounded transport retry later.

Each prompt attempt has a monotonic prompt version. Acknowledging a successful
Telegram send records its message ID only if that flow/version is still current.
A name reply must reference that acknowledged prompt. Repeated `/start` recovers
an account or issues a current prompt without extending a live conversation.
An expired flow requires explicit Create Account. A stale pending prompt becomes
an expired-flow reply rather than being resent as a valid prompt.

The committed `SUBMITTING` transition is **irrevocable account admission**.
Cancellation that commits first prevents admission; cancellation while submission
is pending must retry. Expiry prevents new admission, but cannot roll back an
already-admitted Users call. A call already in flight can finish after a lease or
conversation deadline; lease fencing controls Auth state, not an independent
Users transaction. Repeated Users calls have one durable account effect under
ADR-015. Recovery checks Users first, so a committed account survives a crash
before receipt completion without needing stored name text. If no account was
committed, only redelivery of the admitted update can retry while the flow is
still live. No cross-module transaction or cancellable account write is claimed.

`REPLY` is not delivery completion. Only successful send acknowledgement yields
`DONE`; `RETRY` must never be translated into a successful Telegram webhook ack.
An expired lease cannot acknowledge a newer claim. Ambiguous send/ack failures
may still duplicate notifications, as already approved. Receipt deletion does
not recreate account effects; old prompt IDs cannot authorize a new flow.

The trusted cleanup port deletes at most 1–500 expired rows **per table** per
invocation, selected using expiry indexes and rechecked on deletion. Expiry is
enforced even before physical cleanup. B3 must wire bounded periodic cleanup,
Redis admission limits and internal-only HTTPS before any Bot traffic is enabled.
B2 adds no exposed HTTP operation, scheduled worker, live webhook or deployment.

The approved profile adds a privileged service-auth boundary and short-lived
personal metadata in 6B2B. These are not delivered by 6B2A. Credentials,
host/region and live Telegram access remain later runtime inputs.
Tests must cover forged identity, secret rotation, duplicate/concurrent updates,
stale prompts, expiry/cleanup, commit-before-reply failure, restarts, safe logging
and existing Auth contract compatibility. Live registration/deployment remains
separately authorized; no webhook registration or backlog deletion is permitted
by this proposal.

### Internal transport and maintenance profile (6B2B3A, 2026-09-21)

Split B3 into B3A (private API and cleanup scheduling) and B3B (Telegram Bot
process and delivery). B3A adds a separate, opt-in HTTPS listener in the same API
process, not a new service. The public API never registers internal operations.
Bind only an explicit private/loopback address on a distinct port, require TLS
1.2 or newer and the B1 scoped bearer/direct-peer allowlist, and reject Origin,
Forwarded and all X-Forwarded headers. Do not route this port through a public
reverse proxy. Operators must independently verify firewall/ingress isolation;
loopback tests cannot prove a production network configuration.

Internal v1 POST operations are `/v1/internal/bot/admit`, `/updates` and
`/acknowledgements` under that prefix. Admission is a distributed rate check, not
a token or durable reservation; the Bot must call it before processing even an
unsupported authenticated webhook. All three operations consume the same
per-bot request budget across API instances. Processing also consumes a verified
sender budget. Settings are required and bounded, not launch-capacity defaults.
Authentication and request rate checks precede body parsing; JSON bodies are
limited to 4 KiB. Redis failure denies admission. Pending application `RETRY`
becomes HTTP 503 with `Retry-After`, never HTTP 200. The future Bot client must
treat HTTP 429/503 as retryable even when the generic error code's existing
`retryable` flag is false. A `REPLY` still requires an explicit successful-send
acknowledgement. Internal OpenAPI has its own baseline and compatibility gate.

Worker owns periodic cleanup through Auth's public `createBotOnboardingCleanup`
port. BullMQ uses a stable v1 scheduler/job name and a strict payload containing
only schema version and bounded batch size. Explicit interval, attempts and
exponential backoff are configured; concurrency is one per Worker, and concurrent
workers remain safe through idempotent expiry-checked transactions. Every run
deletes at most the batch limit per table. Retain at most ten completed and one
hundred failed jobs; errors/results contain only fixed messages or row counts.
Shutdown drains the current job, with the process's 15-second hard deadline as a
last resort. Interrupted cleanup can safely retry. The scheduler is upserted at
startup; after Redis data loss, restart Worker to reconstruct it. Redis loss can
delay physical cleanup but cannot make expired metadata eligible or lose account
state. No guaranteed cleanup latency or launch SLO is established here.

Worker uses its own database/Redis credentials, without Bot/session credentials.
Its new PostgreSQL grants are SELECT on `id, expires_at` and table DELETE only
for these two Auth tables. It cannot read sender/prompt state or sessions, insert
or update onboarding rows. DELETE is a table privilege, not row-level security:
the Auth repository enforces expiry and batch bounds. No table ownership moves
to Worker and no runtime raw SQL is introduced. Apply the additive grant update
before starting Worker; prior API releases continue to work. There is no new
schema migration or destructive contraction in B3A.

See [internal transport operations](../architecture/bot-internal-transport.md)
for configuration, rollback and failure handling. B3A does not implement a
webhook, register Telegram, deploy, or complete B3/6B2.

### Bot delivery implementation profile (6B2B3B, 2026-09-21)

The separate Bot process uses grammY's API client for outbound messages and a
bounded Fastify HTTPS ingress for the Telegram webhook. It does not use grammY
in-memory sessions, polling, webhook-response API shortcuts or automatic webhook
registration. Auth remains the durable workflow authority and Users the only
account-rule owner. Startup performs only the private admission probe; no live
Telegram mutation is hidden in startup or shutdown.

Receive only `POST /v1/telegram/webhook`, with no query string, on an explicitly
configured private/loopback bind behind TLS passthrough or a private TLS upstream.
The process terminates TLS itself (minimum 1.2), rejects browser/proxy-forwarded
headers and verifies exactly one Telegram secret header using constant-time
comparison. Distributed admission precedes JSON parsing; a 64 KiB body limit,
bounded headers, per-process in-flight cap and absolute deadline bound resources.
This cap is not a replacement for shared Redis admission or edge abuse controls.

Accept original, non-forwarded private text messages from non-bot senders whose
chat and sender agree. Edited, business, channel, group, callback, inline-bot and
unsupported updates have no effects. An authenticated unsupported update is
acknowledged only after distributed admission. Map `/start` (optional opaque
payload ignored here), `/create`/Create Account and `/cancel`/Cancel to existing
intents. A name is passed unchanged, never truncated/normalized by Bot, only when
replying to this Bot in the same chat and within the existing 256-code-unit DTO
limit. Auth independently checks the active prompt ID. Longer/unrelated text is
unsupported; `/start` can recover the current prompt. Unknown/malformed identity
fields never become backend authority. No callback identity or stored draft is
introduced.

Reply intents map to fixed plain text without parse modes. Name prompts use
ForceReply; an eligible account receives the configured HTTPS Mini App entry
button. This does not implement future profile/catalog/room screens or turn an
invite hint into admission. The private HTTPS client validates strict responses,
correlates returned update/chat before sending, verifies TLS trust/hostname,
follows no redirects and bounds response bytes and total duration. Bot has no
database/Redis/session credentials; it receives only its current service key.

Each webhook makes at most one attempt per required operation: admit, process,
send, acknowledge. Backend HTTP 429/503, malformed responses, transport failure,
Telegram flood errors, deadline expiry and ambiguous send/ack failure all return
503 to Telegram with a bounded Retry-After hint. All non-200 backend results fail
closed; do not drop work on a misconfigured service credential. Telegram retry
timing is external and is not guaranteed to follow that hint. Successful send
alone never completes delivery. Repeated delivery/restart recovers through the
existing lease and receipts, with the already-approved possibility of duplicate
notifications. No extra unbounded automatic retry plugin is installed.

Bot/API must use the same configured onboarding lease. Bot validates that its
declared lease covers two backend call budgets plus the send budget and a
one-second margin; the full request deadline also includes admission. This is
a local configuration guard, not a remote lease negotiation or a guarantee
against event-loop stalls. Backend acknowledgement still fences expired leases.
SIGTERM/SIGINT stop admission and drain requests, then close the backend agent;
a 30-second process deadline bounds failed shutdown. Logs exclude input/output
payloads, raw SDK errors, tokens, headers and URLs.

The owner additionally authorized inspection/configuration/testing of the
configured **development** bot during B3B, including commands/menu/webhook, but
not token disclosure or rotation. This does not authorize deployment or changes
to a different bot. Any live change must first verify identity and a reachable
development HTTPS endpoint, preserve pending updates, and verify the result.
See the [Bot operations runbook](../architecture/telegram-bot-runtime.md).

## References

- [Architecture](../ARCHITECTURE.md), sections 5.2, 6, 15.5 and 16.2
- [Account identity policy](015-account-identity-policy.md)
- [Telegram update and webhook semantics](https://core.telegram.org/bots/api#getting-updates)
- [grammY reliability guarantees](https://grammy.dev/advanced/reliability#reliability-guarantees)
- [grammY webhook-reply limitations](https://grammy.dev/guide/deployment-types#webhook-reply)
- [grammY API client and cancellation](https://grammy.dev/ref/core/api)
