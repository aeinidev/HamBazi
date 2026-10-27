# معماری مالک، مدیریت مدیران و کنترل دسترسی HamBazi

> مرز انتشار 2026-10-27: طبق [ADR-087](../adr/087-admin-phase-two-release-boundary.md)، محروم‌سازی/رفع محرومیت فعلاً برای همه، حتی OWNER، غیرفعال است؛ scope اولیهٔ فاز سوم پابرجاست.

> بازنگری اجرای فاز دوم (2026-10-27): [ADR-085](../adr/085-admin-phase-two-operations.md) و [ADR-086](../adr/086-admin-user-ban-and-session-generation.md) قرارداد عملیات/نقش‌ها و استثنای مصوب محروم‌سازی را تکمیل می‌کنند. توسعه فقط محلی مجاز است؛ این بازنگری مجوز استقرار یا تغییر OWNER نیست.

> **تصمیم جدید مراسم Staging — [ADR-084](../adr/084-staging-owner-private-ssh-ceremony.md):** دو امضای Ed25519 و فایل credential خام برای Staging با پروفایل صریح SSH/root/TTY، تأیید عمل، checkpoint و Audit خصوصی جایگزین می‌شوند؛ Recovery به Password فعلی همان OWNER نیاز دارد. backup رمزگذاری‌شده و تمرین restore خارج سرور پیش‌نیازند. این تغییر محلی است؛ نصب، حساب واقعی، public ingress و فاز دو مجاز نشده‌اند. مطالب قبلیِ دو proof در این محدوده تاریخی‌اند؛ برای محیط‌های دیگر پابرجا هستند.

> **تصمیم جدید ۲۰۲۶-۱۰-۲۶ — [ADR-083](../adr/083-admin-public-https-and-self-credential-rotation.md):** مسیر استفادهٔ عادی، Public HTTPS با احراز هویت و Reverse Proxy محدود است؛ الزام SSH-only برای مرورگر منسوخ می‌شود. Backend/DB/Redis و Bootstrap/Recovery خصوصی می‌مانند. تغییر Password و PIN خود OWNER و ابطال نشست‌ها ادامهٔ محدود فاز یک‌اند. کد/تست محلی مجاز است؛ نصب سرور، Firewall، فعال‌سازی عمومی، حساب واقعی و فاز دو تأیید نشده‌اند. نصب فعلی سرور تا مجوز جدا همان SSH-only است. این یادداشت در موضوع ingress بر بندهای تاریخی پایین مقدم است.

> **بازنگری معتبر فاز یک — ۲۰۲۶-۱۰-۲۵:** [ADR-081](../adr/081-admin-local-password-and-owner-pin.md) تصمیم جدید و مرجع احراز هویت Admin است: ورود محلی Username/Password، مرحلهٔ PIN ثابت شش‌رقمی فقط برای OWNER، قفل دائمی پس از سه PIN اشتباه و بازیابی خصوصی با دو proof مستقل. Password + PIN ثابت **MFA مستقل یا مقاوم به فیشینگ نیست**. بندهای قبلی OIDC/IdP، MFA خارجی، ورود/دعوت بر اساس subject خارجی و بازیابی provider در این سند در محدودهٔ Admin منسوخ‌اند؛ اصل OWNER/RBAC/private ingress/audit و یکپارچگی بازی حفظ است. فاز یک با تأیید صریح مالک آغاز شده؛ [گزارش اجرایی فاز یک](../implementation/admin-dashboard-phase-1.md) دامنه و شواهد جاری را مشخص می‌کند. فاز دو، حساب واقعی و deployment مجوز ندارند. مطالب «فقط Markdown/فاز صفر» در بخش‌های قدیمی، سابقهٔ زمان تدوین‌اند.

تاریخ: ۲۰۲۶-۱۰-۲۵ — بازطراحی مستندی بر اساس درخواست صریح مالک پروژه؛ **پیاده‌سازی نشده است**.

این سند مرجع تفصیلی بخش دسترسی در [معماری Admin Dashboard](admin-dashboard.md) است. [ADR-079](../adr/079-owner-and-admin-access-control.md) تغییر نسبت به ADR-078 و تکمیل محدود ADR-039 را ثبت می‌کند. هیچ حساب، credential، migration، endpoint یا تغییری در سرور با این سند ایجاد نمی‌شود. provider هویت و محیط استقرار همچنان باید تعیین شوند.

پیگیری اجرا: [گزارش فاز صفر](../implementation/admin-dashboard-phase-0.md) و [ADR-080](../adr/080-admin-phase-gates-and-phase-zero-baseline.md). شماره‌گذاری فازها از جدول roadmap سند اصلی می‌آید؛ مرحله‌های dependency در بخش ۱۳ این سند جایگزین آن نیستند. بعد از هر گزارش توقف اجباری است و ورود به فاز بعد تأیید صریح می‌خواهد.

## ۱. معماری نهایی و حدود اختیار OWNER

`OWNER` بالاترین authority مدیریتی و متعلق به مالک پروژه است. مالک به **تمام قابلیت‌های مدیریتی ثبت‌شدهٔ فعلی و آینده** دسترسی دارد؛ نقش، scope، allow/deny و grant مربوط به سایر مدیران برای محدودکردن او استفاده نمی‌شوند. قابلیت جدید پس از عرضهٔ واقعی، بدون role migration یا grant دستی برای OWNER مجاز است. سایر مدیران هیچ قابلیت جدیدی را خودکار دریافت نمی‌کنند.

OWNER یک role قابل‌اختصاص در جدول نقش‌های عادی نیست: UI آن را با عنوان «مالک اصلی / OWNER» نمایش می‌دهد، ولی backend آن را از binding محافظت‌شدهٔ مالک تشخیص می‌دهد. claim ارسالی IdP به نام Owner، ایمیل، Telegram ID، `isOwner` در DTO یا نام role سفارشی نمی‌تواند مالک بسازد. در هر security realm راه‌اندازی‌شده دقیقاً یک binding فعال مالک وجود دارد. محیط‌ها deployment و credential مستقل دارند؛ مالک منطقی یک نفر است و binding همان مالک در هر محیط با ceremony جدا تأیید می‌شود. مالک به همهٔ بخش‌های همان محیط دسترسی دارد؛ session staging به production منتقل نمی‌شود.

سه مرز مستقل همیشه برقرارند:

| مرز                  | شامل OWNER می‌شود؟                   | نمونه                                                                                        |
| -------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| اجازهٔ کسب‌وکار RBAC | مالک همهٔ قابلیت‌های ثبت‌شده را دارد | دیدن صفحه، مدیریت مدیران، درخواست یا تأیید عملیات                                            |
| احراز هویت و امنیت   | بله؛ غیرقابل دورزدن                  | MFA، CSRF، شبکهٔ خصوصی، session revoke، rate/resource limits، audit                          |
| صحت دامنه و زیرساخت  | بله؛ غیرقابل دورزدن                  | version/lock/idempotency، pin بازی فعال، نگه‌داری audit، production HOLD، محدودیت دادهٔ مخفی |

