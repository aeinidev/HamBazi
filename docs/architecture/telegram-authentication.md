# Telegram authentication boundary

The first entry slice in [ADR-062](../adr/062-chosen-entry-name-and-telegram-photo.md)
adds a narrowly validated, optional signed `user.photo_url` projection and a new
registered-session-photo route. The historical Phase 6A1 scope below describes
its original delivery; the current route still requires verified identity,
durable registration and admission. The original v1 session response is unchanged.

Phase 6A3 transport/configuration behavior and runnable commands are documented in
[Authentication HTTP runtime](auth-http.md). The staged sections below retain the
scope and limitations of their original verifier/session-only deliveries.

## Delivered scope: Phase 6A1

`apps/api/src/auth/index.ts` exposes `createTelegramVerifier`, its synchronous
verification port, and narrow identity/policy types. Module assembly wires the
Node crypto adapter; the domain has no framework or infrastructure dependency.
No HTTP route, Nest/Fastify startup, application session, Users lookup, database
write, or network operation exists in this subphase.

The caller passes a secret wrapper with an explicit `reveal()` and a policy:
`maxAgeSeconds`, `maxFutureSkewSeconds`, `maxBytes`, `maxFields`. All must be safe
integers; age and bytes are positive, future skew is nonnegative, and fields must
allow at least `auth_date`, `user`, `hash`. The verifier snapshots the policy and
derives its private HMAC key once. Policy values have no implicit production
defaults. Runtime configuration and sensible bounded operational values are a
Phase 6A3 prerequisite. Each call receives trusted server time in milliseconds;
never populate this argument from a request field.

## Verification sequence

1. Reject non-string/empty input, invalid server time, malformed Unicode, and
   input exceeding the configured raw UTF-8 byte cap. Cap query field count.
2. Decode form values exactly once (`+` means a space). Reject malformed percent
   encoding/UTF-8, missing `=`, duplicate decoded keys, noncanonical field names,
   and decoded newline, carriage-return, or NUL separators. These fail-closed
   parsing restrictions prevent ambiguous canonicalization. JSON-escaped
   newlines inside a profile remain ordinary escaped JSON text at this stage.
3. Require one 64-character hexadecimal `hash`. Sort every other decoded field
   by ASCII key and join `key=value` entries with newlines. Unknown additive
   fields and `signature`, if present, are included in HMAC mode. Do not confuse
   this with Telegram's distinct third-party Ed25519 verification procedure.
4. Derive the binary key using HMAC-SHA-256 with literal `WebAppData` as key and
   the bot token as message. HMAC the canonical string with that binary key.
   Compare the received and computed 32-byte digests with Node's
   `timingSafeEqual`. Only this equal-length comparison is constant-time; neither
   parsing nor the entire future endpoint is claimed to be constant-time.
5. After signature verification, require a canonical decimal safe-integer
   `auth_date`. Convert server milliseconds to whole seconds. Accept age at most
   `maxAgeSeconds` and future skew at most `maxFutureSkewSeconds`, inclusively.
6. Parse signed `user` JSON and require a positive safe-integer numeric `id`.
   Return its decimal string, `authDate` in seconds, and optional signed
   `startParam`. Drop all other profile/query/credential fields. The optional
   routing hint is bounded by the raw input cap and is not room authorization;
   its future consumer must validate invitation syntax and admission separately.

The result identifies Telegram's user, not an application account. A top-level
payload `userId`, `initDataUnsafe`, user profile role, or routing hint never grants
application identity, role, room access, or a session. Callers must use the Auth
and Users public ports in later subphases, not trust projected routing hints as
admission tokens.

## Failure and privacy behavior

Untrusted-input failures return the existing fixed `UNAUTHENTICATED` envelope,
without distinguishing missing user, bad signature, stale data or JSON errors.
Startup policy/credential failures throw fixed configuration errors without raw
values or original exception causes. No raw initData, profile, signature, token,
hash, or crypto key is persisted, logged, traced, or attached to errors here.
The verifier has no logger, persistence or network dependency; its private key
exists in process memory, not in an exported DTO. Runtime heap protection and
future framework/request/error telemetry redaction remain separate obligations.

The same valid initData can verify repeatedly within its accepted window.
Freshness is a bounded replay window, not single-use enforcement. Input caps
bound this synchronous unit's work, not request rate or HTTP JSON parsing before
the verifier. Do not expose it as an endpoint before Phase 6A3 adds transport
limits, distributed rate limits, session issuance idempotency and safe telemetry.

