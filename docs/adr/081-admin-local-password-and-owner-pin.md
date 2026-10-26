# ADR-081 — Local Authentication و PIN ثابت OWNER

- **Status:** Accepted direction طبق الزامات صریح مالک در ۲۰۲۶-۱۰-۲۵؛ فقط فاز یک برای پیاده‌سازی محلی مجاز است. فعال‌سازی محیط و ایجاد حساب واقعی مجوز جدا لازم دارند.
- **Owner:** مالک HamBazi برای تصمیم محصول؛ مهندسی برای اجرا و آزمون امنیت.
- **Date:** 2026-10-25
- **Supersedes:** فقط انتخاب OIDC/IdP خارجی، الزام MFA مدیران، phishing-resistant step-up و ممنوعیت نگه‌داری credential verifier در محدودهٔ Admin از ADR-039/078/079 و اسناد همراه. session بازیکنان ADR-014 تغییر نمی‌کند. root/RBAC/audit/private ingress/domain integrity معتبرند.

## Context

مالک یک صفحهٔ مشترک Username/Password، بدون signup و سرویس هویت خارجی خواسته است. مدیر عادی پس از password وارد می‌شود؛ OWNER پس از password و PIN ثابت شش‌رقمی. سه PIN اشتباه فقط پس از password معتبر، حساب مالک را تا بازیابی خصوصی و دستی برای همیشه قفل می‌کند.

## Decision

1. هویت مستقل محلی متعلق به Admin؛ username یکتا و canonical، password verifier با Argon2id. OWNER از root binding حفاظت‌شده تشخیص داده می‌شود، نه از username، role claim یا DTO. حساب واقعی/پیش‌فرض ساخته نمی‌شود.
2. verifierهای password و PIN مستقل، salt مستقل و Argon2id باشند. PIN پیش از Argon2id با HMAC و pepper محرمانهٔ مخصوص PIN در خارج PostgreSQL تقویت شود. نگه‌داری فقط verifier در storage مجاز Admin، استثنای صریح و محدود به ممنوعیت تاریخی hash احراز هویت است؛ raw credential و verifier در audit/telemetry/response ممنوع‌اند. pepper با session/bootstrap/recovery keys مشترک نباشد.
3. Password + PIN ثابت هر دو knowledge factor هستند؛ **MFA مستقل یا مقاوم به phishing نیستند**. PIN فقط ۱۰^۶ حالت دارد؛ pepper، private ingress، rate limit، محدودیت همزمانی Argon2، audit و قفل durable کنترل جبرانی‌اند، نه ادعای MFA. سرقت password امکان قفل عمدی مالک با سه حدس PIN را ایجاد می‌کند؛ این ریسک طبق درخواست مالک پذیرفته و recovery خصوصی لازم است.
4. password نامعتبر خطای عمومی می‌دهد؛ مرحله PIN باز نمی‌شود. password معتبر OWNER فقط preauth کوتاه‌عمر و نوع جدا، بدون authority یا full session می‌سازد. PIN exact ASCII شش رقم، از جمله صفر اول؛ password/PIN در backend بررسی می‌شوند.
5. تلاش‌های PIN روی رکورد مالک در PostgreSQL، تحت lock و credential/session version fencing ثبت می‌شوند. Argon2 verification خارج transaction کوتاه انجام و نتیجه فقط با recheck نسخه و lock مصرف می‌شود. سومین failure به‌صورت atomic lockedAt می‌گذارد، session epoch را افزایش و sessionهای قبلی را بی‌اعتبار می‌کند. موفقیت بعد از lock هم رد می‌شود؛ password login، IP/browser/restart و زمان قفل را رفع یا شمارنده را reset نمی‌کنند. موفقیت کامل قبل از lock، شمارنده را صفر می‌کند. commandId/attempt receipt مانع شمارش دوبارهٔ retry یک intent می‌شود.
6. secure signed cookie با kind مستقل pending/full، metadata durable، expiry/idle صریح، CSRF و Origin دقیق، session revocation و authz primary-current. هیچ session، password یا PIN در localStorage/sessionStorage نگه‌داری نمی‌شود. phase one بدون config کامل و peer trust صریح runtime نمی‌سازد.
7. bootstrap/recovery از port خصوصی provisioning با authority مستقل خارج DB انجام شود؛ هیچ endpoint عمومی unlock/reset/signup ایجاد نشود. proof مالکیت از secret custody بیرون DB، تأیید عمل/target و reason لازم است. reset PIN فقط همان root را حفظ، epoch را افزایش و تمام sessionها را باطل می‌کند. audit اثر اتمیک است؛ audit failure صفر اثر. ابزار واقعی قبل استفادهٔ انسانی باید custody/retention/peer policy منتخب را qualify کند.
8. تغییر PIN مالک و OWNER_FINAL نیازمند reauthentication همان عمل با password+PIN فعلی است؛ این proof نیز MFA محسوب نمی‌شود. مدیریت سایر مدیران، رمز CSPRNG دوازده‌کاراکتری با تضمین هر سه گروه، نمایش فقط یک‌بار، reset/revoke-all، role editor و approvals مربوط به فاز دو هستند و در فاز یک فعال نمی‌شوند.
9. انتخاب IdP حذف می‌شود؛ private network/session durations/retention/key custody/load budget هنوز config صریح و gate محیط‌اند. fixtureهای مصنوعی، config production نیستند. هیچ deployment/account واقعی یا ورود به فاز دو با این ADR مجاز نیست.
10. برای مهار هزینهٔ Argon2 و جداسازی credential، entry point اختیاری Admin از همان artifact و کد API، با process و pool محدود جدا طراحی می‌شود. این انتخاب محدود، پیش‌فرض process مشترک ADR-078 را برای Local Auth تغییر می‌دهد؛ microservice دامنه، DB یا queue جدید ساخته نمی‌شود. public API آن را خودکار اجرا نمی‌کند؛ wiring استقرار هنوز مجاز نیست. هر محیط یک database/realm مستقل و فقط یک root binding دارد؛ تغییر realm برای ساخت مالک دوم یک عمل مجاز مدیریتی نیست.

