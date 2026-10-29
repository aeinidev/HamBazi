# فاز سوم Admin — آماده‌سازی محلی

مرجع تصمیم: ADR-090. مجوز فعلی فقط توسعه/تست محلی است؛ هیچ اتصال یا تغییر Staging/Production و هیچ تغییر حساب OWNER واقعی در این کار مجاز نیست.

این سند گزارش تاریخی پایان توسعه را نگه می‌دارد. وضعیت جاری در [گزارش آمادگی انتشار](admin-phase-3-release-readiness.md) و [شواهد تکمیلی](../security/admin-phase3-staging-preparation.json) ثبت شده است: طبق [checkpoint جدید](../security/admin-phase3-recovery-checkpoint.json)، ۳۰۶ تست Backend و شش release browser موفق‌اند، ولی CI کامل نشده و خطای I/O دیسک محلی انتشار را NO-GO نگه می‌دارد. نتیجهٔ تاریخی `docs/security/admin-phase3-release-qualification.json` و عبارت «مانع شناخته‌شده باقی نمانده» در پایین، وضعیت پیش از Qualification بعدی را شرح می‌دهند و تأیید انتشار فعلی نیستند.

## دامنه و مراحل

۳.۱ قرارداد، ADR و تهدیدها؛ ۳.۲ portهای Users/Matches و انقضا؛ ۳.۳ فرمان‌های محدودیت، مجوزها و توضیح محرمانه؛ ۳.۴ UI فارسی/RTL؛ ۳.۵ تست‌های امنیتی، Integration، مرورگر و بررسی انتشار. ویرایش نام و machinery تأیید/receipt فاز دوم استفاده می‌شوند؛ گزارش تخلف، chat moderation و مالی خارج از محدوده‌اند.

## برنامهٔ انتشار آینده (اجرا نشده)

1. مجوز جداگانهٔ Staging، اعتبار تازهٔ اسکن/Qualification و سلامت سرویس‌ها؛ ثبت شناسهٔ release/ایمیج ثابت.
2. full backup رمزگذاری‌شده شامل users، user_restrictions، user_admin_effects، admin_operations/Audit و schema/grants؛ کپی خارج سرور و restore ایزولهٔ همان archive با checksum معتبر. بکاپ محدود OWNER به‌تنهایی جایگزین full backup بازی‌ها و کاربران نیست. ADMIN_COMMAND_KEY در vault/بکاپ رمزگذاری‌شدهٔ مستقل از DB نگه‌داری شود.
3. maintenance نوشتن Admin، نگه‌داشتن محدودیت‌ها روی false، migrationهای 202610280001_admin_private_notes و 202610280002_user_restrictions؛ سپس grantهای phase3 با migration role. timeout دوثانیه‌ای reader فقط به همان دیتابیس محدود است و تنظیم سراسری role در cluster تغییر نمی‌کند. migrations تخریبی نیستند.
4. binaryهای API/Worker/Admin سازگار، proxy allowlist دقیق GETهای جدید، nginx -t پیش از reload. Backend خصوصی باقی می‌ماند. احراز هویت OWNER و PIN بدون تغییر. digest همین نسخهٔ آزموده‌شده با mutation خاموش به‌عنوان fallback سازگار ثبت شود.
5. health، read paths، تست synthetic با مجوز کم، سپس فعال‌سازی صریح ADMIN_USER_RESTRICTIONS_ENABLED با مجوز جدا و آزمون با کاربر آزمایشی؛ دادهٔ بازی واقعی یا OWNER برای تست محروم نشود.
6. در شکست، ورودی mutation بسته و نسخهٔ سازگار قبلی همین phase3 حفظ/برگردانده شود؛ schema/داده به عقب برنگردد. پیش از هر محرومیت phase3 می‌توان binary فاز دوم را برگرداند. پس از آن downgrade به فاز دوم بدون نگه‌داشتن enforcement/expiry مجاز نیست. restore کامل فقط طبق برنامهٔ حادثه، در maintenance و با حفظ داده‌های پس از backup.

## پذیرش و شواهد

مدت‌های دقیق، مرز انقضا، دائم، رفع دستی، رقابت و تکرار فرمان، عدم احیای توکن قدیمی، permissions جاری/deny و تفکیک OWNER/PENDING، شکست Audit، ciphertext و نبود متن در پاسخ/Audit، اطلاعات خلاصهٔ بازی، normalizer نام، CSRF و default deny، UI RTL/mobile/accessibility باید در harness disposable محلی بررسی شوند. ADMIN_REVOKE_SESSIONS، 403 مدیر users.view و ADMIN_STATUS=DISABLED باید واقعاً اجرا و evidence آن‌ها جدا از گزارش زندهٔ ناقص فاز دوم ثبت شوند.

## نتیجهٔ کنترل‌های محلی — 2026-10-28

مراحل ۳.۱ تا ۳.۵ در محدودهٔ مدیریت پیشرفتهٔ کاربران تکمیل شدند؛ dependency و سرویس جدید اضافه نشده است. هیچ اتصال یا تغییری روی Staging، Production یا حساب OWNER واقعی انجام نشد. محروم‌سازی در پیکربندی پیش‌فرض خاموش است.