بنابراین «دسترسی کامل» حق اجرای قابلیت معتبر با guardهای خودش است؛ SQL دلخواه، تغییر کارت/برنده، بازنویسی audit، افشای secret یا عملیات هنوز پیاده‌نشده قابلیت مدیریتی محسوب نمی‌شود. permission ناشناخته حتی برای OWNER خطای قرارداد و deny است؛ permission جدیدِ ثبت‌شده با permission ناشناخته تفاوت دارد. نام capability، metadata امنیتی و handler آن را release معتبر تعریف می‌کند، نه role editor.

Admin همچنان داخل Modular Monolith مالک operator، root binding، role، permission assignment، session، approval و audit است. قوانین کاربران/بازی/اتاق/Match در ownerهای فعلی می‌مانند. هیچ dependency جدید یا query بین جدول‌های ownerها با این طراحی مجاز نمی‌شود.

## ۲. حفاظت از حساب مالک

- فقط مراسم bootstrap/recovery محافظت‌شده می‌تواند binding مالک را ایجاد یا هویت خارجی همان مالک را بازیابی کند؛ CRUD نقش و مدیر به آن دسترسی ندارد. انتقال مالکیت به شخص دیگر در این نسخه endpoint ندارد و به ADR و مراسم جدا نیاز دارد.
- هیچ مدیر دیگری، از جمله Super Admin، نمی‌تواند OWNER را حذف، غیرفعال، محدود، تنزل، unbind، از environment خارج یا نشست‌های او را باطل کند؛ نمی‌تواند MFA/recovery او را reset یا IdP subject او را عوض کند.
- guard روی **target root binding** و operation اجرا می‌شود، نه روی عنوان نمایشی role. مسیرهای bulk، indirect role changes، حذف role، تغییر scope، import و API آینده نیز همین guard را دارند. هیچ CRUD عمومی `ownerOperatorId`، `principalKind` یا root state نمی‌پذیرد.
- خود OWNER نیز با حذف/غیرفعال‌کردن عادی حساب خود یا خاموش‌کردن آخرین authenticator معتبر نمی‌تواند سیستم را بدون مالک کند. logout، ابطال نشست‌های خود و تعویض امن کلید/identity با حفظ binding مجازند. session revocation، expiry و کنترل تشخیص compromise می‌توانند نشست مالک را ببندند؛ این‌ها سلب مالکیت نیستند.
- اتصال مدیریتی OWNER از حساب بازیکنی احتمالی او جداست؛ ban/delete کاربر Telegram یا تغییر profile به operator یا root binding سرایت نمی‌کند. از cascade delete بین Users و Admin استفاده نشود.
- نقش‌های عادی هیچ اختیار lifecycle مدیران یا ویرایش policy ندارند؛ این قابلیت‌ها `OWNER_ONLY` هستند و role editor نمی‌تواند آن‌ها را grant کند. این قاعده مانع واگذاری غیرمستقیم قدرت ارتقای خود می‌شود.
- مدیران عادی نباید در IdP/secret manager زیرساخت نیز اختیار reset کردن OWNER داشته باشند. این کنترل بخشی از inventory بیرونی است؛ برنامه نمی‌تواند جلوی مالک مخرب host، DBA یا IdP administrator را به‌تنهایی بگیرد. این ریسک با جداسازی credential، کنترل بیرونی و recovery مستقل مدیریت می‌شود.

## ۳. RBAC ترکیبی و الگوریتم مجوز

### ۳.۱ registry و پنج سطح دسترسی

هر operation یک permission پایدار مانند `users.view`، `reports.create`، `reports.edit`، `games.availability.manage` یا `matches.termination.approve` دارد. پنج سطح مستقل‌اند:

| سطح       | معنا                               | نمونه                                               |
| --------- | ---------------------------------- | --------------------------------------------------- |
| `view`    | خواندن projection مجاز             | `users.view`، `audit.view`                          |
| `create`  | ایجاد resource/request از نوع معین | `reports.create`، `matches.termination.create`      |
| `edit`    | ویرایش فیلدهای مجاز resource       | `reports.edit`؛ نه PATCH دلخواه                     |
| `manage`  | چرخهٔ عمر یا عملیات ویژهٔ مشخص     | `users.restrictions.manage`، `rooms.closure.manage` |
| `approve` | تأیید operation با policy خودش     | `games.availability.approve`                        |

`manage` به‌طور ضمنی view/create/edit/approve نمی‌دهد؛ templateها permissionهای لازم را صریحاً کنار هم می‌گذارند. read context محدود لازم برای approval باید در permission یا projection اختصاصی آن ثبت شود، نه با دسترسی پنهان به داده. نام‌های capability سند کلی، مثال‌اند؛ baseline آینده باید به registry واحد نگاشت شود، نه دو سیستم مترادف.

هر permission شامل key، section، action، مجازبودن game/resource/environment scope، projection داده، risk class، approval policy، `OWNER_ONLY` بودن، نسخه و handler binding است. فیلد security برای endpoint جدید اجباری باشد؛ CI endpoint بدون permission/risk metadata را رد کند. registry از release می‌آید و در داشبورد read-only است. تنها membership نقش‌ها و grantها editable هستند.

### ۳.۲ نقش، grant فردی و scope

نقش‌های پیش‌فرض templateهای نسخه‌دار از permissionهای صریح‌اند، بدون inheritance یا wildcard رشته‌ای مثل `*`. OWNER می‌تواند template را clone کند، نقش سفارشی بسازد، تغییر دهد و به یک یا چند مدیر اختصاص دهد. تغییر template در deploy مجوز جدید را به roleهای استفاده‌شده خودکار اضافه نمی‌کند؛ preview و اقدام مالک لازم است.

هر مدیر می‌تواند چند role assignment و چند permission فردی `ALLOW/DENY` داشته باشد. کنترل UI سه‌حالته است: «ارث‌بری از نقش»، «اجازهٔ صریح»، «منع صریح». خاموش‌کردن یک مجوزِ ارث‌برده، DENY می‌سازد؛ حذف override آن را به inheritance برمی‌گرداند.

Scope مجموعهٔ محدود و تایپ‌شدهٔ environment، game، section و در صورت نیاز resource است. permission key خود بخش/action را محدود می‌کند. scope assignment فقط scope grant را **تنگ‌تر** می‌کند. ابعاد یک grant با AND و grantهای جدا با OR ترکیب می‌شوند؛ مقدار environment از deployment معتبر و game/target از owner port استخراج می‌شود، نه از ادعای body. scope نامعتبر یا عدم امکان تعیین آن = deny. برای منابع سراسری، game scope بی‌معنا و ردشدنی است. انتخاب «همهٔ بازی‌ها» در UI scope ساخت‌یافته است؛ مجوز action آینده نمی‌دهد و گسترش به بازی جدید صریحاً در preview توضیح داده می‌شود.

### ۳.۳ ترتیب تصمیم در backend

