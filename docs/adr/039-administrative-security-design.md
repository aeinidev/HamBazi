# ADR-039: Separate administrative authority and audited owner-port mutations

> اجرای محلی فاز دوم در 2026-10-27 مطابق [ADR-085](085-admin-phase-two-operations.md) و استثنای محروم‌سازی کاربران در [ADR-086](086-admin-user-ban-and-session-generation.md) است. این تکمیل، مرز مالکیت داده/Audit و ممنوعیت استقرار بدون تأیید را حفظ می‌کند.

> **تصمیم جدید ۲۰۲۶-۱۰-۲۶ — [ADR-083](083-admin-public-https-and-self-credential-rotation.md):** مسیر استفادهٔ عادی، Public HTTPS با احراز هویت و Reverse Proxy محدود است؛ الزام SSH-only برای مرورگر منسوخ می‌شود. Backend/DB/Redis و Bootstrap/Recovery خصوصی می‌مانند. تغییر Password و PIN خود OWNER و ابطال نشست‌ها ادامهٔ محدود فاز یک‌اند. کد/تست محلی مجاز است؛ نصب سرور، Firewall، فعال‌سازی عمومی، حساب واقعی و فاز دو تأیید نشده‌اند. نصب فعلی سرور تا مجوز جدا همان SSH-only است. این یادداشت در موضوع ingress بر بندهای تاریخی پایین مقدم است.

> **بازنگری معتبر فاز یک — ۲۰۲۶-۱۰-۲۵:** [ADR-081](081-admin-local-password-and-owner-pin.md) تصمیم جدید و مرجع احراز هویت Admin است: ورود محلی Username/Password، مرحلهٔ PIN ثابت شش‌رقمی فقط برای OWNER، قفل دائمی پس از سه PIN اشتباه و بازیابی خصوصی با دو proof مستقل. Password + PIN ثابت **MFA مستقل یا مقاوم به فیشینگ نیست**. بندهای قبلی OIDC/IdP، MFA خارجی، ورود/دعوت بر اساس subject خارجی و بازیابی provider در این سند در محدودهٔ Admin منسوخ‌اند؛ اصل OWNER/RBAC/private ingress/audit و یکپارچگی بازی حفظ است. فاز یک با تأیید صریح مالک آغاز شده؛ [گزارش اجرایی فاز یک](../implementation/admin-dashboard-phase-1.md) دامنه و شواهد جاری را مشخص می‌کند. فاز دو، حساب واقعی و deployment مجوز ندارند. مطالب «فقط Markdown/فاز صفر» در بخش‌های قدیمی، سابقهٔ زمان تدوین‌اند.

- Status: Accepted security requirements/design for Phase 17A3; implementation
  and provider/role assignments require the separately authorized Phase 7C gate
- Owner: HamBazi engineering; product/operations owns provider, operators and approvals
- Date: 2026-10-03
- Related: ADR-018, ADR-023, ADR-030, ADR-031, ADR-033, ADR-036; architecture section 16

**2026-10-25 design amendment:** [ADR-079](079-owner-and-admin-access-control.md)
partially supersedes the uniform explicit-grant assumption below for the protected
human `OWNER`, and specifies administrator lifecycle, custom permissions and the
owner-final approval path. It does not supersede authentication, MFA, private
ingress, durable audit or owning-module integrity requirements. No account or
implementation is activated. In this ADR, an "owner port/transaction" means the
owning application module, not the human OWNER principal.

## Context

Games configuration remains read-only and disabled in production. Trusted Match
termination and statistics rebuild capabilities exist only for reviewed internal
composition. Neither player sessions nor scoped Telegram Bot credentials confer
operator authority. The architecture requires separate authentication, RBAC,
MFA, private network restrictions and append-only audit before live controls.
There is no approved identity provider, operator roster or deployment network.

## Decision

Keep the public API free of operator mutations. The future Admin module owns
separate identity/authorization/audit ports and a private TLS listener/origin,
audience and keys. Deny player/Bot credentials, unsolicited issuer/key URLs and
spoofed proxy identity. Require both verified operator identity with MFA and
approved private peer/network access; neither substitutes for the other.

Authorize registered capabilities per action and recheck current authorization,
revocation and MFA freshness even on retries. Under ADR-079 the protected OWNER
receives all registered current/future capabilities, while non-owner roles need
explicit grants and scoped overrides; unknown capabilities still deny for all.
The [design](../security/admin-security-design.md) and
[access specification](../architecture/admin-access-control.md) retain
phishing-resistant step-up and assign nobody. OWNER_FINAL replaces the second
human requirement only for a verified owner decision; security/domain guards
remain. Provider and ordinary session lifetime remain environment decisions;
ADR-079 defines the proposed revocation/decision/emergency timing profile without
altering product-session policy.

Call only owning application ports. Games checks revisions/readiness/admission;
Matches preserves its atomic writer and pinned active behavior; statistics
rebuild uses the existing trusted generation workflow. Admin does not query or
mutate foreign repositories/tables or obtain hidden game/chat/auth payloads.

Before any mutation, durably append a bounded, content-free admission audit
record. Audit unavailability denies new mutations. The owner commits the effect,
idempotent receipt and content-free outcome outbox in its own transaction.
Admin appends deduplicated outcome events from that outbox; it never pretends a
cross-module network call shares one database transaction. Stable actor-bound
command identity and durable receipts resolve retries/crashes. Append-only
grants/triggers and separate credentials protect audit records; missing outcome
reconciliation must be operationally visible.

## Alternatives

- Player/Bot auth plus an admin flag: combines trust domains and violates separate
  administrative authority.
- IP allowlist without MFA/RBAC: a permitted host or forwarded address is not an
  authorized human operator.
- Direct SQL or CLI environment bypass: bypasses readiness, idempotency,
  append-only evidence and module ownership.
- Log the request after success: loses authorization/attempt evidence and allows
  unaudited effects when audit storage fails.
- Admin-owned writes across Games/Matches/Leaderboard tables: violates module
  boundaries and owning transactional invariants.

## Consequences

This delivers a reviewable design, not executable RBAC/MFA or admin endpoints.
Phase 7C remains mandatory before game activation. Provider, verified MFA claim
mapping/recovery, network inventory, real role assignments and audit
retention/access remain environment gates. ADR-079 now defines protected root
authority, permission precedence, owner-final decisions and a timing profile
requiring implementation qualification. General
retention/erasure stays OD-005; identity/session design does not change ADR-014.
7C must prove the listed authorization, race, failure, audit and grant tests,
including effect/outcome recovery, before its own gate. Existing operational
runbooks do not authorize a bypass while Admin is absent.
