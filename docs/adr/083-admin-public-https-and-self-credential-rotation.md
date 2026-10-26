# ADR-083 — Public HTTPS برای Admin و تعویض اطلاعات امنیتی خود OWNER

> **شواهد اجرای Staging:** انتشار عمومی با مجوز جداگانه و پس از gate بکاپ، dry-run hook و qualification در [گزارش ۲۷ اکتبر](../operations/admin-public-https-staging-20261027.md) ثبت می‌شود. محدودیت‌های Production و فاز دو و مسیر خصوصی Bootstrap/Recovery تغییر نکرده‌اند.

> **تصمیم جدید مراسم Staging — [ADR-084](084-staging-owner-private-ssh-ceremony.md):** دو امضای Ed25519 و فایل credential خام برای Staging با پروفایل صریح SSH/root/TTY، تأیید عمل، checkpoint و Audit خصوصی جایگزین می‌شوند؛ Recovery به Password فعلی همان OWNER نیاز دارد. backup رمزگذاری‌شده و تمرین restore خارج سرور پیش‌نیازند. این تغییر محلی است؛ نصب، حساب واقعی، public ingress و فاز دو مجاز نشده‌اند. مطالب قبلیِ دو proof در این محدوده تاریخی‌اند؛ برای محیط‌های دیگر پابرجا هستند.

- **Status:** جهت‌گیری و آماده‌سازی کد/تست Accepted طبق درخواست صریح مالک در ۲۰۲۶-۱۰-۲۶؛ **نصب، migration، تغییر Firewall، فعال‌سازی ingress عمومی و ایجاد حساب مجاز نیستند**.
- **Owner:** مالک HamBazi برای تصمیم دسترسی؛ مهندسی برای پیاده‌سازی و qualification؛ اجرای سرور فقط پس از تأیید جدا.
- **Date:** 2026-10-26
- **Supersedes:** الزام SSH/VPN برای ورود عادی از ADR-082 و private-client ingress در ADR-039/078/079/081؛ private بودن process/port/data و Bootstrap/Recovery حفظ می‌شود. فقط self-service تغییر Password مالک به فاز یک افزوده می‌شود.
- **Related:** ADR-039/078/079/080/081/082؛ [گزارش این اصلاح](../implementation/admin-public-https-preparation-2026-10-26.md).

## Context

مالک ورود از هر دستگاه به `https://admin.hambazi.top` بدون تونل، VPN، IdP یا authenticator خارجی را می‌خواهد. Backend فعلی TLS/private peer دارد، اما IP limiter آن IP پراکسی را می‌بیند. تغییر PIN وجود دارد؛ تغییر Password و تشخیص default-deny برای handlerهای جدید ناقص‌اند. اتصال خروجی سرور به Let’s Encrypt قبلاً timeout داشت و صدور اولیه به تونل موقت اپراتور وابسته بود؛ این وابستگی برای تمدید خودکار پذیرفته نیست.

## Decision