1. شبکه، session، assurance و principal جاری را اعتبارسنجی کن؛ cookie/JWT فقط هویت جلسه را معرفی می‌کند، منبع role جاری نیست.
2. permission و handler معتبر، محیط واقعی، target protection و الزامات غیرقابل bypass را بررسی کن. برای retry هم همین مراحل انجام می‌شود.
3. اگر principal با root binding معتبر همان realm برابر است، لایهٔ permission/scopes را `OWNER_ALLOW` کن؛ DENYهای عادی در این branch اعمال نمی‌شوند. از این مرحله به بعد MFA، approval و rule دامنه همچنان الزامی‌اند.
4. برای غیرمالک، permissionهای `OWNER_ONLY` را رد کن. union مجوزهای نقش و ALLOW فردی را فقط در scope منطبق بساز؛ هر DENY فردیِ منطبق بر همان action/target بر تمام ALLOWها اولویت دارد. نبود grant = deny.
5. projection، فیلتر ردیف‌ها، تأیید و precondition دامنه را enforce کن. read/count/search/export، download، bulk و job هم authorization می‌خواهند؛ UI هیچ authority ندارد.

مثال: Operator از نقش، `rooms.closure.manage` برای staging می‌گیرد؛ ALLOW فردی production/coup و DENY فردی production/kahroba دارد. بستن اتاق Coup در production مجاز و کهربا ممنوع است. grant یک بازی به دیگری تعمیم نمی‌یابد؛ metadata هر دو بازی نیز permission خواندن خودش را می‌خواهد.

## ۴. ماتریس نقش‌ها و مجوزها

این ماتریس baseline template است؛ OWNER می‌تواند **permissionهای قابل واگذاری** را برای سایر نقش‌ها تغییر دهد. «صریح» یعنی فقط keyهای فهرست‌شده در نسخهٔ template و scope assignment، نه wildcard فعلی/آینده. هیچ کاربر واقعی در این کار به نقش اختصاص داده نمی‌شود.

| قابلیت                                 | OWNER                     | Super Admin                    | Moderator               | Support                   | Operator                   | نقش سفارشی                         |
| -------------------------------------- | ------------------------- | ------------------------------ | ----------------------- | ------------------------- | -------------------------- | ---------------------------------- |
| overview و metadata مجاز               | همه                       | صریح                           | حوزهٔ تخلف              | حوزهٔ پشتیبانی            | حوزهٔ عملیات               | طبق grant                          |
| کاربران: view پایه                     | همه                       | بله                            | بله                     | بله                       | خیر، مگر grant             | طبق grant                          |
| پرونده: create/edit/manage             | همه                       | صریح                           | بله در scope            | create و پروندهٔ پشتیبانی | خیر                        | طبق grant                          |
| restriction کاربران                    | همه                       | درخواست/مدیریت صریح            | درخواست/مدیریت در scope | خیر                       | خیر                        | طبق grant و policy                 |
| تنظیمات/flags/availability             | همه                       | permissionهای مشخص             | خیر                     | خیر                       | permissionهای عملیاتی مشخص | طبق grant                          |
| بستن اتاق / درخواست termination        | همه                       | صریح                           | خیر                     | خیر                       | صریح                       | طبق grant                          |
| تأیید عملیات پرخطر                     | تصمیم نهایی مالک          | grant جدا + دو فرد متمایز      | پیش‌فرض خیر             | خیر                       | پیش‌فرض خیر                | grant جدا + دو فرد متمایز          |
| audit و monitoring                     | همهٔ projectionهای مجاز   | صریح و scoped                  | فقط history پرونده      | فقط history مجاز          | monitoring در scope        | طبق grant                          |
| فهرست مدیران                           | همه                       | metadata غیرمالک در صورت grant | خیر                     | خیر                       | خیر                        | فقط permission خواندن قابل واگذاری |
| ایجاد/دعوت/فعال/غیرفعال/حذف مدیر       | بله، به‌جز تخریب root     | خیر                            | خیر                     | خیر                       | خیر                        | غیرقابل واگذاری                    |
| role CRUD / assignment / override فردی | بله، به‌جز تبدیل به OWNER | خیر                            | خیر                     | خیر                       | خیر                        | غیرقابل واگذاری                    |
| مشاهده/ابطال نشست دیگران               | بله                       | خیر                            | خیر                     | خیر                       | خیر                        | غیرقابل واگذاری                    |
| مشاهده/خروج از نشست‌های خود            | بله                       | بله                            | بله                     | بله                       | بله                        | قابلیت پایهٔ session               |
| دستکاری OWNER یا root binding          | فقط ceremony حفاظت‌شده    | ممنوع                          | ممنوع                   | ممنوع                     | ممنوع                      | ممنوع                              |
| permission جدید پس از release          | خودکار مجاز               | رد تا grant                    | رد تا grant             | رد تا grant               | رد تا grant                | رد تا grant                        |

نام Super Admin به معنای شریک مالک یا root دوم نیست. role سفارشی با نام `OWNER`، aliasهای گمراه‌کنندهٔ محافظت‌شده یا field ریشه رد شود؛ authority مستقل از نام است. تغییر نقش هیچ policy دادهٔ مخفی/retention را رفع نمی‌کند؛ حتی مالک فقط projection مصوب را می‌بیند.

فهرست اولیهٔ قابل‌بررسی برای templateها در مرحلهٔ فعال‌شدن قابلیت‌های مربوط:

| template    | permissionهای صریح پیشنهادی                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Super Admin | `overview.view`، `users.view`، `users.restrictions.manage`، `users.restrictions.approve`، `games.view`، `games.availability.manage`، `games.availability.approve`، `rooms.view`، `rooms.closure.manage`، `matches.view`، `matches.termination.create`، `matches.termination.approve`، `reports.view`، `reports.create`، `reports.edit`، `reports.manage`، `reports.approve`، `settings.view`، `settings.edit`، `settings.approve`، `feature_flags.view`، `feature_flags.edit`، `feature_flags.approve`، `monitoring.view`، `audit.view`، `statistics.view`، `statistics.rebuild.create`، `statistics.rebuild.approve` |
| Moderator   | `overview.view`، `users.view`، `reports.view`، `reports.create`، `reports.edit`، `reports.manage`، `users.restrictions.manage`؛ approve جدا و پیش‌فرض غایب                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Support     | `users.view`، `reports.create`؛ view/edit پرونده فقط با scope رابطهٔ مجازِ تعریف‌شده و grant جدا؛ ticketing آینده خودکار اضافه نمی‌شود                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Operator    | `overview.view`، `games.view`، `rooms.view`، `matches.view`، `monitoring.view`، `games.availability.manage`، `rooms.closure.manage`، `matches.termination.create`؛ approve جدا و پیش‌فرض غایب                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Custom      | مجموعهٔ خالی هنگام ایجاد؛ انتخاب مالک از permissionهای ثبت‌شده و قابل واگذاری                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

این جدول grant اجراشده نیست. در هر release فقط subset واقعاً ثبت‌شده و پیاده‌شدهٔ این فهرست می‌تواند با اقدام صریح مالک به template/assignment وارد شود؛ key آینده به‌صورت dormant grant ذخیره نمی‌شود. permissionهای حفاظت‌شدهٔ `operators.create/invite/activate/disable/delete`، `roles.create/edit/manage`، `access.manage`، `operator_sessions.view/manage` و `owner_decisions.approve` نیز در registry تعریف می‌شوند، اما فقط root branch آن‌ها را اجازه می‌دهد. approval پرخطر حتی با template Super Admin شرط فرد مستقل یا OWNER_FINAL را حفظ می‌کند.

## ۵. lifecycle محلی مدیران — اجرای فاز دو

