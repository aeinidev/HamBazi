# ADR-082 — انتشار خصوصی Admin با تونل SSH

> **تصمیم جدید مراسم Staging — [ADR-084](084-staging-owner-private-ssh-ceremony.md):** دو امضای Ed25519 و فایل credential خام برای Staging با پروفایل صریح SSH/root/TTY، تأیید عمل، checkpoint و Audit خصوصی جایگزین می‌شوند؛ Recovery به Password فعلی همان OWNER نیاز دارد. backup رمزگذاری‌شده و تمرین restore خارج سرور پیش‌نیازند. این تغییر محلی است؛ نصب، حساب واقعی، public ingress و فاز دو مجاز نشده‌اند. مطالب قبلیِ دو proof در این محدوده تاریخی‌اند؛ برای محیط‌های دیگر پابرجا هستند.

> **تصمیم جدید ۲۰۲۶-۱۰-۲۶ — [ADR-083](083-admin-public-https-and-self-credential-rotation.md):** مسیر استفادهٔ عادی، Public HTTPS با احراز هویت و Reverse Proxy محدود است؛ الزام SSH-only برای مرورگر منسوخ می‌شود. Backend/DB/Redis و Bootstrap/Recovery خصوصی می‌مانند. تغییر Password و PIN خود OWNER و ابطال نشست‌ها ادامهٔ محدود فاز یک‌اند. کد/تست محلی مجاز است؛ نصب سرور، Firewall، فعال‌سازی عمومی، حساب واقعی و فاز دو تأیید نشده‌اند. نصب فعلی سرور تا مجوز جدا همان SSH-only است. این یادداشت در موضوع ingress بر بندهای تاریخی پایین مقدم است.

- **Status:** Accepted در محدودهٔ درخواست انتشار مالک و انتخاب صریح «پنل فقط از طریق تونل SSH قابل دسترسی باشد»؛ حساب واقعی و فاز دو مجاز نشده‌اند.
- **Owner:** مالک HamBazi؛ اجرای فنی با اپراتور همین انتشار.
- **Date:** 2026-10-25
- **Supersedes:** انتخاب باز مسیر خصوصی و profile اجرای نصبِ بدون حساب در ADR-081؛ اصول OWNER/RBAC/Audit/قفل و private API حفظ می‌شوند.

## Context

مالک انتشار روی `admin.hambazi.top` را درخواست و تونل SSH را انتخاب کرد. DNS این دامنه به سرور فعلی `89.46.217.9` اشاره دارد؛ certificate فعلی staging این hostname را پوشش نمی‌دهد. سرور سرویس‌های بازی و سیاست امنیت با انقضای محدود دارد. Admin باید مستقل منتشر شود، بدون تعویض image یا credential بازیکنان.

## Decision

1. انتشار فقط همان فاز یک است؛ فقط مشاهده و هویت، بدون مدیریت مدیران/عملیات محصول. نصب بدون OWNER واقعی انجام می‌شود؛ bootstrap نیازمند اطلاعات انتخاب‌شدهٔ مالک و ceremony خصوصیِ جداست.
2. vhost مستقل، HTTPS روی loopback سرور و tunnel SSH. اتصال عمومی به خود پنل/API رد می‌شود؛ HTTP عمومی فقط ACME challenge دامنه را سرو می‌کند. HTTPS مرورگر باید certificate معتبر همین hostname را بسنجد؛ خاموش‌کردن TLS verification مجاز نیست.
3. Admin backend از کد API با process/container مستقل، user غیرریشه، read-only root، no-new-privileges، cap-drop و بدون published port اجرا می‌شود. فقط به شبکهٔ خصوصی دادهٔ موجود متصل است؛ appهای فعلی، DNS بازیکن، admission، Bot و writer بازی تغییر نمی‌کنند.
4. roleهای runtime/reader/bootstrap/recovery و Redis ACL/namespace مستقل؛ secret جدید خارج Git و در فایل‌های محدود ایجاد می‌شود. فقط migration افزایشی Admin با backup و ثبت رسید واقعی قابل اعمال است. هیچ seed یا حساب پیش‌فرض وجود ندارد.
5. profile صریح این نصبِ خصوصی: absolute session برابر ۹۰۰ ثانیه، idle برابر ۳۰۰، pending برابر ۱۲۰؛ Argon2 با ۱۹۴۵۶ KiB، time=۲، concurrency=۲؛ pool هر credential حداکثر ۲؛ in-flight حداکثر ۸ و سقف ۱۲۰ درخواست برای peer در دقیقه، ۳۰ login برای identity در دقیقه. این‌ها default کد نیستند و برای بار عمومی تأیید عملکرد نیستند. تغییر profile پیش از حساب واقعی بازبینی می‌شود.
6. Audit در این نصب حذف خودکار ندارد؛ archive/retention قانونی و بازیابی انسانی پیش از enrollment واقعی باید تعیین شوند. proof مالکیت و کلید مستقل مالک توسط انتشار خودکار ساخته یا جایگزین نمی‌شود.
7. image دقیق، payload/lockfile/نسخه‌های native، TLS، grants، private/public boundary و expiry/containment باید qualify شوند. اعتبار امنیتی Admin محدود به advisory معتبر و مهلت محیط فعلی است؛ نگه‌داری مستقل آن نباید containment موجود را دور بزند. rollback فقط Admin را می‌بندد/متوقف و volume بازی را حفظ می‌کند؛ migration افزایشی down نمی‌شود.

## Alternatives

- Login/API عمومی بدون VPN/IP محدود: مخالف انتخاب صریح مالک و ADR-081؛ رد.
- قراردادن Admin در process/API بازیکن: blast radius و credential مشترک؛ رد.
- حساب پیش‌فرض یا credential انتخاب‌شده توسط عامل: مخالف bootstrap مالک؛ رد.
- تعویض appهای بازی صرفاً برای نصب Admin: دامنهٔ تغییر غیرضروری؛ رد.

## Consequences

URL از مرورگر بدون tunnel در دسترس نیست. client باید hostname صحیح را از مسیر loopback tunnel resolve کند تا Origin/cookie/certificate درست باقی بمانند؛ اتصال با IP یا غیرفعال‌کردن TLS جای آن را نمی‌گیرد. گزارش انتشار باید موفقیت واقعی را از candidate یا gate بسته جدا کند. وجود bundle و DNS به‌معنی فعال‌بودن سرویس نیست.
