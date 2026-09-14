# Authentication HTTP runtime — Phase 6A3

## Scope and ownership

The API now runs NestJS with its Fastify adapter. Auth's controller module calls
the existing application ports; it does not create accounts or query Users tables.
Composition owns process startup, transport hooks and safe telemetry. The Auth
index exports named assembly helpers for composition in addition to application
ports; these factories must not be mistaken for domain APIs. Importing them starts
no server or connection. `composition/main.ts` is the executable entry point.

The approved profile is [ADR-014](../adr/014-mini-app-session-strategy.md).
Session credentials are only revealed in the successful issuance response.
Clients must keep them in memory, never persistent browser storage, cookies or
URLs. No refresh endpoint exists. A continuously open WebView may need a new
Telegram launch after the configured absolute session lifetime, even during play.
The later reconnect/UI phases must handle that interruption without weakening
freshness or treating an expired session as authority.

## Wire contract

| Route                             | Input                                                        | Successful response                                             |
| --------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `POST /v1/auth/telegram-mini-app` | JSON `{schemaVersion: 1, commandId: UUID, initData: string}` | `{schemaVersion: 1, tokenType: "Bearer", accessToken, session}` |
| `GET /v1/auth/session`            | One `Authorization: Bearer …` header; no query parameters    | `{schemaVersion: 1, session}`                                   |
| `POST /v1/auth/logout`            | Bearer header and JSON `{schemaVersion: 1}`                  | `{schemaVersion: 1, ok: true}`                                  |

`session` contains only `schemaVersion`, internal `sessionId`/`userId` and absolute
`expiresAt` in Unix seconds. Do not put a client-selected user ID in any intent.
Issuance requires an already existing ACTIVE account; unknown users receive the
same authentication denial, not automatic onboarding. Account creation is 6B.
Logout is a set-to-revoked operation, idempotent for the bearer until token expiry;
it needs no additional command identifier and cannot reverse revocation.

Malformed DTOs/query parameters return 400, invalid authentication 401, prohibited
origin/insecure production transport 403, unknown routes 404, oversized bodies
413, unsupported media 415, exhausted issuance limits 429, unexpected adapter
errors 500, and unavailable session/rate infrastructure 503. Bodies use the fixed
existing error envelope, not exception/validation messages. 429 includes integer
`Retry-After` seconds. Existing `INTERNAL_ERROR.retryable=false` is preserved,
including 503; this phase does not silently change the shared error contract or
authorize an automatic retry loop. A deliberate issuance retry uses the same
command UUID and fresh Telegram data, never a new UUID per network retry.

The OpenAPI document and initial v1 compatibility baseline are in `docs/contracts`.
Feature-owned Zod schemas generate OpenAPI 3.1. The conservative check permits
description edits and new paths, but rejects changes to existing operation schemas
or security definitions, including some changes that might be wire-compatible.
Do not regenerate the baseline to bypass review. Breaking changes require a new
namespace/version and ADR. No realtime schema is introduced in this phase.

## Explicit runtime configuration

Use the existing API configuration (`NODE_ENV`, `API_DATABASE_URL`, `API_REDIS_URL`,
`API_PORT`, `ALLOWED_ORIGINS`) plus all of these inputs. There are no implicit auth
defaults; the recommended numbers below are the owner-approved starting profile.
Inject real credentials through the environment's secure secret mechanism. Never
paste them into source, shell history, reports, test fixtures or logs.

