# برنامهٔ انتشار و بازگشت فاز سوم Admin — اجرا نشده

محدوده: آماده‌سازی محلی برای Staging؛ بدون تغییر سرور/Firewall، OWNER یا فاز چهارم. تنها بررسی سرور، inspect/export فقط‌خواندنی تصویر دقیق Redis بود؛ دیتابیس/OWNER خوانده نشد. [Qualification نهایی](../security/admin-phase3-final-qualification.json) و [artifactهای دقیق](../security/admin-phase3-remediated-artifacts.json) به commit تمیز `c7add7bf7b32e77b153abc6ebb411d4954e4a668` متصل‌اند. آماده‌سازی محلی موفق است؛ برنامهٔ زیر اجرا نشده و مجوز نصب نیست. مرجع قابلیت‌ها ADR-090 است؛ ADR-091 بدون تصویب یا استفاده، Withdrawn شد.

## بسته و تصمیم GO/NO-GO

- candidate به commit تمیز، lockfile، schema/Migration، toolchain، تنظیمات build و digestهای ثابت متصل شود. پروفایلِ ثبت‌شدهٔ فاز دوم برای Web برابر `https://staging.hambazi.top`، API برابر `https://api-staging.hambazi.top` و Admin برابر `https://admin.hambazi.top` است؛ پیش از نصب، drift واقعی مقصد جداگانه احراز شود. هیچ فرض DNS یا تغییر origin روی سرور اعمال نشده است.
- PostgreSQL و دادهٔ آن در انتشار Admin تعویض نمی‌شوند. baseline ثبت‌شدهٔ Staging در گزارش فاز دوم `hambazi-security/postgres-staging:20261026-libcurl@sha256:7debbad54e22776478b9009964cab7f0aedcfb58569bc06c19ebb2a043e9757b` است؛ `9ac84f…` ایمیج محلیِ آزمون/بازیابی است و نباید بی‌اجازه جای آن نصب شود. تطبیق live image پس از مجوز لازم است.
- pin مصوب 29.9.2 فقط محلی/CI است؛ سرور ارتقا نمی‌یابد. تصویر دقیق Redis retained برابر `hambazi-security/redis-staging:20261023-musl@sha256:a2b3313295aa496436419ae5a5a14508ab2058ba39f1d6b1bcd1dcfd50cff57c` است. پس از مجوز، live binding و image-load compatibility روی daemon موجود پیش از cutover احراز شود.
- مسیر عادی نیازمند CI کامل موفق است. ADR-091 پیشنهاد تاریخیِ پس‌گرفته‌شده است و مسیر انتشار نیست؛ کنترل‌های عادی لازم‌اند. هر شکست مستقل یا شواهد stale، NO-GO است.
- نصب با flag محرومیت خاموش پیشنهاد شده است. تنظیم فعلی mutations/operations DSN حفظ می‌شود؛ غیرفعال‌کردن کل management می‌تواند خواندن مدیران و reconciliation را هم متوقف کند و راهکار این طرح نیست. فعال‌سازی محرومیت تصمیم بعدیِ جداگانه است؛ entitlement کامل OWNER، Audit و محدودیت سه تلاش PIN تغییر نمی‌کنند.

## ۱ — پیش‌بررسی پس از مجوز استقرار

1. هویت Staging، فضا، ساعت، digest/config فعلی، schema و grantها، backlog صف و Matchهای فعال ثبت شود. health PostgreSQL، Redis، Nginx، API، Bot، Worker، Web و Admin و HTTPS/گواهی/timerها بررسی شوند؛ هیچ log، env یا payload محرمانه‌ای به گزارش صادر نشود.
2. scan تازه به تمام ایمیج‌های واقعاً نصب‌شونده **و سرویس‌های retained** متصل باشد. کنترل‌های containment و renewal فعلی از روی شواهد معتبر بررسی شوند؛ نصب جدید ممکن است rebinding بازبینی‌شده بخواهد. تمدید deadline یا فعال‌سازی اجباری سرویس مجاز نیست.
3. از مشخصات امن OWNER فقط baseline محدود تهیه شود: یک مالک، realm، status، credential/session/authorization version و وضعیت lock/failure؛ مقدار credential، verifier، کلید یا PIN خوانده/صادر نشود. پیش و پس از نصب metadata باید بدون تغییر ناخواسته بماند.
4. نسخهٔ فعلی binaryها، Compose/Nginx، تنظیمات و vault bindings برای بازگشت حفظ شوند؛ hash و permissionها ثبت شوند. فایل‌های حساس تنها در آرشیو رمزگذاری‌شده قرار بگیرند.

## ۲ — بکاپ واقعی و مراسم بازیابی