## Validation and remaining gates

Tests enter through the Auth index. A pinned synthetic vector was independently
computed using Python standard-library `hmac`/`hashlib`; no live Telegram token or
user data was used. Further synthetic vectors exercise ordering/encoding, added
signed fields, tampering, wrong bots/derived keys, freshness boundaries, malformed
input, safe-ID projection, limits, startup failures and safe outputs. A spy calls
the real Node digest-comparison implementation and asserts equal 32-byte inputs;
this is not a statistical timing proof. The fixed digest is independent of the
test helper and production implementation.

Telegram's published HMAC procedure supplies pseudocode, not a complete
bot-secret-bearing fixture used by this suite. Do not label these synthetic
fixtures “official Telegram vectors.” A controlled live Mini App smoke test
remains an integration gate for Phase 6A3, without retaining its raw credentials
or initialization payload in test artifacts or telemetry. HTTP redaction, live
Telegram launch behavior, database sessions, Redis abuse controls, Socket expiry,
and browser storage behavior are not established by these unit tests.

Phase 6A2 implements durable signed sessions and identity resolution; Phase 6A3
integrates the versioned REST endpoint. Parent Phase 6A completes only after
those gates. [ADR-014](../adr/014-mini-app-session-strategy.md) records the approved
no-refresh, memory-only signed-token lifecycle, not an already working issuer.

## Protocol references