فقط OWNER مدیر غیرریشه را ایجاد/فعال/غیرفعال/tombstone و role یا مجوز او را تغییر می‌دهد. Username یکتا و canonical است. ورود عمومی، دعوت متکی بر email/OIDC و مسیر accept عمومی حذف می‌شوند. «دعوت» در این مدل ثبت حساب توسط مالک و تحویل امن credential خارج از برنامه است؛ اتصال به کانال ارسال نیازمند مجوز جداست.

سرور با CSPRNG رمز دقیقاً ۱۲ کاراکتری از A–Z، a–z و 0–9 تولید می‌کند. برای جلوگیری از bias از sampling امن و برای تضمین حضور هر سه گروه از rejection sampling کل رشته استفاده شود. فقط verifier Argon2id نگه‌داری و رمز در پاسخ no-store یک‌بار به مالک نمایش داده شود؛ retry پس از پاسخ گم‌شده plaintext را از DB بازیابی نمی‌کند و نیاز به reset جدید دارد. این جریان باید در فاز دو به receipt امن و OWNER_FINAL متصل شود؛ فاز یک endpoint تولید رمز یا مدیریت مدیران ندارد.

بازنشانی رمز، credentialVersion و sessionEpoch را افزایش و همهٔ نشست‌ها/approvalهای قدیمی مدیر را باطل می‌کند. حذف، tombstone و revoke است؛ audit cascade delete نمی‌شود. نقش‌های پیش‌فرض و سفارشی، ALLOW/DENY فردی و scope طبق بخش‌های ۳ و ۴ باقی‌اند. هیچ نام نقش، DTO یا grant نمی‌تواند OWNER بسازد یا binding او را هدف بگیرد.

## ۶. اعمال تغییر مجوز روی نشست فعال

سیاست زیر تصمیم طراحی این بازطراحی است، نه ادعای عملکرد پیاده‌شده:

| مورد                                                | مرز قابل‌آزمون                                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| درخواست read/mutation جدید                          | هر authorization gate که پس از commit تغییر در PostgreSQL primary آغاز شود، permission جدید را می‌بیند؛ مجوز قبلی از cache مستقل قابل قبول نیست |
| retry یا job هنوز اجرا نشده                         | پیش از admission اثر، principal/session لازم، policy، approval و نسخه‌های جاری دوباره بررسی شوند؛ grant زمان enqueue کافی نیست                  |
| session صریحاً revoked یا operator DISABLED/DELETED | همهٔ درخواست‌های بعدی رد؛ فعال‌سازی مجدد، session revoked را احیا نمی‌کند                                                                       |
| اتصال/صفحهٔ فعال و stream آینده                     | حداکثر **۵ ثانیه** تا invalidate/قطع سمت سرور یا تشخیص انقضای lease؛ هیچ frame جدید بدون gate فعلی ارسال نشود                                   |
| tab خوابیده/آفلاین                                  | تضمین پاک‌شدن حافظهٔ دستگاه در ۵s داده نمی‌شود؛ پیش از resume/refetch/action revalidate، و بدون پاسخ معتبر نمایش/عمل حساس مسدود شود             |
| query/job از قبل admitted                           | revoke اثر commit‌شده را undo نمی‌کند؛ نقطهٔ admission ثبت شود. کار طولانی در هر batch/delivery دوباره مجوز بگیرد؛ توقف بین batchها لازم است    |

`authorizationVersion` فرد، `policyRevision` realm برای تغییر نقش/registry، `sessionEpoch` و revocation وضعیت پایدارند. هر gate یک snapshot سازگار از primary می‌خواند؛ cache permission فقط با revision خوانده‌شدهٔ فعلی قابل استفاده است. role change، assignment/override، status و session revoke در transaction Admin با bump مناسب، receipt، audit/outbox ثبت می‌شوند. تغییر role مشترک با bump policyRevision روی همهٔ اعضای نقش اثر می‌گذارد؛ فقط ویرایش session درخواست‌کننده کافی نیست.

Redis invalidation سرعت را بهتر می‌کند، اما حذف پیام، reconnect یا قطع Redis اجازهٔ stale authorization نمی‌دهد. UI با polling/notification کم‌حجم نسخه را بررسی می‌کند؛ پاسخ دیررس مربوط به revision/session قدیمی دور ریخته و query cache مرتبط پاک شود. برنامهٔ background مرورگر معیار قطع server نیست. در آینده streamهای Admin lease کوتاه با اعتبارسنجی مجدد دارند؛ به Socket بازی وصل نمی‌شوند.

قطع primary یا عدم تأیید revision باعث fail closed خواندن/نوشتن محافظت‌شده می‌شود. پس از کاهش مجوز، فرم باز و approval ذخیره‌شده authority نیستند. عملیات Admin→owner تراکنش مشترک ندارد: authorization قبل از revoke ممکن است اثر درحال‌اجرای قبلاً پذیرفته‌شده را بعداً commit کند؛ این مرز صریح و audited است، نه وعدهٔ لغو برگشتی. timeout و عمر context اجرا محدودند؛ work نگه‌داشته‌شده برای اجرا در آینده باید reauthorize شود.

## ۷. تصمیم نهایی مالک و Break-glass

### ۷.۱ مسیرهای تصمیم

| حالت              | شرایط                                                                                         | نتیجه                                                          |
| ----------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `DUAL_CONTROL`    | requester و approver غیرمالک دو فرد مستقل، هر دو دارای permission و scope فعلی؛ step-up معتبر | مسیر عادی مدیران برای عملیات پرخطر                             |
| `OWNER_FINAL`     | OWNER معتبر، درخواست خود یا دیگری، reauthentication مخصوص همان تصمیم و دلیل                   | جایگزین شرط فرد دوم؛ بدون انتظار برای وجود مدیر دیگر           |
| `OWNER_EMERGENCY` | authenticator اضطراری از پیش ثبت‌شده و proof معتبر مالک، incident و scope محدود               | مسیر اضطراری محدود برای اختلال هویت/رخداد؛ فاقد bypass زیرساخت |

OWNER_FINAL «دو رأی از یک نفر» ثبت نمی‌کند؛ outcome صریحاً authorityMode، operator ریشه، دلیل و proof احراز هویت تازه را مشخص می‌کند. approval UI عادی همچنان self-approval غیرمالک را رد می‌کند. حضور تنها یک مدیر، دلیل فعال‌کردن Break-glass نیست؛ OWNER_FINAL مسیر عادی و کافی مالک است.

اگر مالک درخواست مدیر دیگری را نهایی می‌کند، actor/commandId اولیه بازنویسی نمی‌شود و finalAuthorizer جدا ثبت می‌شود؛ صلاحیت جاری درخواست‌کننده در زمان admission همچنان بررسی می‌شود. با لغو صلاحیت او، approval قدیمی قابل احیا نیست؛ مالک می‌تواند پس از preview جدید، operation تازه و صریح متعلق به خودش با reference درخواست قبلی بسازد. این کار پس از reconcile وضعیت قبلی انجام می‌شود تا اثر دوباره ایجاد نشود؛ ارتقای ضمنی درخواستِ فاقد مجوز یا جعل هویت درخواست‌کننده ممنوع است.

