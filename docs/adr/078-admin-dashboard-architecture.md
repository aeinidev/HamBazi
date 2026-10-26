# ADR-078 — معماری پنل مستقل مدیریت HamBazi

> **تصمیم جدید ۲۰۲۶-۱۰-۲۶ — [ADR-083](083-admin-public-https-and-self-credential-rotation.md):** مسیر استفادهٔ عادی، Public HTTPS با احراز هویت و Reverse Proxy محدود است؛ الزام SSH-only برای مرورگر منسوخ می‌شود. Backend/DB/Redis و Bootstrap/Recovery خصوصی می‌مانند. تغییر Password و PIN خود OWNER و ابطال نشست‌ها ادامهٔ محدود فاز یک‌اند. کد/تست محلی مجاز است؛ نصب سرور، Firewall، فعال‌سازی عمومی، حساب واقعی و فاز دو تأیید نشده‌اند. نصب فعلی سرور تا مجوز جدا همان SSH-only است. این یادداشت در موضوع ingress بر بندهای تاریخی پایین مقدم است.

> **بازنگری معتبر فاز یک — ۲۰۲۶-۱۰-۲۵:** [ADR-081](081-admin-local-password-and-owner-pin.md) تصمیم جدید و مرجع احراز هویت Admin است: ورود محلی Username/Password، مرحلهٔ PIN ثابت شش‌رقمی فقط برای OWNER، قفل دائمی پس از سه PIN اشتباه و بازیابی خصوصی با دو proof مستقل. Password + PIN ثابت **MFA مستقل یا مقاوم به فیشینگ نیست**. بندهای قبلی OIDC/IdP، MFA خارجی، ورود/دعوت بر اساس subject خارجی و بازیابی provider در این سند در محدودهٔ Admin منسوخ‌اند؛ اصل OWNER/RBAC/private ingress/audit و یکپارچگی بازی حفظ است. فاز یک با تأیید صریح مالک آغاز شده؛ [گزارش اجرایی فاز یک](../implementation/admin-dashboard-phase-1.md) دامنه و شواهد جاری را مشخص می‌کند. فاز دو، حساب واقعی و deployment مجوز ندارند. مطالب «فقط Markdown/فاز صفر» در بخش‌های قدیمی، سابقهٔ زمان تدوین‌اند.

- **Status:** جهت‌گیری معماری مبنای اجرای فازبندی‌شده طبق درخواست ۲۰۲۶-۱۰-۲۵؛ اکنون فقط فاز صفر مجاز است. تصمیم‌های محیطی باز، فازهای بعد، تغییر محیط و اعطای حساب/نقش هنوز مجوز ندارند.
- **Owner:** پیشنهاد برای مالک محصول/عملیات و تیم فنی HamBazi؛ تعیین اشخاص و تصویب با مالک پروژه.
- **Date:** 2026-10-25
- **Supersedes:** هیچ‌کدام؛ مکمل پیشنهادی ADR-039 و ADR-013.
- **Related:** ADR-014، 023، 024، 030، 033، 039، 045، 046، 048، 073، 074.

**بازنگری ۲۰۲۶-۱۰-۲۵:** بخش‌های role/assignment/approval این پیشنهاد با [ADR-079](079-owner-and-admin-access-control.md) جایگزین شدند. OWNER اکنون authority محافظت‌شدهٔ کامل فعلی/آینده دارد؛ roleهای عادی explicit و قابل سفارشی‌سازی‌اند. این یادداشت مجوز اجرا یا اعطای حساب نیست.

**Gate اجرای جدید:** [ADR-080](080-admin-phase-gates-and-phase-zero-baseline.md) مرز فاز صفر، توقف اجباری هر مرحله، تصمیم‌های محیطی و نیاز audit پایه برای bootstrap/Auth فاز یک را ثبت می‌کند. [گزارش فاز صفر](../implementation/admin-dashboard-phase-0.md) آماده‌بودن مستندات را از آمادگی اجرایی فاز بعد جدا می‌کند.

## Context

پنل فارسی در `admin.hambazi.top` لازم است، درحالی‌که Admin فعلی فقط public surface خالی دارد. زیرساخت API/Worker/PostgreSQL/Redis، projection آمار، diagnostics و trusted lifecycle وجود دارند، اما به‌خودی‌خود مجوز مدیریتی نیستند. catalog عمومی، availability نمایشی و پذیرش runtime نیز یک منبع واحد قابل ویرایش نیستند. رابط Mini App به Telegram و session بازیکن وابسته است؛ مدیر باید هویت و شبکهٔ مستقلی داشته باشد.

## Decision — پیشنهادی