## Alternatives

- OIDC/WebAuthn/TOTP/SMS/email: به درخواست صریح مالک در ورود Admin استفاده نمی‌شوند.
- PIN به‌عنوان password دوم یا MFA واقعی: طبقه‌بندی امنیتی نادرست است.
- شمارنده Redis/in-memory یا هر preauth جدا: با restart یا صدور preauth تازه دور زده می‌شود؛ رد.
- Argon2 طولانی در تراکنش قفل‌شده: به DB/game latency آسیب می‌زند؛ نسخه‌سنجی نتیجهٔ verification در transaction کوتاه انتخاب شد.
- plain SHA/PIN بدون pepper یا ذخیره plaintext: حفاظت آفلاین کافی ندارد؛ رد.
- public forgot/unlock یا دسترسی DB تنها: برخلاف recovery خصوصی خواسته‌شده؛ رد.

## Consequences

ورود از سرویس خارجی مستقل می‌شود، اما HamBazi مسئول lifecycle credential، brute force، recovery و هزینهٔ KDF است. compromise pepper همراه DB امکان brute force آفلاین PIN را بازمی‌گرداند؛ custody و محدودیت runtime ضروری‌اند. قفل عمدی با password سرقت‌شده و phishing همچنان ریسک‌اند. حساب واقعی قبل qualification و تأیید مالک ساخته نمی‌شود.

## Acceptance

Unit: policy/normalization/Argon2id/pepper/session kind/RBAC؛ integration PostgreSQL: سه failure، retry، concurrency با login/recovery/success، restart و audit rollback؛ HTTP/security: no signup/unlock، CSRF/Origin/private peer، error عمومی، no full session قبل PIN، invalid player/Bot cookie؛ E2E: login مشترک، مدیر مستقیم، مالک PIN، قفل و خروج. تست fixture هیچ حساب انسانی را ایجاد یا بازیابی نمی‌کند.

مبنای حفاظت password: [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). انتخاب PIN و قفل سه‌تلاش تصمیم HamBazi است، نه الزام OWASP یا ادعای انطباق MFA.