پروفایل زمان پیشنهادی این بازطراحی: challenge تصمیم مالک **۱۲۰ ثانیه** معتبر؛ احراز هویت باید بعد از ایجاد challenge واقعاً اجرا شود و حداکثر **۶۰ ثانیه** پیش از نهایی‌کردن تصمیم باشد؛ مجوز اجرای حاصل **۶۰ ثانیه** و یک‌بارمصرف است. password و PIN باید بعد از challenge دوباره server-side بررسی و proof فقط به همان operation متصل شود؛ session قدیمی به‌تنهایی کافی نیست.

این اعداد policy مستند پیشنهادی و test fixture آینده‌اند؛ در محیطی اعمال نشده‌اند. تنظیمات absolute/idle session عادی و TTL دعوت هنوز وابسته به سیاست محیط هستند. تغییر زمان‌های حساس فقط با policy revision و review مجدد است؛ config غایب یا خارج از profile fail closed و افزایش مدت با مقدار client رد می‌شود.

### ۷.۲ پروتکل OWNER_FINAL

1. owner application port preview امنِ action، target، environment، expectedVersion، اثر برگشت‌پذیر/غیرقابل‌بازگشت و digest را می‌سازد. UI برای termination صریحاً «بازگشت ندارد» نشان می‌دهد.
2. challenge سروری به operator، session، operationId، digest، target revision، policyRevision، ownershipEpoch و environment متصل می‌شود. reasonCode اجباری و incident/reference ساخت‌یافته برای پرخطر لازم است. reason آزاد حساس وارد audit نمی‌شود؛ توضیح تفصیلی فقط در پروندهٔ مجاز با reference قابل نگه‌داری است.
3. مالک برای همان challenge با password و PIN فعلی برای همان عمل احراز هویت مجدد می‌کند؛ challenge/freshness بررسی، session تعویض و binding به session جدید به‌صورت سروری ثبت می‌شود. request field `ownerOverride=true` اثر ندارد.
4. خلاصهٔ نهایی به مالک نمایش داده می‌شود؛ تأیید صریح، نه checkbox از قبل فعال. تغییر target/digest/version/policy نیاز به challenge تازه دارد.
5. admission audit پایدار شامل `OWNER_FINAL` و reason ثبت می‌شود. مجوز یک‌بارمصرف به operation مشخص متصل و اتمیک claim می‌شود. owner دامنه، version/state و idempotency را کنترل و effect/receipt/outcome را commit می‌کند؛ همهٔ اصول ADR-039 برقرارند.
6. مصرف مجوز، retry اصل operation را خراب نمی‌کند: retry مجاز با commandId اصلی فقط receipt قطعی را بازیابی می‌کند. اگر اثر هنوز انجام نشده و execution grant منقضی است، reauth جدید برای همان operation/digest لازم است؛ با تغییر payload، operation جدید لازم است. outcome نامعلوم ابتدا reconcile می‌شود.
7. نتیجه و timeline audit ثبت می‌شود. اعلان metadata امن به کانال از پیش پیکربندی‌شدهٔ مالک/ممیزی با outbox ارسال می‌شود؛ خرابی notification عملیات commit‌شده را عقب نمی‌برد و باید جدا visible/retryable باشد. کانال اعلان برای تکمیل تصمیم، مدیر دوم لازم ندارد.

role/permission change و lifecycle مدیران غیرریشه `OWNER_ONLY` هستند؛ چون عملیات امنیتی حساس‌اند از همین مسیر fresh confirmation استفاده می‌کنند. پایان‌دادن Match، فعال‌سازی بازی و تغییر flag پرخطر نیز OWNER_FINAL یا DUAL_CONTROL می‌خواهند. مالک نیز اجازهٔ mute کردن audit، افزایش اختیار با bypass policy، بازکردن containment یا تغییر state بازی با SQL ندارد.

### ۷.۳ بازیابی خصوصی و Break-glass

بازیابی PIN فقط ابزار خصوصی سرور است؛ هیچ HTTP unlock/forgot یا IdP/WebAuthn/TOTP/SMS/email وجود ندارد. ابزار به OS root، فایل‌های root-owned با mode محدود و والدهای امن، تأیید صریح و دو امضای مستقل Ed25519 از اختیار اپراتور سرور و مالکیت پروژه نیاز دارد. امضا به realm/username/commandId/reason/digest و حداکثر پنج دقیقه متصل است. کلیدهای امضاکننده مستقل و خارج PostgreSQL هستند؛ کلید عمومی مورد اعتماد از custody سرور خوانده می‌شود. داشتن credential عادی DB/runtime برای اجرای ابزار یا رفع lock کافی نیست.

در transaction واحد و lock realm، PIN جدید hash، pinFailures=0، lockedAt=null، credentialVersion/sessionEpoch و ownershipEpoch افزوده، receipt و Audit ثبت می‌شوند. password و rootId عوض نمی‌شوند؛ همهٔ pending/full sessionهای قدیمی نامعتبر می‌شوند. failure Audit صفر اثر دارد. credential مخصوص recovery در runtime قرار نمی‌گیرد. DBA/superuser یا root مخرب سرور همچنان trust بیرونی‌اند و صرف جدول append-only جلوی آن‌ها را نمی‌گیرد؛ custody و drill واقعی قبل enrollment gate باقی‌اند.

Break-glass عمومی، حساب مخفی، نشست اضطراری بدون password/PIN یا fallback ضعیف ساخته نمی‌شود. تصمیم‌های اضطراری محصول در فاز دو فقط با proof عمل‌محور، scope/زمان محدود، reason، Audit و guard دامنه قابل طراحی‌اند؛ قفل OWNER از UI قابل دورزدن نیست. نبود DB/audit/private ingress با این ابزار حل نمی‌شود و runbook زیرساخت لازم است.

## ۸. راه‌اندازی نخستین OWNER

۱. ابتدا مسیر خصوصی، TLS، زمان‌های نشست، key custody/backup و recovery drill برای همان محیط انتخاب و تأیید شوند. در هر محیط database/realm و credential مستقل و فقط یک binding فعال مجاز است.
۲. مالک username/password/PIN خود را خارج Git انتخاب کند. request خصوصی شامل schemaVersion، commandId، username، password، pin، confirmed=true و reasonCode=INITIAL_OWNER_ENROLLMENT است؛ هیچ credential واقعی در نمونه یا migration قرار نمی‌گیرد.
۳. اپراتور و مالک از کلیدهای مستقل، statement محدود به همان digest/realm/username/commandId و زمان را امضا کنند. ابزار root با flag تأیید، فایل‌های امن و role مخصوص bootstrap اجرا می‌شود؛ API، startup یا first-login-wins ابزار را اجرا نمی‌کنند.
۴. verification امضا و Argon2 پیش از تراکنش انجام، سپس lock و recheck singleton، ایجاد operator/binding و receipt/Audit اتمیک می‌شوند. bootstrap دوم conflict است؛ retry همان ceremony همان نتیجهٔ منطقی را می‌دهد. binding از CRUD عادی قابل حذف یا جابه‌جایی نیست.
۵. authority/credential نصب بعد ceremony از محیط runtime خارج شود. restore قدیمی مجوز bootstrap تازه نیست؛ ownershipEpoch و key custody بیرون snapshot باید reconcile شوند.