1. `apps/admin` با React/Vite و هویت بصری موجود، build و session مستقل؛ استفاده از فناوری‌های موجود و بدون Telegram SDK.
2. ماژول Admin داخل Modular Monolith با listener خصوصی TLS، namespace `/v1/admin` و reverse proxy هم‌origin. مسیرها روی API عمومی ثبت نشوند. MVP در process فعلی مجاز است، با پذیرش صریح blast radius مشترک و بودجهٔ مستقل؛ جداسازی process در صورت نیاز امنیتی/عملکردی تصمیم بعدی است.
3. IdP مستقل OIDC، MFA مقاوم به phishing، roster بسته، capability/scoped RBAC و cookie امن امضاشده با metadata پایدار پیشنهاد می‌شود. provider، assurance mapping، durationها و recovery پیش‌نیاز تصویب فاز اول‌اند؛ ADR-014 بازیکن تغییر نمی‌کند.
4. Admin فقط application port مالک را فراخوانی کند؛ هیچ دسترسی مستقیم به دادهٔ بازی، chat یا session بازیکن نگیرد. edgeها و scopeهای جدید باید در enforcement و fixtureهای مثبت/منفی ثبت شوند.
5. پروتکل ADR-039 حفظ شود: durable admission audit پیش از اثر؛ effect/receipt/outcome در transaction مالک؛ تکمیل audit از outbox با dedupe و reconciliation. mutation در نبود audit admission رد شود.
6. approval پرخطر به action/target/digest/version متصل باشد: DUAL_CONTROL با دو فرد متمایز برای غیرمالک، یا OWNER_FINAL با reauthentication عمل‌محور، دلیل و audit برای مالک. نقش OWNER از root binding یکتا می‌آید، از CRUD مدیران قابل تغییر نیست و قابلیت‌های معتبر آینده را خودکار دریافت می‌کند. termination بازی Undo ندارد؛ فقط lifecycle guarded، بدون ویرایش hidden state/result یا reclaim صندلی.
7. configuration به نوع runtime، pinned Match و زیرساختی تفکیک شود. maintenance دارای desired/effective revision و fencing مسیر پذیرش است؛ boolean/UI toggle ضمانت atomic نیست. secret و کنترل containment قابل ویرایش در پنل نباشند.
8. همان PostgreSQL/Redis/Worker با credential، owner و بودجهٔ محدود reuse شوند. report سنگین async؛ monitoring فقط projection مجاز؛ بدون SQL/shell/Docker socket/metrics proxy عمومی.
9. فاز اول مشاهده، فاز دوم mutation ایمن؛ moderation محتوایی منوط به OD-005 و ADR صریح است. مالی صرفاً extension point آینده است و در MVP ساخته نمی‌شود.

## Alternatives

| گزینه                                         | ارزیابی                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| route مدیر داخل Mini App و `isAdmin` روی User | هویت/session/CSP و مرز بازیکن با مدیر مخلوط می‌شود؛ رد                                           |
| backend microservice و DB جدا از ابتدا        | هزینهٔ RPC، consistency و عملیات بدون شواهد نیاز؛ فعلاً رد                                       |
| API عمومی مشترک با مخفی‌کردن دکمه‌ها          | با ADR-039 و مدل تهدید سازگار نیست؛ رد                                                           |
| پنل عمومی CRUD روی Prisma                     | مالکیت، قواعد، اطلاعات مخفی و audit را دور می‌زند؛ رد                                            |
| process مستقل از همان کد از روز اول           | isolation بهتر، wiring و deployment پیچیده‌تر؛ در threat review قابل انتخاب، پیش‌فرض MVP نیست    |
| محصولات عمومی Feature Flag/BI/queue console   | پیش از تعریف نیاز، credential و سطح حمله اضافه می‌کند؛ فقط با شواهد و integration محدود در آینده |

## Consequences

حداقل تغییر دامنه و بیشترین reuse حفظ می‌شود، ولی portهای خواندن مدیر، RBAC/session، audit، approval، revision و admission fencing کار واقعی جدید هستند. frontend مستقل deploy می‌شود؛ Backend همچنان release cycle مشترک دارد. listener جدا ریسک compromise کامل process را رفع نمی‌کند. با بزرگ‌شدن گزارش‌ها، projection و isolation workload قبل از microservice بررسی می‌شوند.

schema/grant آینده additive و jobها نسخه‌دار خواهند بود. audit append-only در همان DB مانع توان DBA نیست؛ archive/checkpoint خارجی در مرحلهٔ عملیاتی بررسی می‌شود. retention، provider، افراد و مجوز production با این سند تثبیت نمی‌شوند. ADR-079 profile زمانی طراحی برای revoke/تصمیم مالک/emergency را مشخص می‌کند؛ هیچ تنظیمی در محیط اعمال نشده است.

## Follow-up decisions and acceptance

پیش از اجرا باید provider/network، absolute/idle session و integration recovery، identity/assignment واقعی، retention/evidence، policy restriction بازی فعال، بودجهٔ بار و backup ثبت شوند. قواعد assignment/approval و حفاظت OWNER در ADR-079 مرجع‌اند و تست‌های AC-01…AC-22 لازم‌اند. استثنای دسترسی محتوایی Chat در صورت نیاز باید بخش مربوط ADR-039 را صریحاً و محدود supersede کند.

معیار پذیرش: رد player/Bot credential و ingress عمومی؛ کنترل permission در هر درخواست/retry؛ عدم افشای hidden state؛ یک اثر با retry/crash؛ audit outage بدون اثر؛ رقابت maintenance/admission و terminate/command؛ grants واقعی append-only؛ RTL/accessibility و تست بار مشترک با بازی. وضعیت هدف‌های ADR-045/046 و استثناهای ADR-048 بدون تغییر حفظ شود.

جزئیات فازها، schema مفهومی، API، UI، ریسک‌ها و برنامهٔ تست در [سند معماری پنل](../architecture/admin-dashboard.md) آمده است. این ADR و سند همراه فقط Markdown هستند و هیچ route، سرویس، migration یا تغییری در staging/production ایجاد نمی‌کنند.
