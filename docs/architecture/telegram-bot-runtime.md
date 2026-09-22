# Telegram Bot runtime and development operations

Phase 6B2B3B implements the Bot adapter in [ADR-016](../adr/016-onboarding-transports.md).
Users/Auth own accounts, receipts and conversations; Bot owns Telegram input,
fixed reply rendering and transport. It has no database or Redis client and
does not keep conversation state. Auth's public schemas are imported through
`@hambazi/api/auth`; importing that port performs no DB/network work.

## Running

Build through the workspace dependency graph, then use the declared
`pnpm --filter @hambazi/bot start`. Supply the following through process
environment/secret mounts; startup does not automatically read `.env`.

| Setting                                         | Constraint / purpose                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                      | `development`, `test`, or `production`; this does **not** select Telegram's separate test datacenter  |
| `TELEGRAM_BOT_TOKEN`                            | Dedicated development/production bot token, wrapped/redacted in configuration                         |
| `TELEGRAM_BOT_USERNAME`                         | Actual username returned by verified `getMe`, ending in `bot`                                         |
| `TELEGRAM_WEBHOOK_SECRET`                       | 32–256 ASCII letters/digits/underscore/hyphen, matching registered secret                             |
| `BOT_SERVICE_KEY_ID`, `BOT_SERVICE_KEY`         | Current API-accepted key ID and canonical base64url 32–64-byte secret; not the Bot/webhook secret     |
| `BOT_API_ORIGIN`                                | HTTPS private literal IP origin, optional port, no path/query/credentials; certificate SAN must match |
| `BOT_API_CA_FILE`                               | Optional absolute PEM CA file; otherwise system trust applies                                         |
| `BOT_BIND_ADDRESS`, `BOT_PORT`                  | Explicit private/loopback IP and port 1–65535                                                         |
| `BOT_TLS_KEY_FILE`, `BOT_TLS_CERT_FILE`         | Absolute PEM files, nonempty and at most 64 KiB each                                                  |
| `BOT_MINI_APP_URL`                              | Operator-provisioned HTTPS URL without credentials/query/fragment; no user-controlled redirect        |
| `BOT_BACKEND_TIMEOUT_MS`, `BOT_SEND_TIMEOUT_MS` | Each 100–5000 ms, absolute deadlines including response reads                                         |
| `BOT_ONBOARDING_LEASE_MS`                       | Must match API, 1000–60000 ms and at least `2 × backend timeout + send timeout + 1000`                |
| `BOT_MAX_IN_FLIGHT`                             | 1–100 per-process requests; explicit resource bound, not launch capacity                              |

Provision independent CSPRNG secrets; validation cannot prove entropy. API-side
configuration additionally rejects overlap with session keys; do not give those
keys to Bot just to compare them. Mount TLS keys read-only with owner-only
permissions. Credentials/certificates are read once; rotate using the existing
operator-controlled overlap/restart procedure, not token rotation in this phase.

Enable the B3A private API and deploy its additive grants/cleanup Worker first.
See [internal transport operations](bot-internal-transport.md). The Bot startup
probe consumes one shared admission request and fails closed on unavailable or
misconfigured backend/TLS. No Telegram API call, webhook registration/deletion,
command/menu mutation or backlog drop occurs automatically.

## Webhook ingress contract

`POST /v1/telegram/webhook` accepts Telegram's JSON Update protocol, not the
internal schemaVersion envelope. It requires actual TLS and exactly one
`X-Telegram-Bot-Api-Secret-Token`. Origin, Forwarded, X-Forwarded headers, alternate
paths/query strings and plaintext are denied. JSON bodies are at most 64 KiB;
admission through the backend's shared Redis budget happens before parsing.
Use TLS passthrough or re-encrypted upstream routing that does not add forwarded
headers. Public ingress/firewall/certificate validation is still an operator
gate; do not expose the private API listener alongside the webhook.

Supported interactions are `/start`, `/create` or Create Account, `/cancel` or
Cancel, and a bounded text reply to this Bot's name prompt. Optional command
username suffixes must match this bot. `/start` payload is ignored here, not room
authorization. Mini App signed `start_param` remains the invite-onboarding path.
Edited/group/channel/business/forwarded/inline-bot/callback updates and unrelated
or over-256-code-unit name text are ignored after authenticated admission.
Replying to a different bot/chat is ignored. Names remain verbatim; Auth checks
prompt correlation and Users validates display-name policy.

ForceReply prompts are acknowledged using Telegram's successful message ID.
Fixed text uses no HTML/Markdown parse mode and never echoes submitted names.
The account menu offers Open HamBazi; profile/catalog/game UI remains in later
phases. Pressing buttons does not create a session or admit a player to a room.

| Result                                                      | Webhook behavior                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Completed backend receipt / expired retained receipt        | 200 `{ok: true}`, no resend                                       |
| Valid unsupported update                                    | 200 after distributed admission, no workflow effects              |
| Reply required                                              | Send through grammY, persist backend acknowledgement, then 200    |
| Missing/invalid secret                                      | 401, no admission or parsing                                      |
| Forbidden browser/proxy transport                           | 403                                                               |
| Invalid envelope/JSON, oversize, media type                 | 400 / 413 / 415                                                   |
| Backend/send/ack failure, rate limit, timeout or saturation | 503 with Retry-After hint; no successful delivery acknowledgement |

No local retry loop retries ambiguous sends. Telegram redelivery resumes the
durable workflow after the lease permits it. Retry-After is a hint, not a promise
about Telegram scheduling. Notification duplicates/loss remain possible per
ADR-016; account effects are idempotent. Do not add grammY conversations/sessions
or an auto-retry plugin without reviewing these deadlines and guarantees.