[راهنمای فاز یک](../implementation/admin-dashboard-phase-1.md) مسیرهای اجرایی موجود و پیش‌نیازهای انتخاب‌نشده را شرح می‌دهد. هیچ حساب واقعی در این فاز ایجاد نشده است.

## ۹. مدل دادهٔ مفهومی

مدل‌های role/approval این جدول طراحی فازهای بعد هستند. schema واقعی فاز یک شامل admin_realms (binding و policy head)، admin_operators، admin_sessions، admin_grants، admin_auth_receipts و admin_audit_events است؛ verifierهای مستقل و pinFailures/lockedAt در operator نگه‌داری می‌شوند و کلیدهای recovery خارج DB هستند. جدول‌های آینده در فاز یک ساخته نشده‌اند.

| مدل                          | فیلدها/قیود مهم                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin_owner_binding`        | singleton realm، operatorId یکتا، ownershipEpoch، enrolledAt، ceremonyId؛ FK restrict؛ immutable از CRUD عادی                                                        |
| `admin_operators`            | ID، username یکتا در realm، passwordVerifier/pinVerifier مستقل، pinFailures/lockedAt، credentialVersion/sessionEpoch/authorizationVersion؛ بدون root flag قابل PATCH |
| `admin_roles`                | ID/name، templateKey/version اختیاری، revision، archivedAt؛ OWNER رزرو و خارج از این مدل؛ cycle/inheritance ندارد                                                    |
| `admin_role_permissions`     | role، permissionKey ثبت‌شده، scope تایپ‌شده؛ effect اینجا ALLOW؛ بدون wildcard capability                                                                            |
| `admin_role_bindings`        | operator/role، scope محدودکننده، revision، expiry اختیاری؛ role حذف‌شده grant نمی‌دهد                                                                                |
| `admin_permission_overrides` | operator، permissionKey، ALLOW/DENY، scope، revision و expiry؛ تغییر فقط مالک                                                                                        |
| `admin_policy_head`          | singleton realm و policyRevision؛ تغییر مشترک role/registry آن را bump می‌کند                                                                                        |
| `admin_invitations`          | identity نامزد/verified contact، state، expiresAt، revision نقش‌های تأییدشده، issuer مالک، acceptedOperatorId؛ لینک غیر bearer                                       |
| `admin_sessions`             | operator، sessionEpoch، issued/lastSeen/expires/revoked، assurance metadata و normal/emergency mode؛ بدون credential                                                 |
| `admin_decision_challenges`  | operation/session/owner/epoch/digest/policy binding، issued/expires/authenticatedAt و وضعیت مصرف؛ assertion خام ندارد                                                |
| `admin_operations`           | actor/commandId unique، inputDigest، target، expectedRevision، state و authorityMode                                                                                 |
| `admin_approvals`            | DUAL_CONTROL/OWNER_FINAL/OWNER_EMERGENCY، actor، source revisionها، proof reference، deadline؛ اثر به operation محدود                                                |
| `admin_bootstrap_receipts`   | ceremony/realm/subject reference، generation و outcome؛ secret یا hash احراز هویت ندارد                                                                              |
| `admin_audit_events`         | append-only با operation/event ID، actor/target، revisionهای قبل/بعد، reasonCode، authorityMode، نتیجه و correlation امن                                             |

permission catalog می‌تواند از release manifest به read model registry تبدیل شود؛ DB آن authority ساخت permission دلخواه نیست. metadata public key موردنیاز verification، token یا credential hash نیست و دسترسی محدود دارد. در UI sessions فقط metadata امن و session reference غیر bearer نشان داده شود؛ token، cookie، assertion، IP خام یا دستگاه fingerprint شده نمایش/ثبت نشود مگر policy جدا تصویب شود.

تغییر role/assignment/status/session در Admin، effect و receipt/outcome را در یک transaction مالک commit می‌کند. audit append-only همان actor و operation را پیوند می‌دهد؛ audit credential مجزاست و تنها append مجاز دارد. عملیات چند owner مطابق ADR-039 admission سپس effect/outbox دارند؛ ادعای transaction سراسری نمی‌شود. حذف role دارای assignment پیش‌فرض رد شود؛ مالک باید impact preview و unassign/migrate محدود و اتمیک یا workflow نسخه‌دار صریح را انجام دهد. role archive و approval معلق آن دوباره بررسی شوند.

مرز تراکنش audit دقیق باشد: bootstrap که root/receipt/audit متعلق به خود Admin هستند از credential مخصوص ceremony با دسترسی محدود به همین جدول‌ها در **یک اتصال و transaction** استفاده می‌کند؛ append-only بودن audit پابرجاست. در درخواست‌های عادی، admission audit با credential append جدا پیش از effect commit می‌شود و transaction مالک effect/receipt/outcome را ثبت می‌کند؛ outcome audit بعداً append می‌شود. دو pool/credential به‌اشتباه یک transaction فرض نمی‌شوند. حق نوشتن outcome outbox به scope مالک Admin افزوده می‌شود، بدون اعطای update/delete روی audit.

## ۱۰. APIهای موردنیاز

مسیرهای مدیریت مدیران و نقش‌ها آینده و متعلق به فاز دو، private، versioned و زیر `/v1/admin` هستند. `commandId`، `expectedVersion`/`expectedPolicyRevision`، reasonCode، CSRF و idempotency برای mutation لازم است. role ID، target ID و environment با منابع معتبر تطبیق داده می‌شوند. DTO strict در برابر mass assignment محافظت می‌کند؛ root fields رد می‌شوند.

| API پیشنهادی                                                          | اختیار / رفتار                                                                                                    |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /me/access`                                                      | همهٔ مدیران معتبر؛ permission/scope/projection مؤثر، نسخه‌ها و isOwner محاسبه‌شده برای UI؛ authority backend نیست |
| `GET /permissions`                                                    | registry قابل مشاهده طبق capability؛ metadata owner-only غیرقابل grant                                            |
| `GET /operators` و `GET /operators/:id`                               | OWNER کامل؛ projection غیرریشه فقط با view grant؛ root details فقط مالک                                           |
| `POST /operators`                                                     | OWNER_FINAL؛ افزودن هویت بررسی‌شده یا pending                                                                     |
| `POST /operator-invitations`، `POST /operator-invitations/:id/revoke` | مالک؛ دعوت scoped با expiry و role revision                                                                       |
| `POST /operators/:id/activate`، `/disable`، `/delete`                 | OWNER_FINAL و guard target غیرریشه؛ delete یعنی tombstone                                                         |
| `POST /roles`، `PATCH /roles/:id`، `POST /roles/:id/archive`          | OWNER_FINAL؛ revision و impact preview؛ نام/نوع OWNER ممنوع                                                       |
| `PUT /operators/:id/role-bindings`                                    | مالک؛ مجموعهٔ محدود و explicit، CAS؛ نمی‌تواند root را تغییر دهد                                                  |
| `PUT /operators/:id/permission-overrides`                             | مالک؛ inheritance/ALLOW/DENY و scope؛ owner-only قابل واگذاری نیست                                                |
| `POST /access/previews`                                               | OWNER؛ محاسبهٔ اثر تغییر روی افراد/صفحات/approvalها، بدون اعمال و بدون side effect                                |
| `GET /operators/:id/sessions`، `POST /operators/:id/sessions/revoke`  | مالک برای دیگران؛ epoch برای revoke-all و session ID برای تک‌نشست؛ root target برای غیرمالک ممنوع                 |
| `GET /me/sessions`، `POST /me/sessions/:id/revoke`                    | فقط خود، پس از current authentication؛ اصل logout durable حفظ شود                                                 |
| `GET /operators/:id/activity`                                         | مالک؛ سایرین فقط history مجاز خود/حوزه با projection محدود                                                        |
| `POST /operations/:id/approvals`                                      | DUAL_CONTROL؛ distinct actor، permission، current scope و step-up                                                 |
| `POST /operations/:id/owner-decision-challenges`                      | فقط root معتبر؛ درخواست reauth و binding یک‌بارمصرف                                                               |
| `POST /operations/:id/owner-decisions`                                | OWNER_FINAL؛ proof معتبر سروری، دلیل و digest؛ هیچ flag bypass پذیرفته نمی‌شود                                    |
| `GET /operations/:id` و `GET /audit-events`                           | scope مستقل و revision فعلی؛ unknown outcome را به success تبدیل نکند                                             |