1. Browser → HTTPS عمومی همان hostname → Nginx اختصاصی → HTTPS معتبر روی IP خصوصی Admin. Backend هیچ published port نمی‌گیرد؛ DB/Redis، credentialها و public API بازیکنان مشترک نمی‌شوند. TLS upstream با CA و SNI `admin-api.internal` سنجیده می‌شود.
2. حالت `private` برای configهای نصب‌شدهٔ قبلی پیش‌فرض سازگار باقی است؛ `public-proxy` و `ADMIN_PROXY_PEERS` فقط به‌صورت صریح فعال می‌شوند. peer باید private، در allowlist و متفاوت از bind آدرس Backend باشد. کد اعتماد عمومی به X-Forwarded-For یا `trustProxy=true` ندارد.
3. پراکسی request headerها را با allowlist می‌سازد و `X-Hambazi-Client-IP` را از `$remote_addr` **بازنویسی** می‌کند. فقط socket peer مورد اعتماد می‌تواند این هدر تک-IP را بدهد؛ غیبت/لیست/فرمت نامعتبر رد می‌شود. peerهای خصوصی غیرپراکسی حق تعیین آن را ندارند. این IP فقط برای نرخ است، نه هویت یا مجوز. CDN/Cloudflare proxy فعال فرض نمی‌شود؛ افزودن آن نیازمند inventory و اعتبارسنجی زنجیرهٔ IP جداست.
4. ingress فقط route/methodهای صریح قرارداد و bundle محلی را می‌گذراند. controllerهای جدید بدون policy ثبت‌شده در global guard بسته‌اند؛ route دارای capability ناشناخته حتی برای OWNER رد می‌شود. تمام data endpointها نیازمند FULL session و permission/scope جاری‌اند. فقط login بدون session است؛ PIN نیازمند PENDING معتبر و CSRF است. PENDING به هیچ داده یا self-service mutation مدیریتی دسترسی ندارد.
5. Local Authentication و جریان فعلی حفظ می‌شوند: مدیر معمولی با Password مستقیم؛ OWNER با Password سپس PIN ثابت شش‌رقمی. قفل سه failure در PostgreSQL، receipt/retry، atomicity، generic error، cookie `__Host-`/Secure/HttpOnly/SameSite=Strict، Origin/Host/CSRF و revocation جاری حفظ‌اند. Bootstrap/Recovery هیچ route عمومی ندارند. در Staging، ADR-084 پروفایل SSH/root/TTY و Password مالک برای Recovery را تعیین می‌کند؛ سایر محیط‌ها همچنان دو امضای مستقل می‌خواهند. roleهای مخصوص و checkpoint خصوصی حفظ می‌شوند.
6. edge به‌صورت صریح profile اولیه دارد: ۱۲۰ درخواست در دقیقه برای IP، ۲۰ auth در دقیقه برای IP، ۳۰ auth در دقیقه برای کل پنل، burst محدود و سقف اتصال؛ کل درخواست‌های سرور نیز سقف جدا دارند. این profile عمومیِ مقیاس‌پذیری نیست و قبل rollout روی میزبان qualify می‌شود. rate limiter توزیع‌شدهٔ Redis با IP واقعی/identity و سقف KDF/in-flight در Backend لایهٔ دوم است. Redis unavailable، login را باز نمی‌کند. محدودیت سراسری auth هزینهٔ KDF و حجم Audit ناموفق را نیز محدود می‌کند.
7. OWNER می‌تواند Password یا PIN خودش را با Password و PIN فعلی تغییر دهد. verifier تازه با Argon2id بیرون تراکنش ساخته، سپس تحت lock realm، owner binding، session و credentialVersion دوباره سنجیده می‌شوند. Audit/receipt و verifier/epoch در تراکنش واحد commit می‌شوند. موفقیت همهٔ FULL/PENDINGهای قبلی، از جمله نشست جاری، را نامعتبر می‌کند؛ ورود مجدد لازم است. Password غلط تلاش PIN نیست؛ PIN غلط بعد Password صحیح همان counter سه‌تلاش را مصرف می‌کند. این اختیار برای مدیریت رمز دیگران یا CRUD مدیران نیست.
8. migration فقط vocabulary رویداد `PASSWORD_CHANGED` را گسترش می‌دهد؛ grant جدا فقط ستون `password_verifier` را به runtime فعلی اضافه می‌کند. نسخهٔ قدیمی هنوز کار می‌کند؛ نسخهٔ جدید بدون migration/grant کامل باید عملیات جدید را fail closed کند. down یا تخریب داده و تغییر writer/engine بازی وجود ندارد.
9. Certbot و timer موجود reuse شوند؛ سرویس هویت/ACME daemon یا proxy وابسته به لپ‌تاپ ساخته نمی‌شود. deploy hook مختص همین lineage، chain/hostname/expiry/key، `nginx -t`، reload و certificate واقعاً سرو‌شده را بررسی و فقط سپس receipt ثبت کند. hook بقیهٔ گواهی‌ها را نادیده می‌گیرد. رفتار Certbot در خطای hook و گزینهٔ `--run-deploy-hooks` از [راهنمای رسمی](https://eff-certbot.readthedocs.io/en/stable/using.html) مبنا گرفته شده؛ صرف exit موفق `renew` یا active بودن timer کافی نیست.
10. پیش از بازکردن login عمومی، timeout خروجی **روی خود سرور** رفع و `renew --dry-run --run-deploy-hooks` در همان مسیر شبکه/اعتماد خودکار واقعی موفق شود؛ receipt hook و certificate سرو‌شده تطبیق کنند. تست mock/local این ادعا را ثابت نمی‌کند. فایل `public-enabled` در candidate پیش‌فرض غایب و پاسخ ۵۰۳ است؛ فقط اپراتور با مجوز جدا و پس از gate کامل آن را ایجاد می‌کند. marker موجود maintenance و expiry/containment مستقل همچنان اولویت دارند؛ renewal یا reboot نباید marker توقف را حذف کند.

## Alternatives

- حفظ SSH-only برای استفادهٔ عادی: با تصمیم جدید مالک سازگار نیست؛ مسیر اپراتوری حساس همچنان SSH است.
- publish کردن پورت Backend یا قبول XFF از هر client: trust boundary و rate limiter را می‌شکند؛ رد.
- login عمومی با API/data بدون guard یا فقط دکمهٔ مخفی: رد.
- استفادهٔ دائمی از reverse tunnel رایانهٔ مالک برای ACME: در غیاب رایانه تمدید قطع می‌شود؛ رد.
- reset Password مالک با SQL یا دورزدن profile خصوصی منتخب: خارج self-service و برخلاف Recovery مصوب؛ رد.

## Consequences

کاهش اصطکاک ورود، سطح حملهٔ Password spraying، phishing، فشار KDF/Audit و قفل عمدی با Password سرقت‌شده را افزایش می‌دهد. **Password + PIN ثابت MFA مستقل یا مقاوم به phishing نیست**؛ عمومی‌شدن این واقعیت را تغییر نمی‌دهد. کنترل‌های جبرانی بالا حفظ می‌شوند، ولی جای یک عامل مستقل را نمی‌گیرند. سوابق backup/custody و شرط ساخت اولین OWNER از گزارش آمادگی قبلی باقی‌اند؛ هیچ اطلاعات واقعی یا credential پیش‌فرض ساخته نمی‌شود.

این ADR اجازهٔ public beta بازی‌ها، Production، اشتراک credential محیط‌ها، حساب OWNER دوم یا گذر از ADR-050 دربارهٔ نگه‌داری هویت واقعی نیست. self-service هویت ادامهٔ محدود فاز یک است؛ فاز دو بسته می‌ماند. تا نصب نسخهٔ جدید، واقعیت سرور همان SSH-only قبلی است.
