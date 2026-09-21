# Internal Bot HTTPS and onboarding cleanup

Phase 6B2B3A implements the private API boundary and Worker maintenance from
[ADR-016](../adr/016-onboarding-transports.md). B3B supplies the grammY process,
webhook verification, outbound client and Telegram reply delivery; see
[Bot runtime operations](telegram-bot-runtime.md) for their settings and validation limits.

## Private API deployment inputs

The existing API start command remains `pnpm --filter @hambazi/api start` after
the normal build. No extra public route is added. `BOT_INTERNAL_ENABLED` absent
or `false` disables the internal listener; `true` requires every field below and
the existing Auth/Bot service configuration described in
[Telegram authentication](telegram-authentication.md). Other flag values fail.

| Variable                      | Required constraint                                                          |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `BOT_INTERNAL_BIND_ADDRESS`   | Exact loopback, RFC1918 IPv4 or IPv6 ULA; no wildcard/DNS/zone               |
| `BOT_INTERNAL_PORT`           | 1–65535, different from `API_PORT`                                           |
| `BOT_INTERNAL_TLS_KEY_FILE`   | Absolute path to a nonempty PEM key file, at most 64 KiB                     |
| `BOT_INTERNAL_TLS_CERT_FILE`  | Absolute path to nonempty PEM certificate/chain, at most 64 KiB              |
| `BOT_INTERNAL_REQUEST_LIMIT`  | 1–300 requests per minute per configured bot, shared across routes/instances |
| `BOT_INTERNAL_IDENTITY_LIMIT` | 1–30 processing requests per minute per bot/sender                           |
| `BOT_ONBOARDING_LEASE_MS`     | 1000–60000; coordinate with future bounded Bot delivery timeouts             |

These ranges are validation bounds, not recommended production capacity. Each
incoming webhook may consume multiple internal requests (admit, process, ack).
Rejected retries consume budget. Internal counters are namespaced separately
from player authentication using the configured issuer; use the same issuer and
limits on all replicas. Avoid mixed configurations during a rolling change.

Mount the key read-only with owner-only file permissions and provision a trusted
certificate with the Bot client's target hostname/IP in its SAN. Do not disable
certificate/hostname verification or use a plaintext upstream. Certificate and
credential rotation require controlled process restarts. Runtime reads PEM files
once; it does not watch secret mounts. Key mismatch, unreadable files, unavailable
Redis or failed private bind causes enabled API startup to fail closed. With the
listener disabled, the existing public API behavior is unchanged.

Do not publish this port through Cloudflare, a public load balancer or the public
reverse proxy. Explicitly firewall it to Bot peers and verify denial from an
external host before enabling Bot traffic. The listener rejects browser Origin
and forwarded headers and authenticates the actual encrypted socket's peer.
Private addresses alone cannot prove isolation when infrastructure forwards raw
TCP; firewall/ingress verification is an operator gate. TLS is terminated by this
listener, with minimum TLS 1.2. Header/body/connection limits are bounded. Logs
contain only allowlisted request ID, event, duration and error code, not URL,
headers, raw errors, submitted names or onboarding payloads.

## Internal wire contract

The [generated internal OpenAPI](../contracts/bot-internal.openapi.json) is
separate from public Auth OpenAPI. All operations require the scoped service
bearer, no query parameters and strict JSON DTOs:

- `POST /v1/internal/bot/admit`: `{schemaVersion: 1}`; rate admission only.
- `POST /v1/internal/bot/updates`: original normalized private update; sender and
  chat must agree. Identity is trusted only because the Bot has authenticated
  the original Telegram webhook; this is not a player-facing endpoint.
- `POST /v1/internal/bot/acknowledgements`: receipt UUID/version and successful
  Telegram message ID; no implied account/session authority.

HTTP 200 returns only a schema-checked result. `REPLY` is not a successful
webhook completion. HTTP 429 or 503 must not acknowledge Telegram delivery;
respect `Retry-After`. Backend pending/retry uses 503 and fixed error text.
Existing generic error-envelope semantics remain unchanged: clients must use
the documented HTTP retry behavior, not just `error.retryable`. Response/output
schemas reject extra fields. No credential, draft text or account record is
returned by this boundary. Public API cannot route these operations.

