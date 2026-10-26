# نصب خصوصی فاز یک و ابزار OWNER در Staging — ۲۶ اکتبر ۲۰۲۶

> به‌روزرسانی پس از نصب اولیه: مانع HIGH مربوط به libcurl با [اصلاح تأییدشدهٔ PostgreSQL](../operations/postgres-libcurl-deployment-20261026.md) برطرف شد؛ Core/Admin در `2026-10-26T14:07:45Z` سالم و دارای Qualification معتبر با مهلت `2026-10-27T07:15:18Z` هستند. بکاپ کامل رمزگذاری‌شده و restore واقعی برای این اصلاح انجام شد؛ این بکاپ جای receipt اختصاصی Bootstrap مالک نیست. OWNER، انتشار عمومی Admin و فاز دو همچنان اجرا نشده‌اند. اطلاعات و موانع پایین، سابقهٔ زمان نصب اولیه‌اند.

## نتیجه و حدود مجوز

با مجوز صریح مالک، نسخهٔ آمادهٔ فاز یک فقط روی Staging نصب شد. ورود همچنان از تونل SSH به Nginx روی `127.0.0.1:9443` و سپس Backend خصوصی `10.89.18.14:9444` است. TLS عمومی Admin رد می‌شود؛ Backend published port ندارد. پیکربندی Nginx بازیکنان/Admin، Firewall و credentialهای موجود تغییر داده نشدند. `nginx -t` پیش از admission و پس از نصب موفق بود؛ reload لازم نشد.

**هیچ OWNER، مدیر، credential انسانی، نشست کامل یا PENDING ایجاد نشد. بکاپ واقعی، Bootstrap، Recovery، انتشار عمومی و فاز دو اجرا نشدند.** دایرکتوری بکاپ خالی است؛ checkpoint و receipt بکاپ ساخته نشدند. نبود receipt معتبر همچنان ابزار ساخت حساب را متوقف می‌کند.

## نسخهٔ نصب‌شده

