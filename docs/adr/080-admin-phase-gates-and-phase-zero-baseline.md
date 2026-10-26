# ADR-080 — baseline فاز صفر و gateهای اجرای HamBazi Admin

> **تصمیم جدید ۲۰۲۶-۱۰-۲۶ — [ADR-083](083-admin-public-https-and-self-credential-rotation.md):** مسیر استفادهٔ عادی، Public HTTPS با احراز هویت و Reverse Proxy محدود است؛ الزام SSH-only برای مرورگر منسوخ می‌شود. Backend/DB/Redis و Bootstrap/Recovery خصوصی می‌مانند. تغییر Password و PIN خود OWNER و ابطال نشست‌ها ادامهٔ محدود فاز یک‌اند. کد/تست محلی مجاز است؛ نصب سرور، Firewall، فعال‌سازی عمومی، حساب واقعی و فاز دو تأیید نشده‌اند. نصب فعلی سرور تا مجوز جدا همان SSH-only است. این یادداشت در موضوع ingress بر بندهای تاریخی پایین مقدم است.

> **بازنگری معتبر فاز یک — ۲۰۲۶-۱۰-۲۵:** [ADR-081](081-admin-local-password-and-owner-pin.md) تصمیم جدید و مرجع احراز هویت Admin است: ورود محلی Username/Password، مرحلهٔ PIN ثابت شش‌رقمی فقط برای OWNER، قفل دائمی پس از سه PIN اشتباه و بازیابی خصوصی با دو proof مستقل. Password + PIN ثابت **MFA مستقل یا مقاوم به فیشینگ نیست**. بندهای قبلی OIDC/IdP، MFA خارجی، ورود/دعوت بر اساس subject خارجی و بازیابی provider در این سند در محدودهٔ Admin منسوخ‌اند؛ اصل OWNER/RBAC/private ingress/audit و یکپارچگی بازی حفظ است. فاز یک با تأیید صریح مالک آغاز شده؛ [گزارش اجرایی فاز یک](../implementation/admin-dashboard-phase-1.md) دامنه و شواهد جاری را مشخص می‌کند. فاز دو، حساب واقعی و deployment مجوز ندارند. مطالب «فقط Markdown/فاز صفر» در بخش‌های قدیمی، سابقهٔ زمان تدوین‌اند.

- **Status:** Accepted برای قاعدهٔ اجرای مرحله‌ای طبق دستور صریح کاربر در ۲۰۲۶-۱۰-۲۵؛ baseline بررسی آماده، انتخاب‌های محیطی OPEN؛ بدون مجوز فاز بعد یا deployment.
- **Owner:** مالک پروژه برای تصمیم‌های محصول/محیط؛ مهندسی برای inventory، قرارداد، تهدید و evidence هر فاز.
- **Date:** 2026-10-25
- **Supersedes:** فقط کاربرد مجوزهای تاریخی اجرای پیوستهٔ MVP به چرخهٔ جدید Admin را رد می‌کند؛ هیچ اصل امنیتی یا رفتار محصول supersede نمی‌شود.
- **Related:** ADR-039، ADR-078، ADR-079، ADR-013؛ [گزارش فاز صفر](../implementation/admin-dashboard-phase-0.md).

## Context

کاربر اجرای Admin مطابق roadmap را خواسته، در هر نوبت فقط یک فاز مجاز کرده و پس از گزارش آن توقف و تأیید صریح مرحلهٔ بعد را لازم دانسته است. فاز صفر در معماری، inventory/threat model/قرارداد/تصمیم است؛ build پنل و bootstrap/Auth مربوط به فاز یک‌اند. برنامهٔ قدیمی MVP نیز مجوزهای continuous execution تاریخی دارد که نباید به پروژهٔ Admin تعمیم یابد.

در پاسخ این فاز، مالک گفته IdP/private access هنوز تعیین نشده و گزینه‌ها و معیار انتخاب مستند شوند. نباید OPENهای محیطی با انتخاب بی‌صدا، fixture، یا عبارت کلی «ادامه بده» بسته شوند.

## Decision

