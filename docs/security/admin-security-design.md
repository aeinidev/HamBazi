# Administrative security design — Phase 17A3

> **بازنگری معتبر فاز یک — ۲۰۲۶-۱۰-۲۵:** [ADR-081](../adr/081-admin-local-password-and-owner-pin.md) تصمیم جدید و مرجع احراز هویت Admin است: ورود محلی Username/Password، مرحلهٔ PIN ثابت شش‌رقمی فقط برای OWNER، قفل دائمی پس از سه PIN اشتباه و بازیابی خصوصی با دو proof مستقل. Password + PIN ثابت **MFA مستقل یا مقاوم به فیشینگ نیست**. بندهای قبلی OIDC/IdP، MFA خارجی، ورود/دعوت بر اساس subject خارجی و بازیابی provider در این سند در محدودهٔ Admin منسوخ‌اند؛ اصل OWNER/RBAC/private ingress/audit و یکپارچگی بازی حفظ است. فاز یک با تأیید صریح مالک آغاز شده؛ [گزارش اجرایی فاز یک](../implementation/admin-dashboard-phase-1.md) دامنه و شواهد جاری را مشخص می‌کند. فاز دو، حساب واقعی و deployment مجوز ندارند. مطالب «فقط Markdown/فاز صفر» در بخش‌های قدیمی، سابقهٔ زمان تدوین‌اند.

[ADR-039](../adr/039-administrative-security-design.md) records the architecture
requirements and ownership. This document is a design for review and future
7C implementation. No admin identity provider, credential, role assignment,
listener, route, database grant or privileged mutation is implemented here.

**2026-10-25 amendment:** [ADR-079](../adr/079-owner-and-admin-access-control.md)
and the [Persian access specification](../architecture/admin-access-control.md)
govern protected OWNER authority, custom RBAC, individual ALLOW/DENY scopes,
administrator management and OWNER_FINAL decisions. The original Phase 17A3
security boundaries remain in force. "Owning module" and human `OWNER` are
different concepts; neither human role grants raw persistence access.

## Local identity, private ingress and sessions — ADR-081

یک صفحهٔ Username/Password و هیچ signup عمومی وجود دارد. فقط backend اعتبارسنجی می‌کند؛ root binding، نه input/role/provider claim، OWNER را تعیین می‌کند. مدیر عادی مستقیم FULL و مالک ابتدا PENDING بدون مجوز، سپس با PIN ثابت شش رقم وارد می‌شود. هیچ Telegram/Google/OIDC/TOTP/Authenticator/SMS/email در این ورود وجود ندارد. **Password و PIN ثابت MFA مستقل یا phishing-resistant نیستند.**

Argon2id با saltهای مستقل و HMAC PIN pepper خارج DB، verifierها را محافظت می‌کند. کلید امضای session، pepper و command/CSRF key مستقل‌اند. raw credential/verifier/token/cookie در log/audit/response ممنوع است؛ فقط verifier در جدول Admin استثنای محدود مصوب بر ممنوعیت تاریخی credential hash است. روی verifier ذخیره‌شده پیش از KDF محدودیت پارامتر اعمال می‌شود. هزینه و همزمانی KDF، pool و درخواست‌ها bounded هستند.

پس از password معتبر، wrong PIN در transaction قفل‌شدهٔ PostgreSQL شمرده می‌شود؛ failure سوم lockedAt دائمی و epoch جدید ایجاد می‌کند. retry همان intent دوباره شمرده نمی‌شود. password غلط اصلاً PIN را بررسی یا شمارنده را زیاد نمی‌کند. موفقیت کامل شمارنده را فقط پیش از lock صفر می‌کند. قفل زمان‌دار یا Redis-based نیست. verify/hash خارج transaction و مصرف نتیجه با credentialVersion/sessionEpoch fencing انجام می‌شود. counter، receipt و Audit یک commit دارند؛ Audit failure صفر اثر دارد.

cookieهای pending/full جدا، Secure/HttpOnly/SameSite=Strict/Path=/ و بدون Domain هستند. هر login cookie نوع دیگر را پاک می‌کند؛ pending هرگز برای Admin API معتبر نیست. Origin/Host/peer/TLS دقیق، JSON، CSRF متصل به همان session و عدم پذیرش Authorization/forwarded identity لازم است. هیچ credential در storage مرورگر نیست. نشست و grants در primary در هر gate خوانده، disable/revoke/credential epoch فوراً برای gate جدید اعمال می‌شوند؛ foreground UI حداکثر پنج ثانیه و در visibility change دسترسی را بازبینی می‌کند. request از قبل admitted محدود و قابل undo فرض نمی‌شود.

