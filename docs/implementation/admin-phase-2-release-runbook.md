# برنامهٔ انتشار امن فاز دوم Admin — فقط Staging

> تکمیلی 2026-10-27: پس از این گزارش، مالک نصب Staging را مستقلاً مجاز کرد. وضعیت واقعی و پذیرش‌های هنوز باز در [گزارش استقرار Staging](../operations/admin-phase-2-staging-2026-10-27.md) ثبت است؛ متن زیر سابقهٔ آماده‌سازی قبل از مجوز را حفظ می‌کند.

**وضعیت: آماده‌سازی محلی؛ اجرای هیچ بند سروری مجاز نشده است.** این سند مجوز نصب، تغییر OWNER، Firewall، timer امنیتی یا شروع فاز سوم نیست. مرز قابلیت‌ها تابع ADR-085 و [ADR-087](../adr/087-admin-phase-two-release-boundary.md) است: محروم‌سازی/رفع محرومیت در تمام لایه‌ها بسته می‌ماند. PIN فعلی OWNER تغییر نمی‌کند.

## پیش‌شرط و شواهد نسخه

- تمام gateهای ریشه، تست‌های PostgreSQL/Redis و مرورگر، ingress واقعی، TTY خصوصی، dependency/Secret/container scan و Qualification نسخهٔ مشخص باید موفق باشند. نتیجهٔ ناقص، skipped یا دیتابیس Trivy قدیمی معادل موفقیت نیست؛ تاریخ اعتبار evidence هنگام نصب دوباره بررسی شود.
- snapshot تمام فایل‌های tracked/nonignored، SHA-256 سورس و lockfile، پارامترهای origin، نسخهٔ Node/pnpm، digest ایمیج‌ها، hash Migration/grants و گزارش‌ها کنار inventory غیرمحرمانه نگه‌داری شوند. dirty بودن سورس آشکار است؛ نام HEAD به‌تنهایی هویت این diff نیست. هر تغییر ورودی، بستهٔ قبلی را غیرنهایی می‌کند.
- مطابق ADR-089، runtime و Build جدید Node 24.22.1 هستند. مسیرهای قدیمی `node-v24.20.0` در unitهای renewal، سابقهٔ نصب‌اند؛ آن‌ها را بی‌بررسی کپی نکنید. در مجوز نصب بعدی، interpreter واقعی ابزارهای خصوصی نیز بررسی و فقط با همان مجوز ارتقا/Qualification شود؛ این آماده‌سازی، فایل یا timer نصب‌شدهٔ سرور را تغییر نمی‌دهد.
- ابزار موجود `infra/release/build.mjs` چهار ایمیج API/Bot/Worker/Web می‌سازد؛ Admin باید جدا با `infra/docker/admin/Dockerfile`، درخت production API حاصل از frozen deploy، client ساخته‌شده و runtime بررسی‌شدهٔ دارای digest بسته شود. فقط برچسب نسخه یا موفقیت `pnpm build` تأیید container نیست. source hash و digest Admin به همان inventory پیوست شوند.
- نقش `hambazi_admin_operations` با credential مستقل و pool/timeout محدود روی همان primary لازم است؛ runtime و reader نباید credential محصول را قرض بگیرند. mutation ابتدا خاموش است. grantهای `admin-phase2-permissions.sql` اجازهٔ UPDATE وضعیت/نسل نشست Users نمی‌دهند.
- پیش‌نیاز اتصال را جداگانه کنترل کنید: foundation دسترسی CONNECT از PUBLIC را سلب می‌کند. هنگام ایجاد نقش خصوصی جدید، اپراتور باید CONNECT را فقط روی دیتابیس مقصد و برای همان نقش، به‌ویژه `hambazi_admin_operations`، صریحاً اعطا کند؛ فایل‌های schema grants جای این مرحله نیستند. با اتصال واقعی TLS و نقش مستقل، `has_database_privilege(..., current_database(), 'CONNECT')` و سلامت هر pool بررسی شود؛ آماده‌بودن HTTP به‌تنهایی اتصال DB را اثبات نمی‌کند. این آماده‌سازی هیچ مجوز سروری اعمال نکرده است.
- نام مقصد در DSN خصوصی باید با SAN گواهی و resolver خصوصی همسان باشد. تحت Node جدید، صرف وجود IP در گواهی fixture برای رفتار همهٔ driverها کافی نبود؛ Qualification محلی از DNS خصوصی دقیق و CA معتبر استفاده می‌کند. روی مقصد واقعی، اتصال هر سه نقش با همان DSN/CA نهایی و `sslmode=verify-full` پیش از admission کنترل شود؛ کاهش TLS verification مجاز نیست.
- تطبیق Prisma فقط ۱۳ FK موجود Admin را در مدل تعریف می‌کند؛ SQL، triggerها و دادهٔ OWNER تغییر نمی‌کنند. Migrationهای افزایشی فاز دوم ثابت‌اند؛ خروجی غیرخالی drift یا پیشنهاد DROP FK، NO-GO است و نباید اجرا شود.
- آزمون restart باید نام دقیق تمام Migrationهای موفق مخزن را مقایسه کند، نه عدد تاریخی ۱۵. انتظارهای نشست/هویت نیز ستون metadata موجود `authVersion` را حفظ می‌کنند؛ این اصلاح آزمون، مجوز فعال‌سازی محروم‌سازی نیست.
- اسکن کامل Secret همچنان history reachable و candidate را پوشش می‌دهد. فقط سه مورد دقیق `docs/security/admin-phase2-secret-review.json` با تصمیم صریح مالک در ADR-088 و descriptor اجرایی همسان طبقه‌بندی می‌شوند؛ هر context جدید همچنان مسدود است. این پذیرش کنترل اسکن یا gateهای دیگر انتشار را حذف نمی‌کند.