Bootstrap و recovery rebind، API CRUD روزمره نیستند؛ از port/ceremony خصوصی با authority provisioning جدا استفاده می‌کنند. ابزار محدود فاز یک در گزارش همان فاز مستند است؛ هیچ invocation واقعی انجام نشده است. خطاهای پیشنهادی `ADMIN_OWNER_PROTECTED`، `ADMIN_OWNER_ONLY`، `ADMIN_PERMISSION_DENIED`، `ADMIN_POLICY_CONFLICT`، `ADMIN_DECISION_EXPIRED` و `ADMIN_BOOTSTRAP_CLOSED` باید در schema/baseline آینده ثبت شوند؛ پاسخ pre-auth وجود مالک یا identity را فاش نکند.

jobهای مدیریتی authority صاحب درخواست را از body خام نمی‌گیرند؛ reference operation معتبر و outcome نسخه‌دار لازم است. retry، redrive، bulk یا مسیر Bot آینده نباید validation را حذف کنند. تغییر نقش API نباید backend auth عمومی بازیکن را به Admin وابسته کند.

## ۱۱. طراحی صفحات فارسی و RTL

**مدیریت مدیران:** فهرست نام نمایشی، وضعیت، نقش‌ها، scopeها، وضعیت credential/قفل و آخرین فعالیت امن. ردیف OWNER نشان قفل «مالک اصلی» دارد؛ گزینهٔ disable/delete/change-role برای آن وجود ندارد و backend نیز رد می‌کند. دکمه‌های «افزودن»، «دعوت»، «نقش جدید» و مدیریت نشست دیگران فقط برای مالک‌اند. role/title جای badge محاسبه‌شدهٔ مالک نمی‌نشیند.

**جزئیات مدیر:** تب‌های نمایه، نقش‌ها، دسترسی مؤثر، نشست‌ها و تاریخچه. در تب دسترسی، پنج ستون مشاهده/ایجاد/ویرایش/مدیریت/تأیید و ردیف قابلیت‌ها با سه حالت inheritance/allow/deny، selector محیط/بازی و زمان انقضا. سیستم علت هر permission مؤثر را نشان می‌دهد: «از نقش Operator»، «اجازهٔ فردی» یا «منع فردی بر نقش غالب است». «همه» برای OWNER یک نشان معنایی است و هزاران grant قابل حذف تولید نمی‌کند.

**ویرایش نقش:** clone template یا نقش خالی؛ جست‌وجوی permission و گروه‌بندی section، نمایش risk و owner-only قفل‌شده. انتخاب manage، approve را خودکار تیک نمی‌زند. preview تعداد و شناسهٔ محدود افراد متأثر، تغییر صفحه/فیلد/عملیات، approvalهای نامعتبر و policyRevision را نشان می‌دهد. Save → reason → reauth مالک → نمایش diff نهایی → تصمیم → نتیجهٔ receipt. عملیات حساس optimistic update ندارد؛ conflict نیازمند preview تازه است.

**نشست‌ها:** metadata امن، زمان شروع/آخرین فعالیت/expiry، current session، normal/emergency و دکمهٔ revoke تکی/همه. ابطال نشست فعلی توضیح روشن دارد. UI revoked را با «منتظر انتشار» پنهان نمی‌کند؛ commit DB زمان شروع ضمانت است و قطع اتصال فعال تا ۵s نمایش داده می‌شود.

**مرکز تصمیم:** درخواست، risk، target، environment، version، برگشت‌پذیری و دلیل. برای مدیر عادی approval مستقل؛ برای مالک گزینهٔ متمایز «تصمیم نهایی مالک با احراز هویت مجدد». OWNER_FINAL حالت اضطراری نام‌گذاری نمی‌شود. Break-glass صفحهٔ جدا با incident، countdown، scope ثابت و خروج/ابطال دارد.

**Audit:** timeline دعوت/accept/activate، تغییر نقش و override، نسخه‌های قبل/بعد، revoke، تصمیم مالک، استفادهٔ emergency و نتیجه. توضیح خام حساس/secret نمایش داده نمی‌شود. export permission مستقل است و خود نیاز به audit دارد. تمام صفحات از Midnight/RTL/accessibility سند اصلی پیروی می‌کنند؛ کاهش دسترسی، route و دادهٔ cached را نیز invalid می‌کند.

## ۱۲. سناریوها و معیار پذیرش

