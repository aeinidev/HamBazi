# آمادگی انتشار فاز سوم Admin روی Staging

> وضعیت جاری — 2026-10-30: [استقرار فاز سوم روی Staging](admin-phase-3-deployment-20261030.md) موفق است؛ سرویس‌ها، HTTPS و QA خواندنی OWNER تأییدند. محرومیت جدید طبق برنامه خاموش و QA زندهٔ ابطال نشست مدیر آزمایشی باز است. Qualification محلی زیر سابقهٔ آماده‌سازی است؛ نتیجهٔ مقصد در گزارش مستقل ثبت شده است.

تاریخ تکمیل: 2026-10-30 (Asia/Tehran). زمان دقیق UTC آزمون‌ها در evidence ثبت است. **آماده‌سازی محلی موفق بود؛ فاز سوم پس از مجوز جداگانه روی Staging مستقر شد.** مرجع جاری [Qualification نهایی](../security/admin-phase3-final-qualification.json) و [artifactهای دقیق](../security/admin-phase3-remediated-artifacts.json) است. CI و ساخت artifactها به commit تمیز `c7add7bf7b32e77b153abc6ebb411d4954e4a668` و snapshot/digestهای ثبت‌شده متصل‌اند؛ اصلاح runtime در `a9dbf14` کامل شده و اختلاف تا commit آزموده‌شده شامل checkpoint مستنداتی، اصلاح محدود inventory شواهد CI با تست مثبت/منفی و محدودیت دو worker بین فایل‌های واحد API است. commit بعدی این گزارش نیز فقط مستندات/evidence است؛ CI برای آن commit مستنداتی ادعا نمی‌شود.

## کنترل‌های تکمیل‌شده

| کنترل               | نتیجه و دامنه                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI واقعی            | entrypoint بدون تغییر `node infra/ci/verify.mjs`، هر ۲۸ gate موفق؛ checkout تمیز با تاریخچهٔ کامل، نصب frozen و بدون `.env` محیط کاری              |
| Backend             | ۳۰۶ تست شامل Database=۱۸، API=۲۶۳ و Worker=۲۵؛ پنج timeout قبلی با همان حدود زمان و پوشش موفق                                                      |
| مرورگر              | شش سناریوی release در همان اجرای جامع؛ ordinary، SDK، Admin، preview و smoke ایمیج نیز در gateهای اصلی موفق                                        |
| امنیت               | secret scan تاریخچه/candidate، dependency audit، hash ابزارها، freshness و منع HIGH/CRITICAL/UNKNOWN حفظ و موفق؛ استثنای تازه یا bypass وجود ندارد |
| artifactها          | API/Bot/Worker/Web با پروفایل مصوب Staging و Admin از همان کد ساخته، اسکن و اجرا شدند؛ digestهای نهایی در فهرست جدا ثبت‌اند                        |
| Redis دقیق baseline | تصویر `a2b331…` با نسخهٔ 8.10.2 محلی بررسی شد؛ آزمون کامل عملکردی و fixture production/TLS با PostgreSQL دقیق `7de…` و همان Redis موفق             |
| Admin و Migration   | ۴۰ تست Integration و ۳۸ کنترل همان ایمیج TLS؛ ارتقای دارای داده از ۱۹ به ۲۱ Migration، redeploy/drift و حفظ OWNER/Audit ساختگی موفق                |
| Backup/Restore      | rehearsal رمزگذاری CMS/AES-256-GCM، دو دیتابیس و globals، تمام ۴۵ جدول، constraints/triggers/grants و رد archive دستکاری‌شده در محیط ایزوله موفق   |

اعداد و زمان‌های دقیق و شدت‌های غیرمسدودکننده در JSON ثبت‌اند. صفر یافتهٔ مسدودکننده به معنی صفر همهٔ شدت‌ها نیست. شواهد ظرفیت یا سلامت زندهٔ سرور را تأیید نمی‌کنند.

## علت‌ها و اصلاح‌ها