## بکاپ قبل از نصب؛ فقط پس از اجازهٔ مستقل

۱. سلامت و نسخهٔ PostgreSQL، Redis، Nginx، API، Bot، Worker، Web و Admin، schema فعلی، نسخه/digest قبلی، منابع آزاد، وضعیت Audit و timer/deadline امنیتی را فقط با metadata ثبت کنید. پارامتر واقعی secret یا hash ورود وارد گزارش نشود.
۲. با ابزار خصوصی موجود، بکاپ کامل محصول و نقش‌های لازم و بکاپ هویت OWNER تهیه شود؛ هویت جدید شامل ۹ جدول نقش/عضویت/override و binding/نشست/Audit است. بکاپ شش‌جدولی قدیمی فقط برای سازگاری خواندن است و بکاپ تازه را جایگزین نمی‌کند. pepper/signing/command keys از مسیر امن مستقل و با دسترسی محدود نگه‌داری شوند؛ dump بدون کلیدهای لازم، بازیابی کامل نیست.
۳. عبارت رمزگذاری را فقط مالک در ترمینال خصوصیِ بدون ضبط و prompt مخفی وارد کند؛ نه چت، argv، history، env، فایل موقت plaintext یا لاگ. هیچ ابزار Bootstrap/Recovery اجرا و هیچ credential واقعی تغییر داده نشود.
۴. فایل رمزگذاری‌شده خارج سرور کپی، hash دو طرف تطبیق و همان نسخه واقعاً در PostgreSQL موقتِ ایزوله بازیابی شود. فایل هویت و دادهٔ بازی جداگانه آزموده شوند؛ receipt به شناسه/hash بکاپ، schema و نتیجه متصل باشد. قفل سه PIN و version/اعتبار نشست‌ها در کپی بررسی شود، نه با ورود اشتباه به OWNER واقعی. cleanup باید موفق باشد.
۵. پیش از تأیید restore و در دسترس بودن نسخهٔ قبلی، Maintenance آغاز نشود. RPO، پنجرهٔ قطعی و نگه‌داری بکاپ باید صریحاً برای نصب تعیین شوند؛ مقدار محصول را حدس نزنید.

## نصب دارای مجوز

۱. درخواست/اجرای mutation را ببندید، درخواست‌های درحال‌اجرا را drain و UNKNOWNها را با receipt ماژول محصول reconcile کنید؛ بازی فعال بدون دلیل terminate نشود.
۲. دو Migration افزایشی `202610270001_admin_management` و `202610270002_admin_product_operations` فقط با migrator اجرا شوند؛ اجرای دوباره باید no-op و schema قدیم برای release overlap قابل خواندن باشد. سپس grant دقیق runtime/reader/operations و عدم دسترسی به hashها، root binding و دادهٔ مخفی آزموده شود. down migration تخریبی وجود ندارد.
۳. پس از create/recreate، ابتدا API/Worker/Web را با readiness واقعی و سپس Bot را شروع کنید؛ Bot پیش از پذیرش backend نباید شروع شود. بازگشت `systemctl start` به معنی Running شدن کانتینر نیست؛ انتظار bounded فقط Running+healthy را قبول کند و حالت قبلی exited/created را با crash تازه اشتباه نگیرد. Auth/API/Gateway سازگار با نسل نشست را هماهنگ نصب و نسخهٔ ناسازگار را drain کنید؛ Admin، client و bundle خصوصی سازگار نصب شوند. roleها، سقف pool و اتصال primary کنترل شوند. ban/unban همچنان بسته است و schema نسل نشست به معنی اجازهٔ فعال‌سازی نیست.
۴. ingress فقط مسیرهای ثبت‌شدهٔ فاز دوم را به listener خصوصی Admin متصل کند؛ listener، PostgreSQL و Redis پورت عمومی نگیرند. پیش از هر reload، `nginx -t` و پس از آن health و HTTPS بررسی شوند. تنظیمات بازیکنان/Bot و تمدید گواهی حفظ شوند.
۵. ابتدا با mutation خاموش: Login/PENDING، CSRF، cookie، RBAC/scope، ابطال دسترسی زنده، Audit و نبود reset عمومی OWNER smoke شوند. داده/credential واقعی در output ثبت نشود. پس از Qualification معتبر و تأیید فعال‌سازی، فقط عملیات مجاز با دادهٔ آزمایشیِ متعلق به Staging تست شوند؛ OWNER واقعی عمداً قفل، reset یا تغییر داده نشود.
۶. تمام سرویس‌ها و deadline امنیتی دوباره بررسی شوند؛ موفقیت محلی یا تأیید نصب، مجوز تمدید مهلت/تعطیل‌کردن containment نیست. نتیجهٔ نهایی و مدت اختلال ثبت شود.