| شناسه | سناریو                                                                                                  | نتیجهٔ لازم                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| AC-01 | login با player/Bot token، role claim جعلی OWNER یا body `isOwner`                                      | deny بدون اثر؛ فقط root binding معتبر authority می‌دهد                                         |
| AC-02 | permission معتبر جدید با release اضافه می‌شود                                                           | OWNER مجاز؛ تمام roleها حتی Super Admin تا grant صریح فاقد آن؛ permission ناشناخته برای همه رد |
| AC-03 | تغییر role/deny فردی یا scope روی مالک                                                                  | ordinary API رد؛ root اختیار خودکار را از دست نمی‌دهد                                          |
| AC-04 | Super Admin با URL مستقیم/bulk حذف، disable، revoke session یا rebind مالک را می‌خواهد                  | همه رد؛ نه اثر جزئی و نه تغییر epoch مالک                                                      |
| AC-05 | مدیر نقش خود را ویرایش یا owner-only permission به نقش سفارشی اضافه می‌کند                              | deny؛ rename/clone/import/unknown fields قدرت root نمی‌سازد                                    |
| AC-06 | دو bootstrap همزمان، replay و restart بعد نصب                                                           | یک binding؛ retry یک نتیجه؛ bootstrap بسته؛ manifest/subject متفاوت conflict                   |
| AC-07 | restore snapshot قبل enrollment با نصب فعال                                                             | bootstrap خودکار باز نشود؛ reconciliation بیرونی و مراسم لازم                                  |
| AC-08 | invite سرقت‌شده، identity دیگر، email مشابه، expired/revoked یا accept همزمان                           | دسترسی صادر نشود؛ فقط هویت منطبق+MFA، یک accept؛ pending subject به فعال تبدیل خودکار نشود     |
| AC-09 | role ALLOW و override DENY، چند role و scopeهای متقاطع                                                  | deny غالب، intersection ابعاد، union grantها؛ نشت game/environment رخ ندهد                     |
| AC-10 | کاهش permission در t0 روی primary و درخواست از node دیگر، با Redis قطع                                  | gate جدید بعد t0 مجوز تازه؛ stream قطع/invalidate ≤۵s؛ cache مستقل مجاز نباشد                  |
| AC-11 | session revoked، disable/delete سپس activate مجدد                                                       | session و approval قبلی زنده نشوند؛ تب خوابیده پیش از resume revalidate                        |
| AC-12 | primary outage و role cache موجود                                                                       | read/mutation محافظت‌شده fail closed؛ gameplay به dependency Admin اضافه نشود                  |
| AC-13 | فقط OWNER حاضر است و termination معتبر می‌خواهد                                                         | OWNER_FINAL با reauth/reason/audit موفق؛ نیازی به مدیر دوم یا emergency نیست                   |
| AC-14 | همان فرد غیرمالک requester و approver است                                                               | deny حتی اگر هر دو permission را دارد                                                          |
| AC-15 | challenge expired، proof session قدیمی، target/digest/version/policy تغییر کرده یا reauth فقط SSO خاموش | deny؛ عملیات یک‌بارمصرف و عمل‌محور؛ تست مرزهای ۶۰/۱۲۰ ثانیه                                    |
| AC-16 | audit قبل admission قطع؛ crash بعد admission؛ commit با ack گم‌شده؛ duplicate outcome                   | پیش از audit صفر اثر؛ یک اثر/receipt؛ reconciliation همان operation، audit بدون حذف/تکرار      |
| AC-17 | revoke بین enqueue و execution؛ approval فردی که permission او حذف شده                                  | reauthorize و deny اثر جدید؛ رخداد قبلاً committed برگشت داده نشود                             |
| AC-18 | emergency با IdP قطع، کلید ثبت‌نشده، session >۱۰ دقیقه یا action خارج allowlist                         | فقط proof معتبر و scope/زمان مقرر؛ بقیه deny؛ MFA/network/audit bypass نشود                    |
| AC-19 | OWNER می‌خواهد raw state، UPDATE audit، force-win یا engine swap فعال اجرا کند                          | invariant دامنه و داده برای مالک نیز پابرجا                                                    |
| AC-20 | حذف مدیر/role مشترک و permission change همزمان                                                          | CAS و transaction؛ audit محفوظ، بدون grant/approval یتیم؛ اثر جمعی previewشده                  |
| AC-21 | UI فارسی: inheritance/deny، scope، route forbidden، response دیررس و موبایل                             | نمایش صحیح effective access، no optimistic privilege، keyboard/RTL و cache پاک‌شده             |
| AC-22 | abuse CSRF/IDOR/mass assignment، spoofed peer، entitlement endpoint bypass                              | تمام adapterها و backend use caseها guard یکسان؛ فیلد/ردیف/count/export غیرمجاز نشت نکند       |

Unit برای policy algebra و lifecycle؛ integration واقعی PostgreSQL/Redis برای grant/version/race/outbox؛ contract برای registry/API/events؛ Playwright برای جریان OWNER و دو مدیر و RTL؛ اطلاعات‌جریان برای log/response/queue؛ failure/recovery برای DB/IdP/audit/Redis و restore لازم‌اند. تست ابطال با clock کنترل‌شده و چند node و checkpoint commit primary انجام شود، نه sleep غیرقطعی. بار خواندن revision نیز در آزمون پنل+بازی اندازه‌گیری شود.

این تست‌ها معیار پذیرش آینده‌اند؛ در این کار کد یا suite اجرایی ساخته/اجرا نشده است. scriptهای واقعی مخزن در فاز اجرا خوانده و suite Admin در manifest/CI ثبت خواهد شد.

## ۱۳. تفاوت با طراحی قبلی و مراحل اجرا

| موضوع              | طراحی قبلی                                 | طراحی بازنگری‌شده                                                                  |
| ------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| authority مالک     | نقش مستقل نداشت؛ همه grant صریح می‌خواستند | root binding یکتا و protected؛ تمام permissionهای ثبت‌شده برای OWNER               |
| قابلیت آینده       | همه پیش‌فرض deny                           | OWNER خودکار allow؛ سایرین explicit grant                                          |
| مدیر یگانه         | عملیات دو‌نفره تا تعیین نفر دوم مسدود      | OWNER_FINAL با fresh proof، reason و audit؛ بدون انتظار نفر دوم                    |
| roleهای آماده      | جدول capability ثابت                       | templateهای Super Admin/Moderator/Support/Operator و role سفارشی                   |
| دسترسی فردی        | مشخص نشده بود                              | ALLOW/DENY/INHERIT با scope و deny precedence برای غیرمالک                         |
| مدیر امنیت         | پیشنهاد اختیار assignment داشت             | lifecycle/role management فقط OWNER؛ ممیزی امنیتی قابل واگذاری باقی می‌ماند        |
| revocation         | زمان انتشار باز بود                        | primary gate جاری در هر درخواست؛ اتصال فعال ≤۵s؛ in-flight semantics صریح          |
| bootstrap/recovery | سیاست کلی و باز                            | ceremony identity-bound یک‌بارمصرف، singleton، کلید پشتیبان و مسیر emergency محدود |
| حذف مدیر           | مشخص نشده بود                              | tombstone+revoke+invalid approval؛ audit بدون cascade                              |

مرحلهٔ اول پیاده‌سازی آینده: registry/guard/root bootstrap و auth با تست AC-01…AC-12؛ مرحلهٔ دوم: مدیریت مدیران/نقش/override/نشست و UI؛ مرحلهٔ سوم: OWNER_FINAL و dual control با outbox/reconciliation؛ مرحلهٔ چهارم: recovery/emergency pre-enrollment و drill. **پیش از فعال‌شدن mutationهای پرخطر، مسیر OWNER_FINAL باید کامل باشد** تا دوباره وابستگی اجباری به مدیر دوم ساخته نشود. emergency تا اجرای drill فعال نمی‌شود؛ وجود آن prerequisite استفادهٔ روزمرهٔ OWNER_FINAL نیست.

پیش‌نیازهای محیطی باقی‌مانده: credential واقعی مالک و تأیید ریسک PIN ثابت، inventory private peers، custody کلید bootstrap/recovery، absolute/idle session، TTL دعوت، retention و alert destination. مقادیر ۵s و ۶۰/۱۲۰s و ۱۰min این سند profile طراحی‌اند؛ تأیید اجرایی/اندازه‌گیری آن‌ها gate استقرار است. هیچ‌یک با hardcode کردن identity یا ویرایش دستی DB حل نمی‌شوند.

منابع بیرونی بررسی‌شده در ۲۰۲۶-۱۰-۲۵: مجوزدهی در هر درخواست و deny-by-default برای نقش‌های غیرمالک با [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) سازگار است؛ اتصال تأیید به عملیات و دادهٔ مشخص با [OWASP Transaction Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html)؛ اصطلاح phishing-resistant MFA و lifecycle authenticator با [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html). مدل OWNER، استثنای quorum و اعداد زمانی، تصمیم طراحی HamBazi هستند و الزام نقل‌شده از این منابع نیستند.