- [Telegram Mini App validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
- [Node 24 timing-safe digest comparison](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptotimingsafeequala-b)

## Delivered scope: Phase 6A2 sessions

The 6A1 limits above describe the verifier alone. Auth now also exports
`createAuthSessions`, which assembles transport-free `issue(initData, commandId)`,
`authenticate(token)`, and `revoke(token)` application methods. Users exports
`createUserIdentityPort`: it maps existing ACTIVE users through owned scalar
queries and returns only an internal UUID. Auth imports that port, never Users
internals or tables. Unknown/ineligible identities are denied; no account is
created by authentication. Account onboarding transports remain Phase 6B2.

### Phase 6B1 Users creation boundary

Users additionally exports `createAccountCreationPort(database)` and the
`AccountCreationPort`/`Account` types from its public index. The transport-free
`createForVerifiedTelegramIdentity(telegramUserId, displayName)` method requires
an already server-authenticated Telegram identity; possession of an ID or access
to this TypeScript type is not authorization. Auth issuance still performs lookup
only. No HTTP/Bot creation entry point is wired by this subphase.

The method returns a version-1 safe account projection (internal UUID, display
name, stable public handle) or the existing INVALID_INPUT, UNAUTHENTICATED or
INTERNAL_ERROR envelope. [ADR-015](../adr/015-account-identity-policy.md) specifies
the approved Unicode/display-name and human-friendly handle policy, first-create-
wins semantics and bounded database collision retries. Repeats return the same
stored account without renaming or reactivation. Future callers must perform
their own authenticated-boundary and abuse checks; no session is issued here.

### Session composition

Composition injects a database instance, Users port, Telegram verifier, server
clock, explicit lifetime, and signing configuration. There is no environment
read or HTTP server on import. Clock values are checked before/after asynchronous
work, and expiry is exclusive: at `exp`, the session is invalid. The code's large
numeric guard is JavaScript Date's representable range, **not** an acceptable
production lifetime. Phase 6A3 must supply tightly bounded short-lived operational
settings and transport limits before exposing the service.

### Phase 6B2A Mini App onboarding transport

[ADR-016](../adr/016-onboarding-transports.md) is now explicitly approved. The
Mini App portion is implemented; Bot service authentication, webhook receipts
and conversation expiry/cleanup remain Phase 6B2B, not delivered by this route.

`POST /v1/auth/telegram-mini-app/account` accepts a strict version-1 object with
`commandId` (UUID), raw `initData` (maximum 16 KiB) and `displayName` (maximum 256
raw UTF-16 units before Users' normalization). It rejects extra fields such as
client-selected Telegram/internal IDs, public handles and unsigned invite context.
The route requires explicit creation intent and fresh verified Telegram data,
not an existing application session. Existing session issuance still never
creates an unknown account.

Auth exports `createMiniAppOnboarding`/`MiniAppOnboarding`. The service authenticates
initData before calling Users' public creation port, then checks current identity
eligibility and Telegram freshness again after asynchronous work. A blocked or
different resolved identity fails closed. Concurrent eligibility changes linearize
at the final lookup; creation is not a credential and does not bypass later Auth
session checks. No repository/table is accessed outside its owner.

Success is `{ schemaVersion: 1, account, startParam? }`. The account is the safe
Users projection; no Telegram ID, access token, cookie, session or room admission
is returned. The optional `startParam` is copied only from verified signed data,
remains opaque plain routing text, and is bounded by the existing 16 KiB input
cap (also enforced on the response projection). It is not a redirect URL or a
membership grant. The future UI must preserve it in memory, escape display text,
and ask Rooms to resolve/authorize the invitation after session establishment.
Neither initData nor invite context is persisted or logged. See the official
[Telegram direct-link behavior](https://core.telegram.org/bots/webapps#direct-link-mini-apps).

`commandId` is required on every request, and callers should keep it stable for
retries. Per ADR-015, verified Telegram identity is the stronger create-only
idempotency key: even different command IDs cannot create multiple accounts or
rename/reactivate an existing account. No per-command request payload/response
cache is added. Retries return the then-current profile and stable handle, not
a historical profile snapshot. The signed routing context is from the current
request, so a later launch can carry a different hint without changing identity.

Creation can commit before a freshness check, eligibility lookup, connection or
response failure. A failure response is therefore not proof that no account
exists. Retry with the same command ID and fresh initData to recover the original
account; do not compensate by deleting it. Session issuance remains a separate
call to `/v1/auth/telegram-mini-app`, preserving ADR-014's lifetime/revocation rules.

Both routes use the **same** Redis IP and verified-identity quota keys and limits.
IP admission happens before JSON parsing; identity admission follows verification
and precedes account access. Retries consume budget. Redis unavailability returns
503 without admitting account creation; database failures return sanitized 503.
Invalid DTO/name is 400, unverified/ineligible identity is 401, and exhausted
admission is 429 with Retry-After. A post-commit unexpected transport failure may
return 500. Existing no-store, HTTPS/proxy, CORS, body/header/time limits and safe
allowlisted logging apply to the new route without alternate defaults.

The generated authentication OpenAPI and v1 compatibility baseline add only this
path; previous paths/security/schemas are unchanged. Unit/HTTP tests cover forged
identity, input and domain rejection, profile preservation, post-commit recovery,
freshness/eligibility rechecks and redaction. The isolated PostgreSQL/Redis suite
adds concurrent HTTP creation, mixed-route identity and IP quotas, blocked-account
denial, runtime TCP routing and onboarding behavior during actual Redis restart.
PostgreSQL restart compares all committed account metadata without printing it.
These are local synthetic checks, not a live Telegram or staging E2E claim.

### Credential and persistence profile

`jose` 6.2.12 signs HS256 compact JWTs with the approved ADR-014 profile. The strict
header is `alg`, `typ=hambazi-session+jwt`, and configured `kid`. Claims are exactly
`v=1`, UUID `sub`/`jti`, integer `iat`/`exp`, and environment-specific `iss`/`aud`.
Unknown header/claim fields, wrong algorithms/types/keys/bindings, future issuance
and expired credentials fail closed. No remote key lookup is performed. The
codec bounds incoming compact tokens at 4096 characters before decoding.

Provide 1–8 explicit key entries, unique IDs of 1–64 ASCII alphanumeric/underscore/
hyphen characters, and canonical base64url-encoded 32–64 byte secrets through
redacted wrappers. Keys must be independently CSPRNG-generated, not passphrases
or Telegram credentials; length checks cannot prove entropy. Issuer and audience
are required nonempty printable ASCII values up to 256 characters. They and key
IDs are metadata, not secret values. Keys exist only in private process memory.
The caller must provision them securely; no real key or production setting is
committed here.

The additive `sessions` table pins schema version, random session UUID, user UUID,
issuance command UUID, key ID, issuer/audience and issuance/expiry. Only revocation
may change, once. API has SELECT/INSERT and column-only UPDATE on `revoked_at`;
Worker has no session grants. Foreign keys do not allow Auth to query Users.
Credential values, hashes, raw initData and Telegram profile data have no columns.

An insert-if-absent plus unique user/command lookup runs in one short transaction
using PostgreSQL's default READ COMMITTED behavior. Conflicting inserts wait for
the winner; the next statement sees its committed row. Other configured isolation
levels may produce transaction failures, which remain fail-closed rather than
minting duplicate sessions. No crypto signing, cross-module call, or external
network I/O occurs inside the transaction. Timeouts/conflicts return sanitized
failure; there is no unbounded internal retry. The caller may retry the same
command with fresh Telegram verification.

Signing happens after commit. A retry re-signs the pinned claims with the original
key and returns the original expiry, not a renewed session. Revoked/expired
commands cannot recreate a session. Issuance rechecks fresh Telegram data, Users
eligibility and durable session state before returning. A signing failure can
leave committed metadata with no credential delivered; a safe retry reuses it.
Each authentication checks the signature, current Users eligibility, matching
durable metadata and time. Session context contains only schemaVersion, sessionId,
userId and expiresAt. No positive cache can bypass durable revocation.

Access tokens are returned as redacted `SessionCredential` objects backed by the
existing `SecretValue`: JSON serialization and inspection redact the value.
The future successful HTTP response adapter must explicitly call `reveal()`.
This does not permit logging that response, bearer headers, or initData. Generic
errors use existing fixed envelopes: invalid command UUID → INVALID_INPUT;
invalid identity/session → UNAUTHENTICATED; infrastructure/signing failure →
INTERNAL_ERROR, without original causes or SQL/crypto diagnostics. HTTP status
mapping, request telemetry, correlation and retry UX remain Phase 6A3.

### Rotation, revocation and limits

Normal rotation configures a new active key while retaining prior keys until all
their sessions expire, so validation and idempotent retries keep working. During
rolling deployment, distribute the verification key set to all instances before
switching issuance. Never reuse a key ID for different key material. Emergency
removal of a compromised key intentionally denies its tokens/retries. Changing
issuer/audience cannot retarget persisted sessions; use fresh authentication.

Logout requires a valid signed bearer token and updates only its matching session.
Repeated revocations preserve the first timestamp. A validation read preceding
concurrent revocation may finish successfully; a read after completed revocation
must fail. This is not retroactive cancellation of in-flight business operations.
Users eligibility and Auth state are separate port checks, not one cross-module
transaction. Realtime must later enforce expiry/revocation beyond its handshake.

Metadata is not automatically deleted. A future retention/cleanup design must
preserve denial/tombstone semantics for old command IDs; do not remove a revoked
record and let an old command silently mint a new session. No legal retention
period, refresh mechanism, reclaimed game seat or account lifecycle is decided.
Repeated fresh initData with different commands can still create sessions: the
HTTP rate/idempotency abuse controls in 6A3 are mandatory before exposure.

### Session verification commands

- `pnpm exec turbo run test --filter=@hambazi/api` typechecks source/tests and runs
  unit suites with dependency builds. Synthetic test repositories are test-only.
- `pnpm test:auth:local` builds API dependencies and invokes the isolated native
  database harness. Supply `TEST_POSTGRES_BIN`, and `TEST_POSTGRES_SHARE`/loader
  library path if using extracted distribution binaries. No installation occurs.
- The harness rehearses expansion from a populated previous schema, normal
  deploy/redeploy and grants, Prisma-visible drift, database constraints/roles,
  public Auth/Users ports, concurrent issuance/revocation, expiry, eligibility
  changes, unavailable database adapters and restart persistence of metadata.
  Synthetic rows/clusters are removed only by their owning isolated harness.
- Root `pnpm check` includes unit tests, not live integration. PostgreSQL tests do
  not establish Docker/Redis, real Telegram, HTTP redaction, Socket or staging E2E
  readiness. A closed-adapter failure test is not a network-partition drill.

### Session references

- [JOSE signing and verification](https://github.com/panva/jose)
- [JWT security best practices](https://www.rfc-editor.org/rfc/rfc8725.html)
- [PostgreSQL READ COMMITTED conflict behavior](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED)

## Bot service authentication foundation (6B2B1)

`Auth.createBotServiceAuthenticator` consumes validated API-side configuration
from `parseBotServiceConfig`. It has no storage/network/logging effects. Pass
the original Node request `rawHeaders`, `socket.remoteAddress`, and the
server-selected required scope. Duplicate Authorization fields, malformed
credentials, unconfigured peers and non-onboarding scopes return `undefined`.
Never derive the required scope or observed peer from request payload/forwarded
headers. Success conveys service authority only, not a verified Telegram user;
the durable onboarding boundary must validate the authenticated Bot's update.

The configuration parser requires the existing Auth inputs (to reject secret
reuse) plus `BOT_SERVICE_ACTIVE_KEY_ID`, `BOT_SERVICE_KEYS` (JSON array of one or
two `{id, secret}` entries), `BOT_SERVICE_ALLOWED_PEERS` (comma-separated exact
private/loopback IPs) and `TELEGRAM_WEBHOOK_SECRET` (32–256 allowed ASCII
letters/digits/underscore/hyphen). Configuration and errors redact secrets. This
parser is API-only; the Bot must never receive database or session signing keys.
No credentials are generated or defaults supplied, and existing API startup
does not invoke this parser until internal transport composition is delivered.

See [ADR-016](../adr/016-onboarding-transports.md) for credential format, rotation
and ingress gates. Exact peer matching uses Node's
[BlockList address matching](https://nodejs.org/download/release/v24.1.0/docs/api/net.html#blocklistcheckaddress-type),
including mapped IPv4 addresses; these rules are used as an allowlist here.
An allowed private proxy is not evidence that a request originated internally.
Production internal-only HTTPS, webhook verification, Redis limits, receipts,
conversation fencing, cleanup and Bot delivery are **not implemented by B1**.
Tests include real loopback HTTP framing, not a production TLS/ingress rehearsal.

## Durable Bot onboarding (6B2B2)

`Auth.createBotOnboarding` composes Auth-owned storage, the Users eligibility and
account-creation ports, an injected clock and an explicit `leaseMs` (1000–60000).
It exposes versioned `process`, `acknowledge` and trusted `cleanup` operations;
no HTTP route or runtime scheduler is enabled yet. Exported strict Zod schemas
describe the internal update/ack DTOs; B3 must use them in its versioned internal
HTTP contract rather than accepting arbitrary Telegram payloads.

`process` accepts schema version 1, update ID, original message ID, sender/chat
IDs, private chat type and one of START/CREATE/CANCEL/NAME. NAME additionally
requires a bounded display name and the replied-to prompt message ID. Service
context supplies bot identity; sender/chat equality is mandatory. The Bot must
verify the original update first, ignore edited updates, and replay its original
fields unchanged. This privileged port is not Telegram authentication by itself.

Successful operation statuses are:

- `REPLY`: a committed reply intent plus receipt ID/version and destination chat.
  Send through Telegram, then acknowledge with the returned message ID.
- `DONE`: delivery acknowledgement was persisted, so a duplicate needs no send.
- `EXPIRED`: the retained update receipt is expired and cannot be resumed.
- `RETRY`: work is pending/busy or a dependency failed. **Do not acknowledge the
  Telegram webhook as successfully processed**, even though the application
  result uses `ok: true` to distinguish this protocol status from input errors.

Invalid input/service contexts use existing fixed error envelopes. No raw error,
credential, name or update is logged or attached to a response. Reply intents
are enumerated, not persisted message text. Users owns display-name validation,
stable handles, UUIDs and the account's natural identity idempotency.

See [ADR-016](../adr/016-onboarding-transports.md) for the admission linearization
point, lease limitations, prompt correlation, seven-day receipt and 15-minute
flow lifetimes, and best-effort reply semantics. After expiry, cleanup is bounded
and idempotent; deleting metadata never deletes accounts. Prompt/version IDs
cannot substitute for service authentication. A configured private peer alone
also cannot substitute for dedicated internal HTTPS ingress.

Validation uses `pnpm --filter @hambazi/api test` for application/DTO tests and
`pnpm test:auth-http:local` with explicit isolated PostgreSQL binaries for real
two-client races, recovery, rollback, expiry, ACL-protected Redis regressions,
schema/grant checks and database restart persistence. The restart harness
preserves old-release accounts/sessions across expansion and snapshots new
pending receipts/conversations across a real PostgreSQL restart. These checks
do not claim live Telegram delivery or production ingress validation.

B3A now composes these ports on an opt-in, separate internal HTTPS listener,
with distributed admission limits and Worker-owned cleanup scheduling. See
[internal transport operations](bot-internal-transport.md) for required settings,
the separate internal OpenAPI, HTTP retry mapping, ingress controls, maintenance
grants and rollback. The public listener remains unchanged. B3B now supplies the
separate grammY process and webhook delivery; see [Bot runtime operations](telegram-bot-runtime.md)
for configuration, retry behavior and the outstanding live-network verification gate.