## توقف و Rollback

- شکست بکاپ/restore/scan/health/Audit/Qualification، NO-GO است؛ هیچ سرویس متوقف‌شده با override امنیتی فعال نشود.
- اگر قبل از اثر محصول شکست رخ داد، mutation بسته بماند و کد/ingress به digest و تنظیم قبلی بازگردد؛ قبل از reload، `nginx -t`. schema افزایشی حذف نمی‌شود و دادهٔ فعلی حفظ می‌شود.
- پس از اثر، ابتدا receipt/UNKNOWN و نسخهٔ جاری منبع مشخص شود؛ replay یک UUID اثر دوم ایجاد نکند. game admission فقط با فرمان جدید و expectedVersion فعلی قابل برگشت است. Room بسته یا Match خاتمه‌یافته با SQL معکوس یا restore روی دیتابیس زنده باز نمی‌شود.
- Auth قدیمی نباید نشست revoked یا نسل قدیمی را زنده کند. اگر سازگاری نسخهٔ قبلی اثبات نشده، maintenance امن و forward fix جای بازگشت ناامن است. restore کامل فقط برای حادثهٔ داده با مجوز مستقل، پس از توقف writerها و حفظ داده‌های تازه انجام می‌شود.

## برنامهٔ بار و پذیرش تداخل

**تصمیم صریح مالک، 2026-10-27، ADR-089:** اجرای Load/Stress و پذیرش ظرفیت به سرور آینده موکول شد. این بند برنامهٔ آن محیط آینده است؛ شرط تکمیل محلیِ candidate مخصوص Staging محسوب نمی‌شود. ظرفیت عملیاتی همچنان تأییدنشده است؛ این تعویق هیچ gate امنیتی، عملکردی یا Qualification را حذف نمی‌کند.

`pnpm test:capacity:smoke` فقط صحت harness محلی با workload کوچک را بررسی می‌کند؛ ادعای ظرفیت یا پذیرش peak نیست. برای آزمون کامل، مالک ابتدا peak CCU/Match/command rate، تعداد مدیر هم‌زمان، الگوی read/write و بودجهٔ latency/error/pool را تعیین می‌کند؛ مطابق معماری، ۲ برابر peak، reconnect storm و soak حداقل دو ساعت لازم‌اند.

در محیط موقت یا Staging دارای مجوز، همان workload بازی ابتدا بدون Admin و سپس با صفحه‌بندی کاربران/اتاق‌ها، refresh overview و فهرست مدیران اجرا شود؛ مرحلهٔ آخر mutation مجازِ دارای approval روی fixtureها را هم‌زمان با start/command/reconnect اجرا کند. rate limit و pool مستقل Admin از ابتدا روشن باشند و برای تولید بار دور زده نشوند. موارد ثبت: p50/p95/p99 بازی و Admin، خطاها، اتصال/انتظار pool، lock wait، queue/outbox lag، CPU/RAM و اثر revocation ≤۵ ثانیه. raw credential، payload بازی و hidden state ثبت نشوند.

آزمون overload، قطع Redis/Audit/DB و rollback باید نشان دهد دسترسی fail-closed، اثر تکراری صفر، Match فعال سالم و دادهٔ durable محفوظ است. معیار توقف، افت سلامت یا عبور از بودجهٔ مصوب است؛ بدون بودجه/peak مصوب، گزارش عددی قابل ارائه است اما نتیجهٔ «ظرفیت پذیرفته» صادر نمی‌شود.
