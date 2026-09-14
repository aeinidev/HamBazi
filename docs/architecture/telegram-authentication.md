# Telegram authentication boundary

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
created. Account onboarding remains Phase 6B.

Composition injects a database instance, Users port, Telegram verifier, server
clock, explicit lifetime, and signing configuration. There is no environment
read or HTTP server on import. Clock values are checked before/after asynchronous
work, and expiry is exclusive: at `exp`, the session is invalid. The code's large
numeric guard is JavaScript Date's representable range, **not** an acceptable
production lifetime. Phase 6A3 must supply tightly bounded short-lived operational
settings and transport limits before exposing the service.

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