- fixtureهای ترتیبی نزدیک مهلت پنج‌ثانیه‌ای، تأخیر fsync دیسک USB و قفل writer سراسری در recovery اتاق عامل‌های قابل بازتولید بودند. کار مستقل در همان test موازی شد و PostgreSQL در پوشهٔ خصوصی و تازهٔ دیسک پایدار runner قرار گرفت؛ tmpfs/ramfs رد و fsync/synchronous_commit/full_page_writes روشن باقی ماندند. workload، assertionها و timeoutها تضعیف نشدند.
- snapshot اتاق Serializable و READ ONLY است؛ projection خصوصی Match با یک SELECT محدود و پارامتری خوانده می‌شود. کنترل version/lock نویسنده، مالکیت داده و provenance حفظ‌اند؛ همان پنج تلاش retry با jitter محدود پس از rollback اجرا می‌شوند. هر دو گرهٔ Presence پیش از client با probe واقعی آماده می‌شوند؛ lease/heartbeat/SIGKILL تغییر نکردند.
- رقابت CPU در parallelism پیش‌فرض فایل‌های واحد API نیز بازتولید شد: ۳۵ شکست از ۱۰۷۳ تست؛ با دو worker تمام ۱۰۷۳ تست در ۲۰٫۸۶s و همان timeoutها موفق شدند. حد دو worker فقط بین فایل‌ها در script واحد API ثبت و با guard کیفیت کنترل شد؛ concurrency و workload داخلی سناریوها تغییر نکرد.
- quality graph همان typecheck/test/build را یک بار در گراف اجباری Turbo اجرا می‌کند؛ Infra و تمام کنترل‌ها و مهلت‌ها حفظ‌اند.
- مرورگر race مستقل catchup و نگه‌داشتن intent پس از رد قطعی `GAME_STATE_CONFLICT` را آشکار کرد. invalidation/gap حین read حفظ، syncها coalesce و view عقب‌مانده رد می‌شوند؛ پس از sync، intent قطعی ردشده آزاد می‌شود و اقدام تازه انتخاب صریح کاربر می‌خواهد. خطای مبهم شبکه همان action ID/body را حفظ می‌کند. تست بازتولید ابتدا FAIL و پس از اصلاح PASS شد؛ قرارداد خطای Backend تغییر نکرد.

[ADR-092](../adr/092-durable-fixtures-and-read-only-room-recovery.md) تصمیم و محدودیت‌ها را ثبت می‌کند. بررسی کوچک دیسک، آزمون ظرفیت نیست. تصویر دقیق Redis قبلاً محلی موجود نبود؛ ناسازگاری Redis اثبات نشد و نسخه یا دادهٔ سرور تعویض نشد. تنها inspect/export تصویر Staging فقط‌خواندنی بود؛ اطلاعات دیتابیس یا OWNER خوانده نشد.

## Docker، دیسک و تاریخچه

طبق تأیید صریح مالک، pin محلی/CI به `29.9.2` در workflow، toolchain، آزمون‌های منفی و [ADR-041](../adr/041-ci-trust-and-evidence.md) هماهنگ شد. نسخهٔ متفاوت، snapshotter خاموش، ابزار ناسازگار و evidence کهنه همچنان رد می‌شوند. daemon رایانه و سرورها توسط این کار ارتقا نیافتند.

قطع USB و خطای ext4 اجرای قبلی را متوقف کرد. commitها و bundle تاریخچهٔ کامل روی دیسک داخلی حفظ و verify شدند؛ پس از اتصال سالم/بوت جدید، mount عادی، نبود خطای ذخیره‌سازی در لاگ بوت، `git fsck` مخزن اصلی و دسترسی Docker بررسی شد. گزارش checkpoint با fast-forward بدون بازنویسی تاریخچه به مخزن اصلی رسید؛ Qualification کامل و انتقال PostgreSQL سپس دوباره اجرا شدند. این مشاهده، تضمین سلامت فیزیکی آیندهٔ دیسک نیست.

[Checkpoint توقف](../security/admin-phase3-recovery-checkpoint.json)، [Qualification اولیه](../security/admin-phase3-release-qualification.json)، [Docker 29.8.2](../security/admin-phase3-docker-29.8.2-qualification.json) و [آماده‌سازی قبلی](../security/admin-phase3-staging-preparation.json) تاریخی و بدون بازنویسی باقی ماندند. اجراهای ناموفق و توقف تشخیصی در گزارش نهایی مشخص‌اند؛ موفقیت جزئی CI موفق اعلام نشد. [ADR-091](../adr/091-proposed-phase3-staging-timeout-risk.md) پس از رفع علت و CI واقعی موفق Withdrawn است؛ استثنا نه تصویب و نه استفاده شد. GitHub Actions میزبانی‌شده در این کار اجرا نشده است.