1. جدول فازهای بخش ۱۲ معماری Admin، شماره‌گذاری authoritative است: ۰ بررسی/قرارداد/تصمیم؛ ۱ هویت و مشاهده؛ ۲ عملیات کنترل‌شده و مدیریت دسترسی؛ ۳ moderation/آمار؛ ۴ بهره‌برداری؛ ۵ توسعهٔ پیشرفته. «مرحله‌های» داخلی بخش ۱۳ سند access، dependency breakdown هستند، نه roadmap رقیب یا مجوز عبور از فاز.
2. فاز صفر فقط source/design review و Markdown می‌سازد؛ scaffold، endpoint، registry اجرایی، test محصول، schema/migration، dependency، bootstrap حساب یا deployment در آن ایجاد نمی‌شود. ابزارهای موجود برای بررسی static/format سند قابل اجرا هستند؛ سرویس واقعی راه نمی‌افتد.
3. after-phase gate اجباری است: scope/evidence/مشکلات/readiness گزارش، سپس توقف؛ فاز بعد فقط با تأیید صریح. مجوز کدنویسی یک فاز هیچ مجوزی برای staging/production نیست.
4. «تحویل مستند فاز صفر آماده» با «آمادگی اجرایی فاز یک» یکی نیست. همهٔ قابلیت‌ها به owner و قرارداد نگاشت و decisionها ثبت شده‌اند؛ IdP/network/session/retention و referenceهای امن واقعاً انتخاب‌نشده OPEN می‌مانند. فاز یک قبل از authorization صریح شروع نمی‌شود و integration/enrollment واقعی قبل از بستن gateهای مصرف‌کننده انجام نمی‌شود.
5. audit پایه برای bootstrap/Auth/session در فاز یک prerequisite همان عملیات امنیتی است. label «read-only dashboard» اجازهٔ ایجاد root/session بدون audit نمی‌دهد. approvalهای محصول، mutation بین ownerها و reconciliation کامل در فاز دو هستند.
6. OWNER و RBAC/MFA طبق ADR-079 باقی‌اند؛ هیچ approval دوم برای مالک یگانه تحمیل نمی‌شود، ولی fresh proof، audit، domain guards و security network پابرجایند. credential/identity واقعی در repo ثبت نمی‌شود.
7. inventory/contract/threat/KPI/decision ثبت‌شده مرجع کار بعد است. هر port پیشنهادی از port موجود تفکیک و هر fake/default به‌عنوان fixture مشخص شود. قراردادهای wire و baseline اجرایی فقط در فاز قابلیت ایجاد می‌شوند.

## Alternatives

| گزینه                                      | علت رد                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| شروع scaffold/auth در فاز صفر              | فراتر از scope roadmap و ورود به فاز یک                                        |
| تعمیم مجوزهای continuous قدیمی             | مخالف دستور جدید و صریح کاربر                                                  |
| انتخاب خودکار IdP/retention                | مالک درخواست مستندسازی گزینه‌ها کرده؛ تصمیم محیطی تصویب نشده است               |
| اعلام کامل‌شدن امنیت با threat document    | سند، evidence runtime یا penetration test نیست                                 |
| انتقال تمام audit به فاز دو                | bootstrap/session واقعی در فاز یک بدون evidence می‌ماند                        |
| ایجاد OpenAPI placeholder و freeze کردن آن | ممکن است قرارداد ناقص را اجرایی و معتبر جلوه دهد؛ semantic plan اکنون کافی است |

## Consequences

فاز صفر خروجی قابل استفاده برای شروع مهندسی بعدی دارد، ولی عملیاتی‌شدن Admin را وانمود نمی‌کند. گام‌های بعدی نیازمند authorization مشخص و تصمیم‌های دقیق محیط هستند. بازبودن gateهای فازهای ۲/۳ نباید بدون وابستگی واقعی اجرای مصنوعی/محلی بخش مجاز فاز یک را مسدود کند؛ بازبودن IdP/network هم مجوز bypass یا release نیست.

## Acceptance

inventory واقعی با path/export، نقشهٔ owner/capability، risk/threatها و ACها، KPIهای قابل محاسبه، تصمیم‌نامهٔ FIXED/OPEN/DEFERRED و برنامهٔ تست موجودند. بررسی لینک/Markdown و architecture gate بدون تغییر executable انجام و نتیجه گزارش شود. هیچ artifact اجرایی، حساب یا محیط واقعی تغییر نکند. خروجی نهایی باید آمادگی فاز یک را با اشاره به OPENها صریح کند و پس از گزارش متوقف شود.
