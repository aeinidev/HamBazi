# نتیجهٔ Dry Run گواهی Admin — ۲۶ اکتبر ۲۰۲۶

## نتیجه

با تأیید صریح مالک، فقط فرمان زیر روی Staging اجرا شد. آغاز 08:22:00 UTC و موفقیت challenge/hook حدود 08:22:10 UTC ثبت شد:

```sh
certbot renew --cert-name hambazi-admin --dry-run --run-deploy-hooks \
  --no-random-sleep-on-renew --non-interactive
```

Certbot با exit صفر و پیام `all simulated renewals succeeded` پایان یافت. ارتباط مستقیم سرور استفاده شد؛ متغیرهای Proxy از محیط همان فرایند حذف شدند. هیچ Proxy، VPN، Firewall rule، سرویس یا تنظیم جدیدی ایجاد نشد. آزمون برای certificate دیگری اجرا یا تکرار نشد.

## سلامت قبل و بعد

| مورد                         | شواهد                                                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nginx                        | `nginx -t` پیش و پس از آزمون موفق؛ hook موجود نیز پیش از reload همان validation را موفق اجرا کرد. journal موفقیت reload در 08:22:10 UTC را ثبت کرد. PID اصلی ثابت ماند؛ restart انجام نشد.                                        |
| API، Bot، Worker، Web، Admin | هر پنج container پیش و پس از آزمون healthy؛ اجرای تازهٔ healthcheck موجود هر پنج نیز exit صفر داشت. ID، StartedAt و RestartCount ثابت ماندند. Bot از قبل RestartCount=2 داشت و افزایشی رخ نداد.                                   |
| HTTPS بازیکنان               | hostnameهای Web، API و Bot با TLS معتبر و همان leaf قبلی پاسخ دادند؛ Web برابر ۲۰۰ و root غیرمسیر API/Bot برابر ۴۰۴ بود. سلامت کاربردی API/Bot با healthcheck خصوصی جدا سنجیده شد. این نتایج از بیرون سرور نیز دوباره بررسی شدند. |
| Admin خصوصی                  | HTTPS با hostname واقعی و TLS معتبر روی مسیر loopback:9443، پاسخ ۲۰۰، Backend healthy.                                                                                                                                            |
| Admin عمومی                  | TLS handshake همچنان رد شد؛ marker `public-enabled` غایب ماند.                                                                                                                                                                    |
| گواهی‌های واقعی              | کل محتوای `live` و `archive` و symlinkها با نمونهٔ قبل برابر ماندند. fingerprintهای هر دو lineage فعال و certificate واقعاً سرو‌شده تغییر نکردند.                                                                                 |
| پیکربندی                     | محتوای Nginx و renewal configurationهای موجود ثابت ماند. فایل‌های موقت challenge توسط Certbot پاک شدند؛ لاگ و حساب آزمایشی ACME از آثار عادی Dry Run هستند، نه حساب OWNER یا گواهی فعال تازه.                                     |

hook مؤثر و بازبینی‌شده همان `/etc/letsencrypt/renewal-hooks/deploy/hambazi-nginx` بود: `nginx -t && systemctl reload nginx`. لاگ Certbot اجرای مسیر آن و journal اجرای موفق reload را تأیید کردند. عبارت `ran with error output` صرفاً stderr عادی موفقیت `nginx -t` را نقل می‌کرد؛ شکست hook مشاهده نشد. hook جدید candidate مربوط به Public HTTPS نصب یا اجرا نشد.

## بررسی ابزار ثبت شواهد

wrapper ثبت شواهد به دلیل مقایسهٔ خام خروجی `iptables-save` و `ip6tables-save`، خروجی نهایی یک داد؛ **این exit مربوط به Certbot نبود**. خروجی این ابزارها comment زمان تولید دارد. پس از توقف عملیات تغییردهنده، دو نمونهٔ فقط‌خواندنی نشان دادند که با تغییر زمان، متن خام فرق می‌کند ولی تمام خطوط قواعد پس از حذف commentها یکسان‌اند. mtime فایل‌های Firewall نیز مربوط به قبل آزمون بود. هیچ فرمان تغییر Firewall اجرا نشد؛ مقایسهٔ خام به‌عنوان اثبات اختلاف rule گزارش نمی‌شود. baseline خام پیش‌آزمون در حافظهٔ فرایند بود و پس از خروج نگه‌داری نشد؛ بنابراین این بررسی جای ادعای تطبیق نرمال‌شدهٔ کامل قبل/بعد را نمی‌گیرد.

تشخیص اولیهٔ wrapper دربارهٔ دیده‌شدن نام hook در stdout نیز false بود، چون stdout نام فایل hook را چاپ نمی‌کرد؛ بازخوانی فقط‌خواندنی لاگ Certbot اجرای دقیق hook و journal موفقیت reload را ثابت کرد. هیچ Dry Run دوم یا تلاش اصلاحی روی سرور انجام نشد.

## آمادگی تمدید خودکار

`certbot.timer` فعال و enabled است؛ زمان بعدی مشاهده‌شده ۲۰۲۶-۱۰-۲۶ ساعت 23:59:05 UTC بود. service موجود `certbot -q renew --no-random-sleep-on-renew` را اجرا می‌کند و تنظیمات webroot/lineage و deploy hook را به ارث می‌برد. مسیر شبکه، challenge و reload همین lineage اکنون بدون وابستگی به رایانهٔ مالک آزمایش شده‌اند. در محدودهٔ این آزمون مانع فعلی تمدید خودکار مشاهده نشد؛ موفقیت امروز تضمین پایداری آیندهٔ شبکه نیست.

این آزمون جایگزینی واقعی certificate در موعد تمدید را انجام نداد و تأیید آمادگی Public HTTPS، نصب hook جدید یا رفع سایر gateهای انتشار نیست. سایر گواهی‌ها تغییر نکردند، Admin عمومی بسته ماند و فاز دو آغاز نشد.
