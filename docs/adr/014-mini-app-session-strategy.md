# ADR-014 — Mini App session lifecycle (OD-003)

- **Status:** Accepted; implementation staged across Phase 6A
- **Owner:** HamBazi product owner (lifecycle approval), HamBazi engineering (implementation)
- **Date:** 2026-09-14

## Context

Architecture sections 16.2 and 28.2 leave the session/refresh strategy open.
Phase 6A initially paused rather than choosing a public lifecycle implicitly.
The owner was asked to approve short-lived signed access tokens, memory-only
client storage, no refresh tokens, fresh Telegram re-authentication, and
server-enforced expiry and revocation. The owner's subsequent “Continue” is
interpreted as approval of that proposal, as explicitly announced on resumption.
This decision resolves OD-003's lifecycle choice, not other open product decisions.

## Decision

Use short-lived signed application access tokens. Keep them only in client
memory: no localStorage, sessionStorage, durable browser storage, URLs, or refresh
cookies. There is no refresh-token endpoint or refresh credential in the MVP.
After expiry, obtain a new session only through server verification of fresh
Telegram raw `initData`. An expired access token cannot renew itself. If an open
WebView only has stale initialization data, the UI must require a fresh Telegram
launch/re-authentication rather than relaxing the freshness window.

Signature verification alone is insufficient for application authentication.
Session validation must enforce server-side expiry and revocation, including
logout invalidation. Use durable, non-secret session metadata owned by Auth
(session identifier, resolved application identity, issuance/expiry, revocation
state), without persisting raw tokens, token hashes, Telegram hashes, raw
`initData`, or bot credentials. A session identifier by itself is not a bearer
credential. Missing, expired, or revoked records fail closed; inability to verify
durable session state cannot silently authorize a request. Redis is not the
source of truth for sessions. Keep signing key material in secure runtime
configuration, separate from the Telegram bot credential.

Before implementing issuance in Phase 6A2, record the concrete signing format,
algorithm allowlist, issuer/audience, key rotation and validation rules, session
metadata migration/ownership, and expiry/revocation semantics. Phase 6A3 must
validate bounded runtime durations and HTTP resource limits and implement
distributed rate limits and stable retry/idempotency behavior. Numeric timeout
values in verifier unit tests are fixtures, not production defaults. These
implementation details may not weaken this approved lifecycle. Public wire
contracts do not exist yet and must be versioned when introduced.

The verifier authenticates a Telegram identity, not an application account,
room membership, role, or invitation admission. Resolve application identity
through Users' public application port. Do not query Users tables from Auth.
Account onboarding remains Phase 6B. Realtime authentication must use the same
session validation port when introduced, with connection-expiry/revocation
enforcement covered in its phase rather than trusting a handshake forever.

## Phase 6A2 approved implementation profile

The owner explicitly approved the concrete HS256 profile on resumption after the
6A2 decision pause. This supplements, and does not supersede, the lifecycle above.
Use maintained `jose` compact JWT signing/verification, with HS256 as the sole
allowed algorithm. Require `typ=hambazi-session+jwt`, a configured local `kid`,
`v=1`, internal UUID `sub`, random server UUID `jti`, integer-second `iat`/`exp`,
and exact environment-specific `iss`/`aud`. Reject unknown header/claim fields,
client-selected remote keys, missing claims, future issuance, and expired tokens.
Signing keys are explicit redacted runtime secrets: canonical base64url encoding
of at least 32 CSPRNG bytes, separate from Telegram and between environments.
Configuration validates length/encoding, not the unknowable entropy of supplied
bytes; secure key generation remains an operator obligation.

Auth owns an additive `sessions` table. Store schema version, random session ID,
internal user ID, issuance command UUID, key ID, issuer/audience, issuance/expiry,
and nullable revocation time. Issuer/audience are pinned too so configuration
changes cannot silently retarget an existing session. A unique user/command pair
provides issuance idempotency. Insert-if-absent plus selection occurs in a short
database transaction; sign only after commit. Retries require fresh Telegram
verification and an existing eligible Users identity, reuse the original record,
and never extend expiry or undo revocation. Token values/hashes are not stored.
Normal key rotation retains original signing keys through expiry for retries;
emergency removal deliberately invalidates verification and retries for that key.
No numeric production duration or retention/deletion policy is chosen here.

Users resolves only existing `ACTIVE` records through its public identity port;
other/unknown statuses fail closed. This is an authentication eligibility rule,
not a new account status lifecycle. Account creation and onboarding stay in 6B.
Revalidate Users eligibility and durable session state during authentication.
No external network calls occur inside repository transactions. Validation checks
server time again after asynchronous work; a request linearized before concurrent
revocation may succeed, but reads after completed revocation must fail. Logout
uses a valid bearer token, is idempotent, and cannot un-revoke a row. API grants
allow only insert/read and revocation-column updates; Worker gets no access.

Application credentials use the existing redacted `SecretValue` wrapper. Only
the later successful HTTP response adapter may explicitly reveal a token; generic
JSON serialization/inspection must stay redacted. This does not authorize request
body or response logging. Server session context is versioned and contains only
internal user/session IDs and expiry, not Telegram data or signing material.