1. از روش full-backup مصوب با snapshot `REPEATABLE READ`، dump قالب custom، globals و CMS/AES-256-GCM استفاده شود. بکاپ محدود OWNER مکمل است؛ جای users، Matchها، رویدادها، outbox، restriction/receipt و Audit را نمی‌گیرد.
2. ابزار خصوصی فاز دوم به مسیر ثابت `/opt/hambazi/releases/admin-phase2-20261027` و archive قبلی مقید است. **آن نسخه را برای بکاپ تازه اجرا نکنید.** برای release جدید، مسیر خروجی/رسید یکتا و بدون overwrite، fingerprint گیرنده و hash فایل‌های ابزار بازبینی شوند. guard منبع PostgreSQL فعلاً به `7de…` مقید است و با baseline فاز دوم تطابق دارد؛ حذف این guard یا استفاده از حالت fixture برای دادهٔ واقعی ممنوع است. اگر live target متفاوت بود، متوقف و binding را جداگانه بررسی کنید.
3. inventory همهٔ DBهای غیر template با manifest بکاپ تطبیق داده شود. ابزار قبلی فقط `hambazi` و `postgres` را می‌پذیرد؛ DB اضافی نباید بی‌صدا حذف شود. نقش‌ها، ownership، grants و تنظیمات محدود نقش‌ها نیز ثبت شوند.
4. گیرندهٔ رمزگذاری و مالکیت private key توسط خود مالک تأیید شود؛ کلید فقط خارج سرور و در vault/محل خصوصی بماند. عبارت رمز یا unlock کلید فقط توسط مالک در ترمینال خصوصی، بدون ضبط/اشتراک، history، argv، env یا فایل موقت plaintext وارد شود. Codex رمز، PIN، Passphrase یا private key واقعی دریافت نمی‌کند. آماده‌سازی مسیر تعاملیِ نسخهٔ جدید ابزار، gate مراسم واقعی است و اکنون اجرا نشده است.
5. برای snapshot نهاییِ سازگار، ورودی نوشتن Admin و نویسندگان بازی/صف طبق runbook maintenance موقتاً quiesce شوند؛ داده و volume حذف نشوند. snapshot هر DB مستقل است و ادعای snapshot اتمیک کل cluster نداریم؛ در بازهٔ نهایی، تغییر role/config و نوشتن بین DBها متوقف باشد. اگر نویسنده‌ای قابل مهار نیست، cutover انجام نشود.
6. کلیدهای signing، PIN pepper، `ADMIN_COMMAND_KEY` و realm، checkpoint/سیاست OWNER، envهای خصوصی و TLS در vault و/یا capsule تنظیماتِ رمزگذاری‌شده و با binding معتبر نگهداری شوند. dump دیتابیس بدون command key بازیابی توضیحات محرمانه را کامل نمی‌کند. هیچ کلیدی rotate یا Owner recovery/bootstrap اجرا نشود.
7. archive تازه با permission محدود خارج سرور کپی و SHA-256 دو طرف و گیرنده تطبیق داده شود. سپس همان فایل توسط مالک unlock و ابتدا AEAD تأیید شود. بازیابی روی PostgreSQL موقت `network=none`، بدون published port، بدون mount volume/directory واقعی، با نقش غیر root و پاک‌سازی پس از اتمام انجام شود.
8. rows/digests تمام جدول‌ها، constraints، triggers، grants، owner/role/database settings و `pg_amcheck` مقایسه شوند؛ تغییر بیت archive باید پیش از restore رد شود. تنظیمات/کلیدهای مصنوعی در rehearsal بررسی شوند؛ برای نسخهٔ واقعی، capsule تنظیمات و vault binding نیز جدا از restore دیتابیس احراز شوند. خروجی فقط شناسهٔ archive، هش، زمان، تعداد جدول‌ها و نتیجهٔ کنترل‌ها باشد.
9. رسید باید به **همین archive تازه**، image، نسخهٔ ابزار، snapshot/config bindings و hash کپی خارج سرور متصل باشد. رسید قبلی یا گفتن «بازیابی موفق بود» بدون receipt منطبق کافی نیست. نسخهٔ ابزار قبل از Migration باید با schema فعلی سازگار باشد؛ ابزار v3 پس از افزودن ستون‌ها نصب/آزموده شود. در شکست، Maintenance پایان نمی‌یابد و نصب آغاز نمی‌شود.

بکاپ رمزگذاری‌شده و کلید مستقل حداقل تا پایان بازهٔ بازگشتِ تأییدشده نگه‌داری شوند؛ حذف خودکار یا تعیین سیاست عمومی retention/PITR در این کار انجام نمی‌شود. RPO پس از snapshot و RTO سرور از آزمون محلی نتیجه‌گیری نمی‌شوند؛ بازگشت داده پس از ازسرگیری نوشتن، ارزیابی جداگانه می‌خواهد.