- Operator bundle: `ecbbd10d235051d7f631d544db24bc3ffc347e7d50587ed4ac76f8b6a9bb3fb6`؛ SHA-256 فهرست canonical فایل‌ها و symlinkها، همان نسخهٔ بازبینی‌شدهٔ قبلی. تمام ۲۲٬۳۱۸ مدخل، hash محتوا و محصوربودن symlinkها پیش از ساخت دوباره بررسی شدند.
- Image واقعی: `sha256:a10b8c3f9f73fb627508eb8535af3f7d15d6c91523ea1bcb1799ad6697a33814`.
- Container جدید: `45938927789d0638e27966540cbb64401ea36d535f88cfc8a441b5d2aefbd421`، healthy، restart صفر؛ UID `1000:1000`، read-only، cap-drop ALL، no-new-privileges و محدودیت‌های قبلی حافظه/CPU/PID حفظ شدند.
- image پایه همان runtime تأییدشدهٔ موجود است؛ کل درخت برنامه جایگزین شد. scan واقعی image با binary pinned و advisory دارای `UpdatedAt=2026-10-26T07:15:18.945937093Z` انجام شد: یک MEDIUM و صفر HIGH/CRITICAL/UNKNOWN. اسکن source جای اسکن image استفاده نشد.
- ابزار root-private در `/opt/hambazi/admin/operator/` و policy با mode 0600 در `/opt/hambazi/admin/private/staging-owner-policy.json` نصب شدند؛ policy همان hash نسخه، realm/environment دقیق Staging و CA/IP خصوصی بررسی‌شده را pin می‌کند.
- Node `24.20.0` مطابق toolchain پروژه از [توزیع رسمی و checksum همان نسخه](https://nodejs.org/dist/v24.20.0/SHASUMS256.txt) نصب شد؛ SHA-256 آرشیو `2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2` تأیید شد. PostgreSQL client `18.6`، client-common و libpq از repository امضاشدهٔ [PGDG برای Ubuntu](https://www.postgresql.org/download/linux/ubuntu/) نصب شدند؛ صفر بستهٔ موجود ارتقا یافت و PostgreSQL server/daemon میزبان نصب نشد. هیچ سرویس موجودی برای نصب client restart نشد.

## داده، مجوز و احراز هویت

Prisma واقعی فقط migration افزایشی `202610260001_admin_password_rotation` را اعمال کرد؛ شمار موفق‌ها از ۱۶ به ۱۷ رسید. این migration فقط event مجاز `PASSWORD_CHANGED` را به constraint لاگ Admin اضافه می‌کند. داده و schema بازی تغییر نکردند. dump واقعی جدید در این نوبت گرفته نشد؛ backup قبلی انتشار نخست جای receipt آزموده‌شدهٔ هویت محسوب نشده است.

grants بازبینی‌شدهٔ Admin و فایل جداگانهٔ Staging اعمال شدند. بررسی metadata واقعی تأیید کرد:

- runtime اجازهٔ UPDATE ستون Password را برای تغییر احرازشده دارد؛ تغییر owner binding و DELETE لاگ Audit همچنان ممنوع‌اند.
- recovery فقط SELECT دو جدول session/grant را علاوه بر اختیار قبلی گرفته؛ UPDATE ستون Password برای آن ممنوع است. HBA، roleهای بازی و Redis ACL تغییر نکردند.
- قید event جدید و triggerهای حفاظت Owner/Audit فعال‌اند؛ OWNER، operator و session در پایان صفرند.

OWNER هیچ Forgot/Reset Password ندارد. مسیرهای عمومی forgot/reset/recover/bootstrap/signup با پاسخ 404 وجود ندارند. تغییر Password/PIN از پنل به FULL session، Password/PIN فعلی، CSRF و commandId نیاز دارد و با افزایش epoch/version، تمام نشست‌های FULL/PENDING قبلی، شامل نشست جاری، باطل می‌شوند. Recovery تنها entrypoint خصوصی SSH/root/TTY و Password فعلی همان مالک را می‌پذیرد؛ فقط PIN/lock/epoch را عوض می‌کند. خود ابزار مراسم در این نصب اجرا نشد.

## سلامت و تست‌ها

| بررسی                                    | نتیجه                                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| سلامت زندهٔ API، Bot، Worker، Web، Admin | قبل و بعد موفق؛ healthcheckها PostgreSQL/Redis را با اتصال واقعی می‌آزمایند؛ Redis healthcheck مستقل Docker ندارد                            |
| سرویس‌های بازیکنان و داده                | container/image/start time و restartها ثابت؛ Bot همان دو restart قبلی، دیگران صفر؛ PostgreSQL accepting connections                          |
| HTTPS بازیکنان                           | Web برابر 200؛ rootهای API و Bot برابر 404 مورد انتظار، همراه موفقیت healthcheckهای خود سرویس                                                |
| HTTPS و مرورگر واقعی Admin               | تونل خصوصی، certificate verification فعال، 200، فارسی/RTL، موبایل و دسکتاپ؛ صفر خطای JS/CSP و axe؛ هیچ credential وارد نشد؛ تونل تست بسته شد |
| مرز اینترنت                              | TLS عمومی Admin رد؛ اتصال مستقیم 9443/9444 از خارج بسته/filtered؛ port عمومی کانتینر وجود ندارد                                              |
| HTTP امنیتی واقعی                        | پنج مسیر محافظت‌شده بدون نشست، 401 و بدون cookie؛ پنج مسیر غیرموجود ثبت‌نام/بازیابی/راه‌اندازی، 404؛ Origin بیگانه، 403                      |
| API unit/security تازه                   | ۶۱ فایل، ۱۰۴۹ موفق                                                                                                                           |
| PostgreSQL/Redis یک‌بارمصرف محلی         | ۱۲ integration اصلی و چهار rehearsal جدید موفق؛ قفل پایدار سه PIN، race، Audit rollback، recovery با Password و ابطال نشست‌ها                |
| فایل/ترمینال خصوصی محلی                  | root filesystem guards و PTY واقعی موفق؛ echo/cancel، permission، lock و evidence gate                                                       |
| مرورگر محلی                              | شش موفق؛ تغییر Password/PIN، پاک‌شدن فرم، بازگشت login، revoke، lock و نبود بازیابی عمومی                                                    |
| Infra محلی                               | ۲۱ فایل، ۱۹۲ موفق، دو skip قبلی                                                                                                              |
| Runtime مقصد                             | Argon2 واقعی در image با UID 1000 و روی host موفق؛ TLS هر دو role خصوصی با verify-full موفق                                                  |
| Security binding                         | بررسی واقعی Core و Admin موفق؛ چهار timer امنیتی فعال؛ deadline و policy تضعیف نشدند                                                         |

تست موفق تغییر credential و قفل با fixture محلی انجام شد، نه حساب انسانی روی Staging. CI راه‌دور و check کامل مخزن در این نوبت اجرا/سبز اعلام نشدند؛ مسائل قدیمی Web SSR/provenance به این نصب Admin تعمیم داده نشده‌اند.

دو خطای کنترل انتشار قبل از admission رفع و ثبت شدند: umask خصوصی، دایرکتوری‌های بسته را 0700 کرده بود و UID 1000 به وابستگی‌ها دسترسی نداشت؛ فقط درخت غیرمحرمانهٔ build با permission قابل‌خواندن/عبور، بدون group/other write و با حفظ executable bit بازسازی، سپس image تازه smoke و دوباره scan شد. همچنین query خواندنی پذیرش پس از migration یک پرانتز اضافه داشت؛ بدون تکرار migration با query صحیح بررسی شد. مقایسهٔ اولیهٔ `iptables-save` شامل counter متغیر بود و مقایسهٔ معتبر محسوب نشد؛ hash فایل‌های UFW ثابت، allowlist واقعی ورودی 22/80/443 و آزمون خارجی بسته‌بودن Admin تأیید شدند. هیچ قاعدهٔ Firewall برای عبور تست تغییر نکرد.

## مانع مستقل زیرساخت و گام بعد

> بررسی و candidate محلی در [گزارش اصلاح libcurl](../operations/postgres-libcurl-remediation-20261026.md) آماده شده‌اند؛ هنوز مجوز نصب آن روی سرور داده نشده و یافتهٔ image فعال همچنان برقرار است.

timer موجود Core، پیش از تغییر این نوبت، در `2026-10-26T11:01:14Z` تمدید evidence را رد کرده است. گزارش واقعی `postgres-staging.scan.private.json` یک HIGH برای `libcurl 8.22.0-r0` با شناسهٔ `CVE-2026-92392` و نسخهٔ اصلاحی گزارش‌شدهٔ `8.23.0-r0` دارد. این یافتهٔ scanner دربارهٔ کتابخانهٔ image فعلی PostgreSQL است؛ ادعای آسیب‌پذیری خود موتور یا اثبات exploit نیست. image PostgreSQL در این نصب تعویض نشد. Admin جدید HIGH ندارد، اما سقف اعتبار آن به Core وابسته است.

مهلت فعلی هر دو **`2026-10-26T19:10:35Z`، ساعت ۲۲:۴۰:۳۵ تهران** است. تا وقتی qualification مشترک با شواهد معتبر تمدید نشود، timer موجود در موعد تعیین‌شده سرویس‌ها را contain می‌کند. ساعت/metadata، deadline، scanner severity، policy یا timer برای تمدید مصنوعی تغییر نکردند. اصلاح image داده و qualification مجدد، مجوز و بررسی جدا می‌خواهد؛ در محدودهٔ نصب Admin اجرا نشد.

timer خود Admin پس از نصب، در `2026-10-26T11:43:27Z` با image جدید به‌صورت خودکار موفق اجرا شد؛ سقف Core اجازهٔ افزایش مهلت مشترک را نداد. سلامت همهٔ appها در `11:43:38Z` دوباره تأیید شد.

پیش از ساخت OWNER: این مانع بررسی و رفع شود؛ سپس با تأیید جدا بکاپ رمزگذاری‌شده، custody عبارت decrypt خارج VPS، کپی خارج سرور و restore-test همان نسخه انجام و receipt تازه نصب شود. بعد از تأیید مستقل ساخت حساب، فقط مالک در SSH/TTY شخصی ورودی مخفی را وارد کند. رمز اصلی باید در vault شخصی نگه‌داری شود؛ مسیر reset برای گم‌شدن آن نداریم. هیچ credential را در چت نفرستید.

شواهد server در `/opt/hambazi/admin/releases/20261026-private-owner/` شامل `deployment-receipt.json`، `post-deployment-evidence.json`، `database-after.json`، `final-database-acceptance.json`، scan/metadata و `existing-core-scan-blocker.json` هستند. شواهد مرورگر و کپی رسیدهای غیرمحرمانه در `/home/mehdi/.cache/hambazi-admin-owner/deployment-20261026-private/` نگه‌داری شده‌اند. کانتینر قبلی Admin متوقف و برای rollback بازبینی‌شده حفظ شد؛ image دقیق و schema افزایشی حفظ‌اند. rollback خودکار، down migration یا restore روی DB مشترک انجام نشد.

**توقف:** نصب خصوصی فاز یک تکمیل شد؛ برای رسیدگی جدا به مانع زیرساخت، بکاپ واقعی و سپس ایجاد OWNER به تأییدهای مشخص بعدی نیاز است. Public Admin و فاز دو همچنان بسته‌اند.
