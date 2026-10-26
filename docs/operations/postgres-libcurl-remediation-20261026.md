# بررسی فوری و بستهٔ اصلاح libcurl در PostgreSQL — ۲۶ اکتبر ۲۰۲۶

> این سند سابقهٔ بررسی و آماده‌سازی پیش از مجوز نصب است. اصلاح بعداً فقط روی Staging مستقر و Qualification واقعی تکمیل شد؛ [گزارش اجرا و وضعیت نهایی](postgres-libcurl-deployment-20261026.md) مرجع نسخهٔ فعال، بکاپ، سلامت و مهلت جدید است. عبارت‌های «نصب نشده» و «مجاز نشده» در ادامه مربوط به زمان آماده‌سازی‌اند.

## نتیجه و حدود اجرا

یافتهٔ بسته‌ای `CVE-2026-92392` تأیید و اصلاح حداقلی **فقط روی Docker محلی** ساخته، اسکن و آزمایش شد. هیچ image، فایل، Firewall، گواهی، دیتابیس، حساب، control/state یا timer روی Staging/Production توسط این بررسی تغییر نکرد. درخواست‌های SSH، inventory، SELECTهای read-only، healthcheck و export خواندنی image موجود انجام شدند. export image شامل volume یا دادهٔ دیتابیس نیست.

نسخهٔ اصلاح‌شده هنوز روی سرور نصب نشده است. دسترسی عمومی Admin، ساخت OWNER و فاز دو بسته‌اند. بکاپ واقعی سرور نیز در این نوبت گرفته نشد؛ اجرای تغییر به تأیید جداگانهٔ مالک وابسته است.

## منشأ و بررسی مثبت کاذب

| مورد                    | یافته                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| CVE                     | `CVE-2026-92392`، HIGH، CWE-416                                                                                             |
| منشأ                    | کتابخانهٔ curl/libcurl در image PostgreSQL؛ خطای use-after-free هنگام upload روی HTTP/2 و دریافت reset از server طرف مقابل  |
| دامنهٔ upstream         | مسیر اصلی نسخه‌های 8.12.0 تا 8.22.0؛ اصلاح در 8.23.0، با استثنای شاخه‌های backport ذکرشده در advisory                       |
| بستهٔ نصب‌شده           | Alpine 3.24.2، `libcurl 8.22.0-r0`، فایل `/usr/lib/libcurl.so.4.8.0` و SONAME `libcurl.so.4`                                |
| اصلاح vendor همین توزیع | `libcurl 8.23.0-r0` از Alpine v3.24/main/x86_64                                                                             |
| source اسکن             | Alpine SecDB؛ نه مقایسهٔ نام بسته با نسخهٔ Ubuntu/Debian                                                                    |
| image فعال              | `hambazi-security/postgres-staging:20261024-brotli@sha256:646e47d029792855c984a6c1123a97843ee7456e0df5579683b99cba111641aa` |