## Cleanup Worker

Build normally, then run `pnpm --filter @hambazi/worker start`. Configure only
Worker credentials (`WORKER_DATABASE_URL`, `WORKER_REDIS_URL`, `NODE_ENV`) and:

| Variable                  | Required constraint                                                    |
| ------------------------- | ---------------------------------------------------------------------- |
| `WORKER_QUEUE_NAMESPACE`  | 1–64 ASCII letters/digits/underscore/hyphen, identical across replicas |
| `BOT_CLEANUP_INTERVAL_MS` | 1000–3600000                                                           |
| `BOT_CLEANUP_BATCH_SIZE`  | 1–500 expired rows per table per run                                   |
| `BOT_CLEANUP_ATTEMPTS`    | 1–5                                                                    |
| `BOT_CLEANUP_BACKOFF_MS`  | 100–60000, exponential                                                 |
| `WORKER_DB_POOL_MAX`      | 1–20                                                                   |

Production configuration requires TLS database and `rediss` transport with trust
verification. No API/Bot/session credential is needed. The queue prefix is
`hambazi:jobs:<namespace>`; the stable scheduler and job name are
`bot-onboarding-cleanup-v1`. Keep the v1 handler through any future queue-version
overlap. A replica upserts the same scheduler rather than creating another.
Different namespaces intentionally create separate schedules; do not vary them
per replica. Scheduling is best-effort: busy queues/outages can delay runs.

Run the existing database migration/grant deploy command with the migration
role before starting Worker. There is no new migration in B3A; `permissions.sql`
adds only expiry/ID reads and DELETE on Auth's two cleanup tables. No sender,
prompt, session, INSERT or UPDATE access is granted. Database DELETE privilege
is table-wide; the Auth repository constrains eligible rows, transaction size
and rechecks expiry. Worker never queries these tables directly.

Jobs contain only `{schemaVersion: 1, limit}`. Failure reasons are fixed strings;
completed results contain only version and counts. Bounded attempts recover
transient failures; a later periodic run can clean up after attempts exhaust.
The API enforces expiry even when physical deletion lags. Account data is never
deleted. BullMQ's optional native serializer build is disabled; the JavaScript
implementation is used.

## Failures, shutdown and rollback

- **Redis unavailable:** internal admission returns 503 without workflow effects;
  Worker cannot schedule/process until recovery. Preserve durable PostgreSQL
  data. After Redis data loss/replacement, restart Worker to reconstruct its
  scheduler. A surviving Redis queue resumes with idempotent jobs.
- **Database unavailable:** Auth returns retry rather than reporting success;
  cleanup jobs retry with bounded backoff. Inspect only fixed failure events;
  never enable raw SQL/error/payload logging.
- **Shutdown:** SIGTERM/SIGINT stop Worker intake, drain its active job, then close
  Redis and DB. The process hard-exits after 15 seconds if drain hangs; another
  Worker may recover stalled work. There is no Worker HTTP health endpoint in
  this step; use process supervision and safe completion/failure events.
- **Rollback:** stop Bot traffic first (once B3B exists), disable the internal
  listener/restart API, and stop Worker if rolling back its runtime. Keep additive
  tables and grants during overlap. Do not drop onboarding/account data or flush
  Redis globally. Future queued v1 jobs remain safe on reinstatement.

## Verification and outstanding gates

`pnpm check` includes unit/config/real-TLS boundary tests, module rules, types,
builds and both OpenAPI compatibility gates. Test certificates are ephemeral,
generated with OpenSSL and never committed. `pnpm test:auth-http:local` uses
explicit `TEST_POSTGRES_BIN` (and, when needed, `TEST_POSTGRES_SHARE` and library
path) and Docker to create isolated PostgreSQL and ACL-protected Redis. It tests
private HTTPS with real repositories/rate limits and Worker grants, retries,
concurrent cleanup, scheduler reuse and drain, and retains earlier migration,
restart and onboarding race regressions. It never reads production credentials.

These checks do not validate external ingress isolation, production certificates,
live Telegram delivery, staging E2E, backup restore, load or a two-hour soak.
Hosting, launch capacity and other existing open ADR decisions remain open.