یک اجرای استاندارد پس از اتصال دیسک در gate `migration-fault-release` شکست خورد؛ علت دقیق آن از خروجیِ فیلترشده اثبات نشد. اجرای مستقل همان harness و تمام ۲۸ gate تشخیصی موفق شدند، اما ثبت evidence به‌علت رد تصویر/فونت Web شکست خورد. پس از اصلاح allowlist محدود به assets ، مهار رقابت workerها و موفقیت تست‌های بازتولید و ۲۰۹ تست Infra، CI استانداردِ نهایی بدون observer موفق شد. شکست قبلی در evidence باقی است و به PASS تبدیل نشده؛ در صورت تکرار، انتشار باید متوقف و علت تازه بررسی شود.

ساخت سرد محلی در CI حدود ۸۵۳ ثانیه از مهلت ثابت ۹۰۰ ثانیه مصرف کرد. اجرای کامل موفق است، ولی حاشیهٔ این Build روی رایانهٔ فعلی کم است؛ شکست اجرای بعدی همچنان NO-GO می‌شود. این زمان، ظرفیت محصول یا سرور آینده را تأیید نمی‌کند.

## کنترل‌های هر نصب بعدی

[برنامهٔ Backup، نصب و Rollback](admin-phase-3-staging-release-plan.md) در انتشار مجاز ۳۰ اکتبر اجرا شد؛ کنترل‌های زیر برای هر نصب بعدی همچنان لازم‌اند. اجرای تازه مجوز جداگانه می‌خواهد:

1. تأیید صریح Staging و binding دقیق کد/artifact؛ تطبیق live image/config/grants، سلامت PostgreSQL/Redis/Nginx/API/Bot/Worker/Web/Admin و کنترل‌های امنیتی تازه، بدون تمدید deadline.
2. full backup واقعی تازه و capsule رمزگذاری‌شدهٔ تنظیمات/کلیدها با ابزار و گیرندهٔ بازبینی‌شده؛ کپی خارج سرور، SHA-256 و بازیابی واقعی همان archive با receipt منطبق. ورود اطلاعات محرمانه فقط توسط مالک در ترمینال خصوصی است. rehearsal ساختگی جای این gate نیست؛ بکاپ OWNER جای full backup را نمی‌گیرد.
3. پس از مجوز نصب، بررسی سازگاری بارگذاری ایمیج روی daemon فعلی پیش از cutover، بدون ارتقای Docker سرور؛ نگهداری PostgreSQL `7de…`، Redis `a2b331…` و داده‌ها. pin 29.9.2 مجوز ارتقای سرور نیست.
4. Migration افزایشی، grants محدود، `nginx -t` و QA زندهٔ مجاز؛ تصمیم مستقل فعال‌سازی flag محرومیت. پیش‌فرض flag=false، عملیات مدیریت فاز دوم و reconciliation حفظ می‌شوند.
5. پس از مجوز QA زنده، 403 مدیر دارای فقط `users.view` در حالت authenticated، receipt/Audit اجرای `ADMIN_REVOKE_SESSIONS` و رد نشست قبلی و سپس `DISABLED` شدن مدیر موقت جداگانه اثبات شوند. آزمون‌های محلی موفق، وضعیت فعلی حساب آزمایشیِ Staging یا نتیجهٔ شفاهی قبلی را بازتأیید نمی‌کنند.
6. Rollback پس از هر اثر محرومیت باید API/Worker سازگار با enforcement/expiry/reconciliation را حفظ کند؛ حذف داده/Audit، down migration، بازگشت به فاز دوم ناسازگار یا restore روی DB زنده مجاز نیست.

در دامنهٔ آماده‌سازی محلی، تغییر Staging، بکاپ واقعی تازه و بررسی سلامت مقصد انجام نشده بودند؛ اجرای مجاز بعدی در [گزارش انتشار](admin-phase-3-deployment-20261030.md) ثبت است. Production و اطلاعات ورود OWNER/PIN تغییر نکردند؛ ظرفیت/Load/Stress/Soak و فاز چهارم انجام نشده‌اند. ریسک‌های Production مانند retention توضیح محرمانه، چرخش کلید، RPO/PITR و SLO تصمیم جداگانه می‌خواهند.