[advisory رسمی curl](https://curl.se/docs/CVE-2026-92392.html) منشأ و نسخه‌های فوق را تأیید می‌کند. [Alpine SecDB همین شاخه](https://secdb.alpinelinux.org/v3.24/main.json) نیز CVE را زیر اصلاح `8.23.0-r0` بستهٔ `curl` ثبت کرده است. JSON مرجع، URL و hash آن در evidence محلی ذخیره شد. تبدیل این خطا به اجرای کد به شرایط مشخص سمت کلاینت و server خرابکار نیاز دارد؛ این گزارش ادعای exploit روی HamBazi ندارد.

inventory واقعی `apk info -a` حضور فایل/نسخه و وابستگی HTTP/2 را تأیید کرد. بسته از virtual dependency اصلی `.postgresql-rundeps-20260917.212948` آمده و configure اصلی PostgreSQL دارای `--with-libcurl` است. خود executable اصلی `postgres` و `libpq.so.5` در خروجی ldd مستقیماً curl ندارند، اما **`libpq-oauth-18.so` واقعاً به آن لینک است**؛ صرف نبود curl در ldd اصلی، دلیل false positive نیست. شواهدی از backport اصلاح روی همین `8.22.0-r0` پیدا نشد؛ حذف/استثناکردن finding موجه نیست. فیلد `Status: fixed` در اسکن یعنی patch موجود است، نه اینکه نسخهٔ نصب‌شده اصلاح شده باشد.

در تنظیم فعلی، ruleهای host از SCRAM استفاده می‌کنند، `oauth_validator_libraries` خالی و شبکهٔ PostgreSQL internal است. این‌ها مسیر مواجههٔ فعلی را محدود می‌کنند؛ وجود کتابخانهٔ آسیب‌دیده یا الزام gate را منتفی نمی‌کنند. هیچ VEX، ignore، downgrade severity، غیرفعال‌سازی HTTP/2 یا دستکاری package metadata برای عبور اسکن استفاده نشد.

## اصلاح حداقلی آماده

[Dockerfile](../../infra/docker/server/PostgresLibcurl.Dockerfile) فقط روی **image ID دقیق فعلی** یک APK اضافه می‌کند. دانلود در build انجام نمی‌شود: hash ورودی کنترل، سپس `apk add --no-network --no-logfile` با trusted keys خود Alpine امضا را اعتبارسنجی می‌کند؛ `allow-untrusted` وجود ندارد. Docker classic برای والد محلی با image ID به کار رفت؛ artifact نهایی برای انتقال آماده است و نصب آینده به build یا registry عمومی روی VPS وابسته نیست.

- ورودی: [APK رسمی libcurl 8.23.0-r0](https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/libcurl-8.23.0-r0.apk).
- SHA-256 ورودی: `1f70ca404818805a6465b615bbfe84ef861488a963d7e630108ebd7fbaa51665`.
- image خروجی: `sha256:7debbad54e22776478b9009964cab7f0aedcfb58569bc06c19ebb2a043e9757b`.
- reference نصبِ آزمایش‌شدهٔ محلی: `hambazi-security/postgres-staging:20261026-libcurl@sha256:7debbad54e22776478b9009964cab7f0aedcfb58569bc06c19ebb2a043e9757b`.
- archive محلی: `/home/mehdi/.cache/hambazi-libcurl-20261026/postgres-libcurl-image.tar.gz`، حدود ۱۲۱ MB، SHA-256 برابر `3d5ce18f809fc0cf664af905794aa9579740438d367e8d96e813cc810bb92c02`؛ هنوز به سرور ارسال نشده است.

مقایسهٔ inventory کل بسته‌ها فقط تغییر `libcurl 8.22.0-r0 → 8.23.0-r0` را نشان داد. SONAME ثابت `libcurl.so.4=4.8.0` است؛ PostgreSQL همچنان دقیقاً `18.6` است. hashهای `postgres/initdb/pg_dump/pg_restore/psql`، `libpq`، ماژول OAuth و دو کتابخانهٔ ICU برابرند. entrypoint، command، env، user، volume declaration، signal و دیگر تنظیم‌های runtime image ثابت و لایه‌های والد حفظ‌اند. نه upgrade موتور/major، نه تغییر libc/collation و نه Migration لازم است.

[manifest مستقل candidate](../../infra/docker/server/postgres-libcurl-candidate.json) ورودی‌ها، image، archive، hash شواهد و وضعیت **prepared-not-deployed** را ثبت می‌کند. Compose و deployment manifest فعال مخزن به نسخهٔ candidate تغییر داده نشدند. manifest اولیهٔ نصب Admin نیز همچنان تاریخچهٔ درستِ image فعال سرور را نشان می‌دهد.

## تست‌ها و شواهد

| بررسی                                | نتیجه                                                                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| اسکن مستقل image قدیمی               | با feed تازه، همان یک HIGH، دو MEDIUM و ۲۲ LOW بازتولید شد                                                                                                              |
| اسکن image جدید و reference دقیق نصب | صفر HIGH/CRITICAL/UNKNOWN و فقط یک MEDIUM؛ بدون ignore جدید                                                                                                             |
| ابزار و feed                         | Trivy pinned با SHA تأییدشده؛ دریافت تازه از repository رسمی، `UpdatedAt=2026-10-26T07:15:18.945937093Z` و `DownloadedAt=2026-10-26T12:01:35.3602983Z`                  |
| secret scan ورودی اصلاح              | Gitleaks pinned، صفر finding، بدون استثنای جدید                                                                                                                         |
| Foundation دیتابیس                   | ۱۷ تست واقعی fixture موفق؛ API/Worker grants، داده و رفتار تراکنش/قیود                                                                                                  |
| تعویض فیزیکی image                   | دیتابیس fixture با parent ساخته شد؛ هر ۱۷ migration و تست‌ها اجرا شدند؛ پس از stop پاک، candidate همان volume آزمایشی را باز کرد و snapshot برابر ماند                  |
| restore                              | dump custom fixture در RAM رمزگذاری/باز و در volume تازه با candidate تراکنشی restore شد؛ ۳۷ جدول، داده‌های JSONB/Unicode، constraintها، triggerها و grants برابر بودند |
| integrity و rollback                 | pg_amcheck روی candidate متصل به volume قبلی و candidate بازیابی‌شده موفق؛ برگشت همان volume به image قبلی موفق و snapshot برابر                                        |
| replay Migration                     | اجرای دوبارهٔ migrate روی fixture candidate چیزی را تغییر نداد؛ Migration جدیدی ساخته نشد                                                                               |
| Integration Admin با candidate       | ۱۲ تست اصلی و چهار rehearsal موفق؛ lock پایدار، race، Audit rollback، تغییر credential، recovery و revoke در fixture جدا                                                |
| Infra                                | ۲۱ فایل، ۱۹۲ موفق، دو skip قبلی؛ رد HIGH/CRITICAL و expiry policy موجود حفظ شد                                                                                          |
| policy با گزارش‌های واقعی            | `normal_expiry` موجود با شش image فعلی finding را رد کرد؛ جایگزینی فقط گزارش اسکن واقعی candidate و pin آن، بدون تغییر policy، پذیرفته شد؛ این ارزیابی فقط محلی بود     |

تمام test allocationها Docker را به Unix socket رایانهٔ محلی مقید کردند؛ container/network/volumeهای خود آزمون پاک شدند. URL دیتابیس سرور، دادهٔ انسانی و credential سرور به fixtureها داده نشد. accountهای synthetic آزمون، OWNER واقعی Staging نیستند.

دو مسئلهٔ harness قبل از تکمیل rehearsal برطرف شدند: internal bridge در Docker محلی port لازم برای client تست میزبان را ارائه نمی‌کرد؛ fixture به bridge اختصاصی با publish صرفاً loopback منتقل شد. در مقایسهٔ اولیهٔ restore نیز تنها تفاوت، پرانتزگذاری معادل یک CHECK بود؛ از `pg_get_constraintdef(oid,true)` مطابق helper انتقال موجود مخزن استفاده شد و تمام قیود همچنان مقایسه می‌شوند. هیچ assertion یا کنترل داده برای سبزشدن حذف نشد. ساخت نخست با BuildKit والد `sha256:` محلی را نام registry تفسیر کرد؛ ساخت دقیق offline با classic builder موفق شد، بدون عوض‌کردن والد.

این تست‌ها آمادگی candidate را اثبات می‌کنند، نه restore واقعی آخرین دیتای Staging. CI راه‌دور، load/soak و exploit مخرب روی سرور اجرا نشدند؛ source برنامه‌ها و نسخهٔ موتور تغییر نکردند.

## وضعیت خواندنی Staging و توقف خودکار

healthcheckهای زندهٔ API/Bot/Worker/Web/Admin و PostgreSQL موفق بودند. دیتابیس `18.6`، encoding برابر UTF8 و provider/locale برابر `builtin/C.UTF-8` است؛ ۱۷ Migration موفق، صفر Match فعال، صفر OWNER و صفر lock منتظر مشاهده شد. فقط extension محصول `plpgsql` نصب است. این وضعیت باید در پنجرهٔ اجرایی مجدداً خوانده شود؛ صفر فعلی مجوز نادیده‌گرفتن Match جدید نیست.

Core و Admin expiry timer فعال و هر دو برای **`2026-10-26T19:10:35Z`، ساعت ۲۲:۴۰:۳۵ تهران** تنظیم‌اند. علت failure renewal، HIGH واقعی image PostgreSQL است، نه صرفاً خطای ارتباط دانلود. hashهای control/state اصلی و هر دو فایل expiry timer قبل/بعد بررسی برابر ماندند. timerهای موجود ممکن است خودشان تلاش‌های زمان‌بندی‌شدهٔ renewal را ثبت کنند؛ این بررسی هیچ `--renew`، `--contain`، restart یا تغییر timer اجرا نکرد.

ارزیابی محلی همان policy و feed معتبر، پس از جایگزینی فقط candidate، deadline نظری `2026-10-27T07:15:18Z` را به دست داد؛ **این مقدار روی سرور نوشته یا اعمال نشد**. مهلت واقعی سرور همچنان همان امشب است. تا نصب مجاز، scan واقعی مجموعه و qualification موفق، نباید state/timestamp، severity یا timer را تغییر داد. اگر مهلت برسد، containment موجود باید طبق طراحی اجرا شود؛ توقف خودکار حذف یا عقب انداخته نشود.

## ریسک، بکاپ و برنامهٔ اجرا — هنوز مجاز نشده

ریسک اصلی، قطع کوتاه اتصال‌های PostgreSQL و سرویس‌های وابسته هنگام تعویض container است. ریسک تغییر format/locale پایین است: موتور، ICU، libc، data layout و policy marker ثابت‌اند و تعویض/rollback همان volume آزمایش شده است. با این حال بدون بکاپ واقعی و restore تأییدشده نباید تغییر اجرا شود. دادهٔ غیرمنتظره، Match فعال، shutdown ناپاک، شکست restore یا scan، یا زمان ناکافی تا expiry، شرط توقف‌اند.

پس از **تأیید جداگانهٔ مالک**، ترتیب اجرایی پیشنهادی:

1. وضعیت زمان/فضای دیسک، سلامت، image IDها، role/grantها، ۱۷ Migration، تعداد Match فعال و مهلت security دوباره ثبت شوند. اگر کمتر از ۱۵ دقیقه تا پایان evidence باقی است یا containment شروع شده، از مسیر عادی نصب ادامه داده نشود؛ بازگشایی به qualification جدا نیاز دارد، نه دستکاری ساعت.
2. artifact hash روی دو طرف و image ID پس از load تأیید شوند؛ scan تازهٔ همان image روی مقصد پیش از جایگزینی اجباری است. load/scanning نیز تغییر سرور محسوب می‌شوند و در این نوبت انجام نشدند.
3. با maintenance موجود ورودی‌ها بسته و نویسندگان با مهلت shutdown موجود drain/متوقف شوند؛ Admin نیز بسته بماند. صفر بودن Match فعال و نبود write حساس پیش از تغییر DB دوباره تأیید شود. در صورت Match فعال عملیات متوقف شود؛ state یا نتیجهٔ بازی برای ادامهٔ نصب تغییر نکند. Redis، شبکه، Firewall و imageهای برنامه‌ها تعویض نشوند.
4. بکاپ **کامل دیتابیس محصول** با `pg_dump -Fc` و globals لازم با `pg_dumpall --globals-only` تهیه شود؛ backup شش جدول Admin برای این تغییر کافی نیست. role/configهای لازم برای بازگشت نیز محفوظ باشند. خروجی حساس همزمان رمزگذاری، بدون dump/credential خام در خروجی Codex یا log نگه‌داری و کلید مستقل خارج VPS حفظ شود. مالک ورودی محرمانهٔ رمزگذاری را در ترمینال شخصی بدهد؛ آن را در چت، argv یا history نفرستد.
5. archive واقعی، hash، decrypt و restore موفق در PostgreSQL موقتِ جدا و بدون اتصال به سرویس‌ها بررسی شوند؛ schema، شمار/هش ردیف‌ها، قیود، triggerها، grants و metadata لازم تطبیق داده شوند. حداقل یک کپی رمزگذاری‌شده خارج VPS لازم است. receipt fixture محلی جای این تأیید نیست. backup retention/PITR/RPO عمومی پروژه در این اصلاح تعیین نمی‌شود.
6. PostgreSQL با shutdown پاک متوقف و فقط container آن با candidate دقیق، **همان volume، IP، mounts، credentialها، command و تنظیم‌های فعلی** بازساخته شود؛ startup policy marker، TLS/SCRAM، نسخه، شمار Migration و داده و privilegeها دوباره بررسی شوند. initdb، ایجاد volume جایگزین روی مسیر محصول، restore روی DB زنده، پاک‌کردن داده یا SQL migration مجاز نیستند.
7. bindingهای مربوط به image/container و فایل‌های دقیق deployment در کنترل موجود، فقط مطابق delta بازبینی‌شده به واقعیت جدید متصل شوند. پنج image دیگر و policy/severity/deadline formula ثابت بمانند. health خصوصی همهٔ appها و scan واقعی شش image qualify شوند؛ روال عادی renewal با feed معتبر اجرا شود. هیچ deadline دلخواه یا receipt دستی جای evidence واقعی ننشیند. Admin به سقف جدید معتبر Core وابسته می‌ماند؛ این مجوز، public admission نیست.
8. Nginx پیش از هر reload با `nginx -t` اعتبارسنجی شود. فقط بعد از qualification و صحت داده، maintenance بازیکنان کنترل‌شده برداشته و سلامت HTTPS/Backend/Worker/Bot/Admin دوباره بررسی شود. imageهای برنامه‌ها همان نسخهٔ فعلی باشند؛ Admin فقط SSH-only بازگردد. rollback و backup تا تأیید نهایی حفظ شوند.

### بازگشت

image قبلی، descriptorهای private، کنترل قبل از تغییر و backup آزموده‌شده نگه‌داری شوند. چون binary و format موتور ثابت‌اند، در خطای startup ابتدا candidate متوقف و همان volume با image قبلی در maintenance بررسی می‌شود؛ این مسیر روی fixture موفق بود. بازگشت به image آسیب‌پذیر، مجوز بازگشایی سرویس‌ها با scan نامعتبر نیست: maintenance و containment policy حفظ شوند. هیچ restore/down migration خودکار روی DB مشترک انجام نشود. اگر یکپارچگی داده نامطمئن شد، volume اصلی حفظ، archive در volume جدا restore و فقط با تصمیم مستقل پس از reconciliation جایگزین شود.

## مجوز دقیق مرحلهٔ بعد

اجرای این بسته فقط روی **Staging** با مجوز «انتقال و load candidate، scan مقصد، maintenance سرویس‌های وابسته، بکاپ کامل رمزگذاری‌شده و آزمون restore واقعی، تعویض container PostgreSQL، به‌روزرسانی bindingهای واقعی و qualification/renewal معمول با شواهد معتبر، و بازگشت کنترل‌شدهٔ سرویس‌ها» پیشنهاد می‌شود. این مجوز هنوز داده نشده است. Production، تغییر Firewall/سیاست امنیت، ساخت OWNER، بازکردن اینترنت Admin و فاز دو در آن قرار ندارند.

شواهد محلی در `/home/mehdi/.cache/hambazi-libcurl-20261026/`، شامل advisory vendor، دو scan قدیم/جدید، scan reference نهایی، package/binary inventory، rehearsal دیتابیس، ارزیابی محلی renewal، secret scan، archive انتقال و بررسی نهایی خواندنی سرور هستند. هیچ فایل اصلاحی روی سرور ساخته نشده است.