## Phase 6A3 approved runtime and transport profile

The owner's “Yes, continue with the next phase” after the explicit 15-minute
proposal approves that profile and resumes the same 6A3. It does not authorize
account onboarding, a refresh mechanism, deployment, or a new lifecycle choice.
Require explicit runtime configuration: session lifetime 900 seconds (allowed
60–1800), Telegram initialization maximum age 300 seconds (30–600), and future
clock allowance 30 seconds (0–30). These bounds apply to runtime composition;
domain fixture values remain injected test inputs. Existing session expiry is
pinned and never extended by retries or a runtime setting change.

Use atomic Redis fixed 60-second windows, initially 30 issuance attempts per IP
(configurable 1–300) and 6 per verified Telegram identity (1–30). Retries consume
budget but retain durable command idempotency. Count IP admission before parsing
the body, and verified identity admission before calling the issuance use case.
No credential or credential hash enters a rate key. Subject digests are ephemeral
counter identifiers, not authentication material; they are not telemetry or an
anonymity guarantee. Reject exhausted admission with 429/Retry-After; Redis
unavailability rejects issuance with sanitized 503. Existing PostgreSQL-backed
session inspection and logout remain usable without Redis. Their distributed
abuse controls must preserve that availability property in later security work;
this phase does not claim global DDoS protection. Fixed windows allow boundary
bursts, shared NAT/VPN clients share an IP budget, and Redis restart resets
ephemeral limits. None of these settings determines OD-001 launch capacity.

Introduce version-1 JSON issuance (`schemaVersion`, UUID `commandId`, `initData`),
bearer session inspection, and idempotent logout. Responses expose only the bearer
credential on successful issuance and the safe application session projection.
Use bounded JSON (32 KiB), raw initData (16 KiB/32 fields), headers (16 KiB),
request-receive/header deadlines (10 seconds), connection inactivity (15 seconds),
and keep-alive (5 seconds). Explicit proxy IP/CIDR allowlists may supply forwarded
client addresses/protocol; no trust-all or hop-count mode. Production rejects
non-HTTPS requests as observed through that trusted boundary. Proxy addresses,
bind address, DB pool size and secrets are explicit deployment inputs; no hosting
choice is inferred. Ingress must strip/replace client forwarding headers.

Disable framework request/error loggers and emit only constructed allowlisted
Pino metadata. Never log request/response objects, URLs, headers, bodies, exception
messages/stacks, or signing material. Use known-origin CORS, restrictive API-only
security headers and no-store responses, with no auth cookies. A short absolute
lifetime can interrupt active play and require a fresh Telegram launch; this is
the accepted no-refresh trade-off, not a silent extension of stale initData.

Existing v1 wire schemas/security are conservatively frozen against an initial
compatibility baseline. Documentation edits and new paths are allowed; changes
to existing wire shapes require review and, when breaking, a new namespace/version
and ADR. CI workflow installation remains Phase 18; the local check is wired now.

## Alternatives considered for the implementation profile

- HS256 keeps the issuer/validator simple in the current API process; every
  holder of its secret can sign, so never distribute it to clients or unrelated
  services. Ed25519 was offered as an asymmetric alternative; the owner approved
  HS256. Future verifier-only services would warrant revisiting that trade-off.
- Storing bearer tokens to replay issuance responses would violate the approved
  credential persistence restriction. Re-signing pinned claims avoids that.
- Expired/revoked metadata is retained by this phase to preserve idempotency;
  a later retention policy must preserve denial/tombstone semantics before deletion.

## Lifecycle alternatives

- Rotating refresh credentials in HttpOnly/Secure cookies: can reduce repeated
  Telegram launches, but adds refresh rotation, reuse detection, cookie-origin
  controls and a second credential lifecycle. Not selected for this MVP.
- Opaque server-side bearer sessions: feasible but not the signed-token strategy
  approved by the owner.
- Stateless signed tokens until expiry: simpler validation, but cannot meet the
  approved immediate server-side session revocation requirement on its own.

## Consequences

Short lifetimes limit exposure, but memory-only storage does not prevent active
XSS from using a current credential. Browser hardening, transport security and
safe telemetry remain mandatory. No-refresh re-authentication creates visible
expiry/relaunch friction; the later client must handle this explicitly.
Durable revocation requires database availability and additional validation work.
These costs are accepted rather than silently relying on token deletion in the
browser. An authenticated request already in flight is not retroactively undone
by subsequent revocation; race semantics require tests in the session phase.

Phase 6A1 implements only HMAC verification and its test boundary. It does not
issue tokens, store sessions, expose REST, or prove end-to-end authentication.
Freshness bounds replay age but does not make `initData` single-use: possession
within the accepted window remains sufficient at this verification boundary.
Do not persist credentials/hashes to invent replay prevention. Complete the
issuance/abuse controls before exposing the auth endpoint.

## References

- [Telegram Mini App validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
- [OWASP session expiry and invalidation guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Telegram verification boundary](../architecture/telegram-authentication.md)
- [Implementation plan](../implementation-plan.md)