| Variable                            | Requirement / approved starting value                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`                | Actual bot credential; redacted runtime wrapper                                                          |
| `AUTH_SESSION_SECONDS`              | `900`; allowed 60–1800                                                                                   |
| `AUTH_TELEGRAM_MAX_AGE_SECONDS`     | `300`; allowed 30–600                                                                                    |
| `AUTH_TELEGRAM_FUTURE_SKEW_SECONDS` | `30`; allowed 0–30                                                                                       |
| `AUTH_IP_LIMIT`                     | `30`; allowed 1–300 per 60-second window                                                                 |
| `AUTH_IDENTITY_LIMIT`               | `6`; allowed 1–30 per 60-second window                                                                   |
| `AUTH_ACTIVE_KEY_ID`                | ID present in the signing key set                                                                        |
| `AUTH_SIGNING_KEYS`                 | JSON array of 1–8 `{id, secret}` entries; secret is canonical base64url of 32–64 CSPRNG bytes            |
| `AUTH_ISSUER`, `AUTH_AUDIENCE`      | Explicit, distinct-environment printable ASCII bindings, 1–256 characters                                |
| `API_TRUSTED_PROXIES`               | Explicit empty string for no proxy, or comma-separated IP/CIDR allowlist; no trust-all/hop-count or `/0` |
| `API_BIND_ADDRESS`                  | Explicit bind IP; use loopback for local execution                                                       |
| `API_DB_POOL_MAX`                   | Explicit per-process pool limit, 1–100; choose for the environment, not from an assumed CCU              |

Duplicate key IDs/bytes, noncanonical encodings and direct reuse of bot-token
bytes as a signing key are rejected. Configuration cannot prove entropy or that
keys were independently generated: operators remain responsible for that.
Neither keys nor credentials are returned in generic serialization/inspection.
Keep old keys until outstanding sessions expire during normal rotation.

Production database and Redis URLs retain existing TLS requirements. HTTPS
termination belongs at the explicitly trusted ingress; this API does not invent a
certificate/hosting provider. The ingress must strip/replace client forwarding
headers, protect the API from direct untrusted reachability and disable sensitive
request/response logging. A spoofed forwarding header from an untrusted peer does
not bypass HTTPS enforcement or change the rate-limited IP.

## Resource, abuse and failure boundaries

The transport caps JSON at 32 KiB, raw initData at 16 KiB/32 fields, headers at
16 KiB, request/header receipt at 10 seconds, connection inactivity at 15 seconds,
keep-alive at 5 seconds, and requests per socket at 100. These are per-request
limits, not proof of total process capacity. Node may reject malformed/oversized
headers before Fastify exists for that request; such responses need not have the
JSON envelope or application correlation ID. They contain no reflected payload.

IP admission occurs before body parsing. Verified-identity admission occurs before
the session use case; that use case independently re-verifies Telegram data and
eligibility, so the limiter cannot manufacture account authority. Redis scripts
atomically initialize a counter and 60-second TTL, saturate at the limit and do
not prolong the window on rejection. Counters are scoped by issuer, kind and
subject digest. Subject digests are not credential hashes or strong anonymization.
No raw initData, bearer token, signature or authentication hash is stored in Redis.

Redis commands have a one-second deadline, a 256-command queue cap and no offline
queue. Connection attempts have a two-second timeout with bounded reconnect
backoff; startup waits at most three seconds for readiness. If unavailable, auth
issuance returns 503; existing durable inspection/logout do not depend on Redis.
Redis loss resets ephemeral budgets, not sessions. Fixed windows permit adjacent
window bursts; NAT/VPN users share an IP budget. Authenticated-route distributed
abuse protection, ingress/global quotas and launch load tests remain security/
capacity work and must preserve durable logout during Redis outages.

Database pool acquisition/connection waits are bounded at two seconds and session
transactions at five seconds. This is not a PostgreSQL statement-timeout or
network-partition guarantee for every read. Graceful shutdown closes HTTP before
Redis/database clients, with a 15-second process deadline. No migration runs at
API startup; operators use the existing migration workflow first.

## Telemetry

Nest/Fastify default loggers are disabled. Pino emits only constructed
`event`, server-generated `requestId`, `durationMs`, and optional stable `errorCode`
(plus Pino's level). API lifecycle events have fixed names. URLs, caller request
IDs, IPs, headers, bodies, tokens, exception messages/stacks and arbitrary objects
never enter this logger. Requests cannot select their correlation identifier.
Responses carry no-store, restrictive API-only CSP, nosniff, frame denial and
referrer policy; production adds HSTS. Known-origin CORS permits only the needed
methods/headers and never enables credentialed cookies. Broader tracing/Sentry
and health endpoints remain their own phase.

## Commands and verification

- `pnpm --filter @hambazi/config test` checks bounded configuration and redaction.
- `pnpm --filter @hambazi/api test` runs application and HTTP tests with synthetic
  credentials. HTTP tests use the actual Nest/Fastify pipeline and a loopback TCP
  probe; test-only persistence/rate ports are not installed in the runtime.
- `pnpm --filter @hambazi/api build`, then `contract:generate` or `contract:check`
  in that workspace generates/checks the document. Root `pnpm check` also runs
  the contract check after build; API tests include the baseline in Turbo inputs.
- With dependencies built, migrations applied, secure environment supplied and
  services reachable, `pnpm --filter @hambazi/api start` starts the real API. It
  does not create demo users or silently load an environment file.
- `pnpm test:auth-http:local` requires Docker plus `TEST_POSTGRES_BIN` containing
  native `initdb`, `pg_ctl`, `psql` (and optional `TEST_POSTGRES_SHARE`/loader path
  for extracted binaries). It creates a uniquely named, loopback-only Redis
  container from the repository's pinned image and real ACL bootstrap; it wraps
  the isolated native PostgreSQL upgrade/integration/restart harness. It never
  uses the developer's Compose volumes or application database. Synthetic
  containers/clusters and private environment files are removed on completion;
  failed cleanup preserves evidence and reports failure, never broad deletion.
- `pnpm test:auth:local` remains the PostgreSQL-only command; conditional Redis/
  HTTP service tests are explicitly skipped without the combined harness input.

Tests cover two-instance concurrent admission/idempotency, TTL expiry without
extension, ACL denials, outage behavior, Redis restart, immutable session metadata
and PostgreSQL restart. A closed database adapter is not a network-partition
drill. Controlled live Telegram WebView smoke, production ingress/TLS, full Docker
PostgreSQL-volume recovery, staging E2E, reconnect and load/soak gates remain
unverified. Local synthetic verification must never be described as launch-ready.

## References

- [Nest Fastify adapter](https://docs.nestjs.com/techniques/performance)
- [Fastify server and proxy controls](https://fastify.dev/docs/latest/Reference/Server/)
- [Redis client production behavior](https://redis.io/docs/latest/develop/clients/nodejs/produsage/)