## Safe development verification

The owner authorized live changes **only to the configured development bot**,
without token exposure or rotation. Use a secret-aware API client: never place
the token in shell arguments, output, saved URLs, screenshots or diagnostics.

1. Call `getMe` and verify the intended development identity. Inspect
   `getWebhookInfo`, `getMyCommands`, and `getChatMenuButton`; redact webhook
   paths/error descriptions that could include sensitive data.
2. Verify a controlled HTTPS webhook endpoint is running and reachable from
   outside its host, with valid TLS and protected admission. Do not point a live
   bot at loopback/private/unverified endpoints or silently replace an existing
   working webhook. No tunnel or deployment is created by this phase.
3. Commands for this implementation are `start` (Open HamBazi), `create` (Create
   an account), and `cancel` (Cancel account creation). Use the commands menu
   unless the actual Mini App URL is already deployed and verified.
4. If configuring the verified development webhook, set the exact URL and secret,
   `allowed_updates: ["message"]`, and an explicit bounded `max_connections`
   consistent with the configured resource cap. Preserve pending updates:
   **never use `drop_pending_updates: true`**. Telegram's supported external
   webhook ports and certificate requirements must be observed.
5. Verify settings via read-back calls. In an owner-controlled test chat, exercise
   `/start → Create Account → name → Open HamBazi`, cancellation, invalid name and
   Bot restart. Never send test messages to an arbitrary real user.
6. Confirm one account and stable handle, no tokens/names in telemetry, and no
   repeated account effect on redelivery. Do not claim live smoke from `getMe`
   alone; webhook ingress and actual chat interactions must succeed.

The initial implementation session could not reach Telegram (`ECONNREFUSED`;
hostname resolved to a private address). On the authorized retry (2026-09-21),
the available HTTPS proxy environment worked: curl established a successful
CONNECT tunnel and verified Telegram TLS without disabling certificate checks.
`getMe` verified the configured bot as `@Hambazidev_bot`. `getWebhookInfo`
reported no registered webhook, zero pending updates and no last error;
`getMyCommands` initially returned an empty list and `getChatMenuButton` returned
the commands menu. Registered the three commands above in the default scope and
default language and verified the exact command/description list by read-back.
The commands menu was already correct and remained unchanged. Final webhook
read-back still showed no webhook and zero pending updates.

Only the Bot token was available among Bot settings in the project/process
environment; no controlled public webhook endpoint, Mini App URL or complete
Bot runtime configuration was supplied. No webhook was registered/deleted and
no updates were consumed or discarded. End-to-end webhook/chat smoke remains
outstanding until that environment and an owner-controlled test chat are
available. Proxy-aware curl verification does not establish proxy support in
the running grammY process; its outbound connectivity must also be verified
from the deployment environment. The token stayed in memory/private stdin,
never command arguments or output, and was not rotated. No system DNS/proxy
settings or deployment were changed.

The owner subsequently deferred live webhook end-to-end verification until a
public HTTPS environment is available and authorized proceeding to Phase 7.
Keep this as an outstanding staging/release verification item; it does not block
local implementation of profile/settings/catalog and must not be reported as a
passed live onboarding test.

## Failure, shutdown and rollback

Redis failure denies admission through API; DB failure cannot produce successful
workflow completion. Invalid service credentials or backend contracts also keep
webhooks unsuccessful until configuration is corrected. Alert on fixed failure
events, never raw SDK errors (which can contain credentials/payloads). Bot logs
only event, requestId, durationMs and errorCode. There is no dedicated Bot health
HTTP route yet; startup probe, process supervision and webhook error monitoring
must not be mistaken for continuous dependency readiness.

SIGTERM/SIGINT stop admission, drain active requests, then close the backend
agent; a 30-second process deadline bounds shutdown. Existing receipt leases
recover interrupted work. Stop traffic before rollback and preserve metadata and
queued Telegram updates. Do not flush Redis, delete accounts or drop receipt
tables. Keep Bot/API lease and service-key configuration aligned on every replica.

## Verification

- `pnpm --filter @hambazi/bot test`: mapping, correlation, send/ack ordering,
  failure and actual SDK cancellation tests.
- `pnpm --filter @hambazi/bot test:integration`: ephemeral TLS webhook/client,
  certificate validation, strict/error responses, quotas, drain, runtime startup,
  real grammY requests to a synthetic HTTPS Bot API and flood retry handling.
- `pnpm test:auth-http:local`: isolated PostgreSQL/Redis, full synthetic
  webhook→private HTTPS→durable Auth/Users flow, duplicate/concurrent delivery,
  Bot reconstruction, send/ack interruption, and existing migration/restart/Worker
  regressions. Requires explicit isolated PostgreSQL binaries and Docker.
- `pnpm check`: formatting, lint, architecture, strict types, unit tests, builds
  and unchanged public/internal OpenAPI checks. Build Bot/Worker before the
  database integration harness; test-only cross-process wiring uses built Bot
  artifacts, not a production API→Bot dependency.

grammY 1.46.0 is pinned. Its Node declarations need the pinned node-fetch v2 type
package and narrow Body/BodyInit aliases for unused framework adapters; the
Node preset remains DOM-free and `skipLibCheck` remains false. The legacy
AbortSignal type boundary is explicitly adapted and behaviorally tested. No
database migration or wire-schema change is required by B3B.

References: [Telegram webhook API](https://core.telegram.org/bots/api#setwebhook),
[grammY API cancellation](https://grammy.dev/ref/core/api),
[webhook reply limitations](https://grammy.dev/guide/deployment-types#webhook-reply).
