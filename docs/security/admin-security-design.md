# Administrative security design — Phase 17A3

[ADR-039](../adr/039-administrative-security-design.md) records the architecture
requirements and ownership. This document is a design for review and future
7C implementation. No admin identity provider, credential, role assignment,
listener, route, database grant or privileged mutation is implemented here.

## Identity, private ingress and sessions

Use a separate private TLS listener/origin and Admin authentication port with
an explicit issuer/audience/key trust configuration. Product Telegram sessions,
payload user IDs and Bot service credentials never satisfy Admin authentication.
Pin allowed algorithms and local/provider-reviewed keys; never follow a
client-provided issuer/JWKS/key URL. Validate signature, audience, issuer,
expiry/not-before and required MFA evidence. Network access additionally requires
an approved private path and explicit peer/allowlist policy; if an ingress uses
mTLS, authenticate its certificates. Trust forwarded identity/address headers
only from inventoried ingress peers that remove client-supplied equivalents.
Fail closed on missing configuration or unverifiable identity/network evidence.

Require provider-verified phishing-resistant MFA and recent step-up for mutations,
not an `mfa: true` request field. Validate the provider's reviewed assurance/AMR
mapping and authenticate the operator independently of the private host. Recheck
current roles, revoked/disabled status, expiry and step-up freshness for each
action and each retry. Unknown capabilities/roles deny. New actions fail closed
on provider/authorization outages; a committed effect stays committed.

Owner review must select identity provider/enrollment/recovery, MFA assertion
mapping, operator roster, key rotation/revocation propagation and explicit
absolute/idle/step-up durations. No guessed numeric defaults or local bypass
account. Key rotation may overlap reviewed verification keys; it cannot extend
expired assertions or broaden issuer trust. Recovery/break-glass needs a separate
approved audited policy, not disabling MFA during an incident.

If 7C adds an operator browser console, use a distinct origin with framing denied,
strict CSP and no public telemetry payloads. Choose its session transport explicitly;
any cookie-based session needs Secure/HttpOnly, reviewed SameSite, CSRF and exact
Origin checks. Do not repurpose Mini App bearer sessions or resolve its separate
refresh-token question. No operator UI is included in this phase.

## Proposed capabilities (unassigned)

These least-privilege roles are a proposal for the 7C owner review. Grants must
be explicit; roles do not inherit other roles implicitly. Every read is still
privately authenticated and scoped.

| Proposed role       | Permitted capability                                               | Required owner checks                                                                                   |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Observer            | Read bounded sanitized health/config revisions and audit summaries | No hidden state, cards/deck, chat text, initData, tokens or arbitrary profile export                    |
| Game operator       | Request availability/maintenance changes                           | Current revision, stable command ID, capability/engine readiness and reviewed activation approval       |
| Incident operator   | Request termination of one identified Match                        | Current version/state, bounded reason code, explicit approval; no bulk termination shortcut             |
| Statistics operator | Request a reviewed generation rebuild                              | Stable generation/command, approved game/scope, existing trusted rebuild and idempotent worker workflow |

Assignment management, activation approval separation and any two-person approval
require an owner-recorded policy. Reject arbitrary free-form reasons, SQL,
handler names, URLs or rule configuration in generic admin payloads. Maintenance
should stop new admission while preserving pinned active Matches; explicit Match
termination is a different capability. This active-Match proposal must be approved
with 7C's Games/admission semantics before implementation.

## Module ownership and durable audit

Admin owns operator authorization, admitted action identity and immutable audit.
Games owns configuration/revision/readiness and new admission. Matches owns
termination through its existing trusted port and atomic state/event writer.
Leaderboard/Worker owns generation rebuild. Only public application ports connect
these capabilities; no foreign repository imports, Prisma models, direct SQL or
hidden-state inspection. Existing safe logging remains ADR-031/033 allowlisted.

The following sequence is the proposed implementation protocol:

1. Bound/validate the DTO, authenticate private access and operator/MFA, authorize
   the exact capability, and validate the stable command ID. Bind idempotency to
   actor and a digest of normalized allowlisted inputs; mismatched retry denies.
2. Durably append an admission record before calling the owner. If admission
   audit is unavailable, deny the mutation. A bounded authenticated denial may
   also append a separate outcome; pre-auth floods get only safe aggregate
   counters so they cannot exhaust the durable audit stream.
3. Pass the verified actor/capability context and original command ID through
   the trusted application port. The owner independently checks its current
   state/revision/readiness and commits the effect, processed receipt and a
   versioned content-free outcome outbox atomically. No network I/O in that
   transaction. The Admin adapter never declares success before the owner commit.
4. Consume the owner's committed outcome and append an immutable audit event
   deduplicated by eventId. This is at-least-once delivery with eventual audit
   completion, not a cross-module distributed transaction. Safe fixed error
   codes/outcome IDs correlate denials and success without request/error blobs.
5. Recover admitted actions with missing outcomes through owner receipts/outbox,
   keeping the same action identity. Alert on unreconciled admissions using
   approved bounded thresholds. Never guess success, allocate a new command
   automatically, or resubmit through direct database writes. Retry still checks
   present authority; revocation prevents a retry even if its old result exists.

Audit fields are version/event/action IDs, opaque operator subject, capability,
target kind/ID, expected/result revision, fixed reason/error/outcome codes,
server time, approved authorization policy/assurance identifiers and safe
correlation IDs. These private audit fields need their own explicit schema/access
policy; they do not expand the public telemetry allowlist. Never store initData,
token/signature/hash, raw MFA assertion, chat/private game state, RNG material,
unbounded user text or raw HTTP/Socket/error data. A normalized non-secret command
digest is not an authentication credential hash.

Use separate least-privilege Admin credentials with append/select on owned audit
tables only; owner credentials write only their owning state/receipt/outbox.
Protect audit UPDATE/DELETE and truncation with grants plus append-only triggers,
tested using actual runtime roles. Auditing does not justify permanent retention:
OD-005 must set access/export/erasure/retention and any independently authorized
maintenance identity before deployment. Do not grant the normal app a deletion
escape hatch. Immutable events may record later correction; originals stay intact
within the approved retention policy.

## 7C verification and remaining gates

| Threat/failure                                                            | Required future proof                                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Player/Bot credential, forged issuer/key source or request MFA flag       | Denied before owner mutation/audit admission; no key-source network request             |
| Missing/wrong/expired step-up, revoked operator or unknown role           | Explicit capability denial, including retries and privilege changes                     |
| Public ingress, spoofed forwarded peer, CSRF/foreign console Origin       | Private access and exact origin checks hold independently of operator token             |
| Concurrent config change, activation without readiness, stale termination | Owner revision/readiness/state guards; maintenance/admission race has one valid outcome |
| Audit outage before admission                                             | Zero owner effects; fixed safe error                                                    |
| Commit/crash before outcome, duplicate/reordered outbox or retry          | One durable effect, eventual deduplicated outcome, original action retained             |
| Compromised normal API/Worker/Admin credential                            | Real-role grant tests deny foreign writes and audit UPDATE/DELETE/TRUNCATE              |
| Payload/log/report inspection                                             | No credentials, private state, chat or raw errors in audit or telemetry                 |

Current 17A3 HTTP tests prove operator mutation paths are absent even with a valid
player session or a service-shaped bearer. They do not claim implemented RBAC,
MFA or provider integration. Complete all future 7C tests, versioned contracts,
failure/recovery drills and reviewed deployment network evidence before activation.
OD-002/005/007 and Coup rights OD-008 remain external owner gates. Existing
[operational runbooks](../operations/runbooks/README.md) remain usable within
their explicitly approved ports; this design grants no incident bypass.

References: [NIST authenticator requirements](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/)
for reviewed phishing-resistant MFA terminology; architecture and the accepted
ADRs govern the actual HamBazi implementation requirements.