Bootstrap/recovery فقط port/ابزار خصوصی، با OS operator معتبر، explicit confirmation و دو امضای مستقل action-bound خارج DB است. recovery PIN را تعویض، lock را رفع و تمام نشست‌های قبلی را invalid می‌کند؛ root/password را تغییر نمی‌دهد. runtime credential اجازهٔ unlock root قفل‌شده، rebind، ساخت role/مدیر یا نوشتن دادهٔ بازی ندارد. credential ویژهٔ recovery و امضاکنندگان در runtime نگه‌داری نمی‌شوند. هیچ unlock/forgot/bootstrap route عمومی یا حساب پیش‌فرض وجود ندارد. custody واقعی، proof drill، retention و شبکه قبل از حساب واقعی همچنان gate هستند.

در فاز دو OWNER_FINAL حفظ می‌شود، با password+PIN تازه به همان action/target/digest/version/realm و reason، نه MFA خارجی یا flag bypass. درخواست حساسِ قبل از تغییر revision دوباره بررسی می‌شود. هیچ break-glass بدون احراز هویت/Audit/domain guard ساخته نشده است.

## Capabilities and protected ownership (unassigned)

ADR-079 replaces the earlier uniform grant model. A singleton protected root
binding grants OWNER every registered administrative capability, including future
ones. Role edits, individual denials or scopes cannot constrain root authority.
Authentication, network, revocation, audit, data policy and domain checks still
apply. All other roles use explicit versioned templates/custom grants and scoped
individual overrides, with matching DENY taking precedence. The full default
Super Admin/Moderator/Support/Operator/custom matrix is in the access specification.
The narrower capability examples below remain useful, not an exhaustive role registry.

| Proposed role       | Permitted capability                                               | Required owner checks                                                                                   |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Observer            | Read bounded sanitized health/config revisions and audit summaries | No hidden state, cards/deck, chat text, initData, tokens or arbitrary profile export                    |
| Game operator       | Request availability/maintenance changes                           | Current revision, stable command ID, capability/engine readiness and reviewed activation approval       |
| Incident operator   | Request termination of one identified Match                        | Current version/state, bounded reason code, explicit approval; no bulk termination shortcut             |
| Statistics operator | Request a reviewed generation rebuild                              | Stable generation/command, approved game/scope, existing trusted rebuild and idempotent worker workflow |

Operator create/invite/activate/disable/tombstone, role editing/assignment,
individual overrides and other operators' session management are OWNER_ONLY,
not delegable to Super Admin. No other administrator may mutate the protected
owner, its identity/recovery binding or its sessions. Root bootstrap/recovery
are private identity-bound ceremonies, not ordinary role assignment.

High-risk non-owner requests use two distinct authorized humans. OWNER_FINAL
permits the actual OWNER to decide their own or another operator's request with
fresh operation-bound password/PIN proof, a fixed reason, immutable admission/outcome audit and
single-use execution authorization. It records one root decision, never pretends
two people approved. Break-glass is a separate constrained recovery/incident path;
having only one administrator does not require emergency mode.

Reject arbitrary free-form reasons, SQL, handler names, URLs or rule configuration
in generic admin payloads. Maintenance
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

1. Bound/validate the DTO, authenticate private access and operator authentication, authorize
   the exact capability through the OWNER or explicit-grant path, enforce protected
   targets and the current approval mode, and validate the stable command ID.
   Bind idempotency to actor and a digest of normalized allowlisted inputs;
   mismatched retry denies.
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
correlation IDs. ADR-079 additionally requires authority mode, ownership/authz
revision references and operation-bound decision proof references, never raw
proofs. These private audit fields need their own explicit schema/access
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

ADR-079 adds AC-01…AC-22: protected singleton bootstrap and restore replay;
OWNER-only administrator lifecycle; non-owner escalation/target denials;
new-capability OWNER allow versus explicit grants; scoped DENY precedence;
primary-current authorization and five-second connection invalidation with Redis
unavailable; valid OWNER_FINAL without a second administrator; expired/replayed
decision denial; and bounded pre-enrolled emergency authentication. No test is
claimed executed by this documentation update.

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