| کنترل                                           | نتیجه                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `TURBO_CONCURRENCY=1 pnpm check`                | موفق؛ format، lint، مرز معماری، typecheck، همهٔ تست‌های workspace/infra، Build و سازگاری قراردادها                       |
| مجموعهٔ Unit/API                                | ۱۰۶۷ تست موفق در ۶۳ فایل؛ زیرمجموعهٔ Admin شامل ۵۱ تست                                                                   |
| `pnpm --filter @hambazi/api test:admin:local`   | ۴۰ تست Integration موفق: هویت/TLS=۱۳، فاز دوم=۹، فاز سوم=۱۴، بازیابی OWNER=۴                                             |
| مرورگر واقعی داخل harness                       | هر دو مجموعهٔ فاز دوم و سوم موفق؛ Backend واقعی، TLS، Cookie، CSRF، OWNER_FINAL، محرومیت/رفع و مشاهدهٔ ثبت‌شوندهٔ توضیح  |
| `pnpm --filter @hambazi/admin test:browser`     | ۷ تست عمومی موفق؛ دو تست real-only در این فراخوانی مستقل skip می‌شوند و در harness بالا واقعاً اجرا شده‌اند              |
| `pnpm --filter @hambazi/api test:admin:ingress` | ۴ تست موفق روی Nginx واقعی محلی؛ default deny، upstream TLS، forwarding، Rate Limit، مسیرهای جدید و ممنوعیت direct write |
| `pnpm --filter @hambazi/api test:admin:private` | کنترل فایل‌های خصوصی root و prompt واقعی PTY موفق                                                                        |
| Secret Scan                                     | تاریخچهٔ کامل و candidate موفق؛ بدون استثنا یا suppression جدید                                                          |
| Dependency Audit                                | بدون advisory ثبت‌شده؛ HIGH/CRITICAL نیز صفر                                                                             |
| UI                                              | فارسی/RTL، desktop و عرض ۳۹۰، کنترل axe و عدم overflow کل صفحه موفق؛ تصاویر synthetic بازبینی شدند                       |

مجموعهٔ زیرساخت همچنین با `SECURITY_SCANNER_DIR` واقعی اجرا شد: ۱۹۸ تست موفق، بدون skip؛ تشخیص canary و محدودبودن دقیق استثناهای مصوب نیز با ابزار واقعی بررسی شدند.

احراز هویت/ابطال نشست بازیکن با نقش واقعی `hambazi_api` و انقضای دوره‌ای با نقش واقعی `hambazi_worker`، مدت‌های پنج‌گانه، انقضا دقیقاً در مرز، دائم و رفع آن، legacy BANNED، رقابت درخواست‌ها، تکرار فرمان، عدم احیای توکن قبلی، محدودیت هزینهٔ reader، عدم نشت state/results دیگران، حفظ state/version/pins مسابقهٔ ACTIVE و عدم ساخت event/result در اثر محرومیت، ciphertext/AAD، مجوز مستقل توضیح و شکست Audit پوشش داده شده‌اند. schemaهای جدید additive هستند؛ برای حفظ baseline منجمد، جستجو مسیر مستقل `/v1/admin/users/search` دارد.

خاموش‌شدن flag محرومیت، reconciliation رسیدهای قبلاً commit‌شده را متوقف نمی‌کند؛ تست نشان می‌دهد Audit نهایی با یک اثر و بدون اجازهٔ اجرای جدید تکمیل می‌شود. تاریخ پایان واقعی، شناسهٔ درخواست رفع و توضیح محرمانهٔ جداگانهٔ رفع در UI قابل پیگیری‌اند.

خطاهای کشف‌شده و اصلاح‌شده: wildcard شدن `%`/`_` در جستجو؛ پاک‌شدن نتیجهٔ عملیات OWNER با تغییر سیاست نقش؛ درخواست‌های تکراری پروفایل هنگام polling دسترسی و mount اضافی که 429 می‌ساخت. سقف درخواست، timeout تست یا کنترل امنیتی برای عبور از تست‌ها کاهش داده نشد. اجرای کنترل نهایی با concurrency مصوب CI انجام شد.

### شواهد ابطال نشستِ مورد اختلاف فاز دوم

دو مسیر مستقلِ Service/HTTPS و مرورگر واقعی، روی حساب‌های synthetic در PostgreSQL محلی اجرا شدند: مدیر فقط `users.view` بدون PIN وارد شد، دسترسی مدیران پاسخ 403 داد، فرمان واقعی `ADMIN_REVOKE_SESSIONS` تا execute اجرا شد و نشست قبلی 401 گرفت، سپس `ADMIN_STATUS=DISABLED` اجرا و موفقیت هر دو در Audit ثبت شد. این نتیجه اثبات محلیِ نسخهٔ جدید است؛ گزارش تاریخی Staging و وضعیت حساب آزمایشی آن بازنویسی یا از راه دور دوباره تأیید نشده‌اند.

### آمادگی و موارد باقی‌ماندهٔ انتشار

مانع شناخته‌شدهٔ عملکردی در پذیرش محلی باقی نمانده است. این گزارش جایگزین مجوز یا Qualification استقرار نیست. ساخت/اسکن ایمیج نهایی و Qualification آن در این فاز دوباره انجام نشده‌اند؛ پیش از انتشار باید به همین snapshot کد متصل و معتبر باشند. full backup رمزگذاری‌شدهٔ تازه و restore معتبر همان نسخه، health/QA روی Staging و تأیید جداگانهٔ انتشار لازم‌اند. بکاپ محدود OWNER فقط در محیط synthetic بازیابی شد و جایگزین بکاپ کامل Users/بازی‌ها نیست.

ظرفیت/Load/Stress عمداً اجرا نشده و ظرفیت عملیاتی تأیید نمی‌شود. نگه‌داری توضیحات محرمانه و چرخش کلید، محدودیت جستجوی contains در دادهٔ بزرگ و حفظ enforcement/expiry هنگام rollback طبق ADR-090 باید پیش از گسترش Production بررسی شوند. هیچ deadline یا کنترل توقف امنیتی سرور تغییر نکرده است.