## ۳ — نصب کنترل‌شده، فقط با مجوز بعدی

- migrationهای additive `202610280001_admin_private_notes` و `202610280002_user_restrictions` با migrator و سپس grantهای موجود فاز سوم اعمال شوند. drift صفر، replay/redeploy و عدم تغییر metadata مالک بررسی شوند؛ grant گسترده، down migration و تغییر credential ممنوع‌اند.
- API/Worker/Admin سازگار از digestهای تأییدشده نصب شوند. تعویض Web/Bot فقط اگر بستهٔ مصوب نیاز دارد؛ در غیر این صورت retained imageها نیز باید scan و سازگاری معتبر داشته باشند. PostgreSQL/Redis و volumeهای موجود حفظ شوند.
- allowlist محدود مسیرهای جدید Nginx با فایل موجود مقایسه شود؛ پیش از هر reload، `nginx -t` لازم است. backend مستقیم، Firewall و دامنه‌های جدید منتشر نشوند.
- health و HTTPS همهٔ سرویس‌ها پیش و پس از cutover بررسی شوند. 401 برای ناشناس/PENDING، 403 نقش فاقد مجوز، CSRF و cookie/no-store، allowlist، Audit و نشست‌های مدیر آزمایشی بررسی شوند. QA مدیر موقت باید 403 در نشست authenticated دارای users.view، receipt/Audit اجرای ADMIN_REVOKE_SESSIONS، رد نشست قبلی و وضعیت DISABLED را اثبات کند؛ تست محلی وضعیت زندهٔ آن حساب را تأیید نمی‌کند. ورود صحیح OWNER فقط توسط مالک و بدون تغییر credential یا PIN اشتباه، با مجوز همان QA بعدی انجام شود.
- تا مجوز مستقل فعال‌سازی، محرومیت جدید خاموش می‌ماند؛ تنظیمات و مجوزهای قبلی فاز دوم گسترده نمی‌شوند و reconciliation حفظ می‌شود. آزمون write/ban/revoke/expiry در fixture ایزوله انجام می‌شود؛ تست زندهٔ نوشتن یا فعال‌سازی flag مجوز جداگانه می‌خواهد. قبل از بازکردن Maintenance، گزارش امنیت و containment معتبر لازم است.

## ۴ — بازگشت و توقف

| رخداد                                            | اقدام ایمن                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| شکست scan، freshness، بکاپ یا restore قبل از نصب | NO-GO؛ هیچ migration/deploy یا تمدید کنترل انجام نشود.                                                                                                                          |
| شکست migration/grant                             | نوشتن بسته بماند؛ وضعیت migration بررسی شود. schema/داده پاک یا پایین برده نشود؛ binary سازگار با schema موجود حفظ شود.                                                         |
| خرابی Admin/Nginx پس از cutover                  | مسیر mutation بسته و پیکربندی قبلیِ معتبر با `nginx -t` برگردد؛ خدمات سالم بازی بی‌دلیل restart نشوند.                                                                          |
| هنوز هیچ اثر محرومیت فاز سوم ثبت نشده            | binary قبلی فقط پس از بررسی سازگاری schema/grant/job و شواهد امنیتی قابل انتخاب است؛ تغییر داده یا Audit لازم نیست.                                                             |
| اثر محرومیت فاز سوم ثبت شده است                  | flag نوشتن تازه خاموش؛ API/Worker سازگار فاز سوم با enforcement، expiry و reconciliation حفظ/بازگردانده شوند. rollback به فاز دوم فاقد این مسیر ممنوع است.                      |
| حادثهٔ صحت داده یا نقش/view                      | containment و توقف عملیات؛ حفظ شواهد و داده‌های جدید. restore کامل فقط با ارزیابی داده‌های پس از بکاپ، Maintenance و مجوز صریح؛ هیچ `down -v` یا overwrite مستقیم DB مجاز نیست. |
| از اعتبار خارج‌شدن شواهد انتشار                  | نصب متوقف و اعتبار کنترل‌های عادی دوباره احراز شود؛ در صورت نصب، containment/بازگشت سازگار اجرا شود، بدون auto-renew یا شروع اجباری سرویس.                                      |

fallback از همان candidate سازگار با flag=false در fixture آزموده می‌شود؛ این اثبات جای سلامت مقصد و بکاپ واقعی تازه نیست. آزمون ظرفیت/Stress/Soak برای سرور آینده می‌ماند؛ Production و فاز چهارم همچنان HOLD هستند.
