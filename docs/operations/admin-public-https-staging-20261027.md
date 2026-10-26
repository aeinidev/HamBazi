# انتشار Public HTTPS ادمین Staging — ۲۷ اکتبر ۲۰۲۶

## محدوده و وضعیت

**Public HTTPS و فاز یک در محدودهٔ مصوب Staging تکمیل‌اند.** ورود واقعی، تغییر Password، بی‌اعتباری نشست‌های قبلی و بکاپ نهاییِ خارج سرور با restore واقعی تأیید شدند. PIN واقعی به خواست مالک ثابت ماند؛ تغییر PIN فقط ایزوله آزمایش شد. نهایی‌سازی فقط archive و receipt خصوصی بکاپ را افزود؛ حساب، تنظیمات سرویس‌ها، Firewall و Production تغییر نکردند. تصمیم معماری همان ADR-083 است؛ Bootstrap و Recovery فقط SSH خصوصی می‌مانند و فاز دو آغاز نشده است.

## gate بکاپ و پیش‌بررسی

بکاپ حاوی OWNER با نام `owner-6be89773-a302-4330-9360-246ebd1c3a3d.hba` خارج سرور، در `/home/mehdi/.local/share/hambazi/backups/staging/owner-phase1/` نگه‌داری می‌شود. اندازه ۶۸۵۹ بایت و SHA-256 برابر `2baa095dc59ba378b6040d55f896ae1b5f02b32e03b5f977c718817caaaeaa9a` است. عبارت Backup را فقط مالک در prompt مخفی ابزار محلی وارد کرد. بازیابی واقعی در container ایزولهٔ بدون شبکه موفق و رسید `2026-10-26T20:32:21.452Z` بررسی و در مسیر خصوصی سرور نصب شد. نسخهٔ قبل ساخت OWNER برای این gate کافی محسوب نشد.

پیش از تغییر، healthcheck تازهٔ PostgreSQL، API، Bot، Worker، Web و Admin موفق بود؛ Worker اتصال Redis/BullMQ را نیز می‌سنجد. هر دو کنترلر Core/Admin با binding واقعی معتبر بودند. deadline مشاهده‌شده `2026-10-27T19:14:50Z` بود؛ تاریخ دستی تمدید نشده است. Nginx معتبر و timer گواهی فعال بود. OWNER فعال، بدون lock و با شمار خطای PIN صفر تأیید شد؛ اطلاعات ورودی یا verifier خام خوانده/چاپ نشد.

## تغییر حداقلی مورد تأیید

همان image نصب‌شدهٔ `sha256:a10b8c3f9f73fb627508eb8535af3f7d15d6c91523ea1bcb1799ad6697a33814` پشتیبانی public-proxy دارد؛ hash فایل runtime HTTP و config با بستهٔ تأییدشده تطابق دارد. build جدید، تغییر schema، migration، grant، PostgreSQL، Redis یا دادهٔ بازی لازم نیست.

فقط Nginx مخصوص Admin، `ADMIN_INGRESS_MODE=public-proxy` و proxy peer خصوصی `10.89.18.1`، کنترلر جدید همان policy و hook مختص lineage `hambazi-admin` مستقر می‌شوند. Backend همان IP خصوصی، TLS معتبر، UID 1000، filesystem فقط‌خواندنی، cap-drop و بدون published port را حفظ می‌کند. کلیدها، pepper، credentialها و بستهٔ اپراتوری تغییر نمی‌کنند.

مراحل: پشتیبان خصوصی فایل‌های عملیاتی و container قبلی → HTTPS با marker عمومی غایب و پاسخ 503 → `nginx -t` و reload → dry-run فقط گواهی Admin با اجرای hook جدید و بررسی receipt/گواهی زنده → بازسازی فقط container Admin با همان image و env جدید → admission/health/private TLS و default-deny → renewal واقعی اسکن/qualification → بازشدن marker عمومی و آزمون خارجی → ورود شخصی OWNER و پذیرش.

هر reload پس از `nginx -t` است. hook تمدید گواهی‌های دیگر را نادیده می‌گیرد؛ Certbot timer میزبان reuse می‌شود و به رایانهٔ مالک وابسته نیست. کد جدید hook، مانند سایر فایل‌های مؤثر، به کنترل hash متصل می‌شود. deadline، severity policy، expiry timer و containment دور زده نمی‌شوند.

## آزمون‌های تازه پیش از نصب

سه تست Nginx واقعی به Backend خصوصی TLS و ۱۸ تست policy/hook/certificate موفق شدند. مسیرهای PENDING، CSRF، header spoofing، default deny، PIN، revoke و rate limit در fixture همان کد پوشش دارند. اجرای همزمان کل infra یک timeout پنج‌ثانیه‌ای در capacity harness داشت؛ اجرای مستقل همان سه تست بدون تغییر assertion یا timeout موفق بود. کل CI با این نتیجه سبز اعلام نمی‌شود.

## نتیجهٔ اجرای واقعی

- نصب بسته و Qualification در `2026-10-26T20:38:01Z` موفق شدند. container جدید Admin با همان image تأییدشده ایجاد شد؛ شناسهٔ آن `ecfc47db6d3e86d4563acf7f87d343234f979d9428511a1d7ce45798ded277f9` است. فقط دو کلید ingress در env تغییر کردند؛ تمام secretها و سایر تنظیمات با نسخهٔ قبل برابر ماندند.
- Certbot فقط `hambazi-admin` را با `--dry-run --run-deploy-hooks --no-random-sleep-on-renew --non-interactive` آزمایش کرد. hook جدید واقعاً اجرا شد؛ receipt ساعت `20:37:16Z`، تطبیق chain/hostname/key و leaf زنده را ثبت کرد. محتوای PEMهای واقعی همهٔ archiveها قبل/بعد برابر بود؛ هیچ گواهی واقعی جایگزین نشد.
- اسکن دوبارهٔ image واقعی Admin موفق بود: صفر HIGH/CRITICAL/UNKNOWN و یک MEDIUM مطابق policy موجود. renewal واقعی در `20:38:00Z` موفق و deadline در سقف Core، `2026-10-27T19:14:50Z` باقی ماند. هر چهار timer امنیتی و `certbot.timer` فعال بودند؛ expiry/containment حذف، تمدید دستی یا ضعیف نشدند.
- پیش از marker، اتصال خارجی مستقیم به IP Staging با SNI و trust کامل دامنه، پاسخ 503 گرفت. DNS عمومی 1.1.1.1 و 8.8.8.8 هر دو `89.46.217.9` را برگرداندند. marker فقط پس از verify دوبارهٔ هر دو controller در `20:41:03Z` ساخته شد.
- آزمون از خارج سرور و بدون تونل: Login فارسی/RTL و assetها 200، HTTP redirect برابر 308، session/access/overview/users بدون cookie برابر 401، mutation بدون Origin/CSRF و Origin خارجی و bearer نامعتبر برابر 403، مسیرهای Bootstrap/Recovery/Forgot/Signup/Unlock و dotfile برابر 404 بودند. headerهای CSP/HSTS/no-store و frame protection بررسی شدند. در ۲۴ GET بدون credential، ۲۰ پاسخ 401 و چهار پاسخ 429 ثبت شد؛ هیچ KDF، PIN غلط یا حساب آزمایشی برای این آزمون استفاده نشد.

روی رایانهٔ مالک، ورودی قدیمی `/etc/hosts`، دامنهٔ Admin را به `127.0.0.1` می‌برد. شکست اولیهٔ اتصال ناشی از همین override بود؛ مسیر واقعی سرور و DNS عمومی سالم‌اند. برای حذف فقط همین خط، دستور شخصی `sudoedit /etc/hosts` ارائه شد؛ Codex اختیار sudo محلی نداشت و اطلاعات محرمانهٔ سیستم درخواست نکرد. مرورگر اختصاصی قبلیِ resolver/tunnel برای پذیرش عمومی استفاده نمی‌شود. پس از حذف override، ورود از مرورگر عادی لازم است.

مالک سپس حذف override و ورود از مرورگر عادی را موفق اعلام کرد. Audit واقعی، `PASSWORD_VERIFIED` در `2026-10-26T20:47:14.910Z` و `LOGIN_SUCCEEDED` در `20:47:19.391Z` را ثبت کرده است؛ این نخستین ورود پس از انتشار عمومی است. OWNER فعال و بدون lock، PIN failure صفر، و credential/session epoch در این نقطه هنوز ۱ بود. هیچ ورودی، cookie، token، تصویر یا network payload از مرورگر مالک خوانده نشد.

تغییر واقعی Password در `20:51:13.120Z` با رویداد `PASSWORD_CHANGED` و افزایش اتمیک credentialVersion/sessionEpoch به ۲ ثبت شد؛ ورود مجدد با نسخهٔ جدید در `20:51:36.534Z` موفق بود. **ابطال نشست‌های قبلی با version fence است:** guard هر درخواست نسخه‌های session را با OWNER جاری در primary تطبیق می‌دهد؛ ردیف قدیمی با `revoked_at=NULL` همچنان به دلیل اختلاف epoch/version فاقد اعتبار است. انتظار اولیهٔ ابزار بررسی برای پرشدن فیزیکی `revoked_at` معیار صحیح این پیاده‌سازی نبود؛ از این مقدار به‌تنهایی نتیجهٔ ضعف امنیتی یا پذیرش نشست گرفته نمی‌شود. در این نقطه تغییر PIN هنوز در Audit ثبت نشده و پذیرش آن جدا پیگیری می‌شود.

### سلامت پس از انتشار — `2026-10-26T20:44:09Z`

| سرویس                 | نتیجه                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL            | `pg_isready` موفق؛ هیچ تغییر داده یا نسخه انجام نشد                                                                                                               |
| Redis                 | running و اتصال واقعی Admin/Worker موفق                                                                                                                           |
| Nginx                 | active و `nginx -t` موفق؛ hash پیکربندی بازیکنان ثابت                                                                                                             |
| API، Bot، Worker، Web | native health و Docker health موفق؛ هر چهار container همان ID قبل انتشار                                                                                          |
| Admin                 | native health موفق، binding جدید معتبر، بدون published port                                                                                                       |
| HTTPS بازیکنان        | Web روی `staging.hambazi.top` پاسخ 200؛ root API/Bot روی نام‌های واقعی `api-staging.hambazi.top` و `bot-staging.hambazi.top` پاسخ مورد انتظار 404؛ گواهی‌ها معتبر |
| HTTPS ادمین           | پاسخ 200 از مسیر عمومی؛ maintenance غایب و marker انتشار حاضر                                                                                                     |
| تمدید خودکار          | `certbot.timer` فعال، موعد بعدی مشاهده‌شده `2026-10-27T09:07:30Z`؛ چهار timer امنیتی نیز فعال                                                                     |

شواهد خصوصی انتشار در `/opt/hambazi/admin/releases/20261027-public-https/` شامل qualification بسته، سلامت نهایی، نسخهٔ قبل فایل‌ها و ابزار بازگشت هستند؛ خروجی آزمون خارجی بدون credential روی رایانه نیز نگه‌داری شده است. بازگشت لازم نشد. آزمون اولیهٔ health wrapper نام دامنه‌های API/Bot را اشتباه نوشته بود و در DNS متوقف شد؛ نام‌ها از config واقعی خوانده و بررسی کامل دوباره موفق شد، بدون تغییر DNS یا سرویس.

## بازگشت

در شکست کنترل ضروری، marker عمومی حذف و maintenance برقرار می‌شود. فقط container Admin جدید متوقف/حذف، فایل‌ها و کنترل معتبر قبلی و container خصوصی قبلی بازگردانده می‌شوند. پیش از reload، Nginx و پیش از start، شواهد امنیتی دوباره اعتبارسنجی می‌شوند. هیچ DB restore/down-migration، حذف volume، توقف سرویس بازیکنان یا فعال‌سازی اجباری با شواهد منقضی انجام نمی‌شود. در شکست بازگشت، Admin بسته می‌ماند.

## پذیرش نهایی

ورود عمومی OWNER، مرحلهٔ PIN، تغییر Password و بی‌اعتباری هر چهار نشست پیش از آن پذیرفته شدند. بازبینی `2026-10-26T21:00:33Z` یک `PASSWORD_CHANGED`، صفر `PIN_CHANGED`، نسخه‌های جاری ۲، PIN failure صفر و نبود lock را تأیید کرد. مالک تصریح کرد PIN را تغییر نداده و قصد آن را ندارد؛ رویداد صفر، طبیعی است و gate محسوب نمی‌شود. تست تغییر PIN با حساب مصنوعی در PostgreSQL محلی یک‌بارمصرف انجام شد؛ هیچ حساب آزمایشی سرور یا تماس mutation با OWNER واقعی ایجاد نشد.

بررسی مجدد سرویس‌ها و هر دو binding امنیتی در `21:01:10Z` فقط‌خواندنی و موفق بود. سپس مالک بکاپ پس از تغییر Password را صریحاً مجاز کرد: archive تازهٔ `owner-846fe695-e2a5-4665-a7b0-853e57e67749.hba` با اندازهٔ ۸۷۱۴ بایت، SHA-256 برابر `3fc12bd7cb25d39c727854a85bc27a552952e85b0a943c3da89712dfdeb43194` و کپی 0600 خارج سرور تأیید شد. ورود عبارت decrypt فقط در ترمینال شخصی مالک بود. restore واقعیِ بدون شبکه، receipt زمان `2026-10-26T21:29:50.022Z` صادر کرد؛ hash/profile/realm/revision آن بررسی و receipt اتمیک در مسیر خصوصی ثبت شد. نبود اولیهٔ receipt باعث توقف پذیرش شد و فقط پس از وجود رسید واقعی این نسخه پذیرفته شد.

کنترل پایانی `21:30:50Z` یک OWNER فعال، نسخه‌های credential/session برابر ۲، authorizationVersion برابر ۱، PIN failure صفر، نبود lock و چهار نشست قبلیِ نامعتبر را تأیید کرد. Audit مربوط به Password یک بار و PIN_CHANGED صفر بار است؛ هیچ تغییر حساب یا recovery در این نوبت انجام نشد. در `21:30:59Z` سلامت هر هشت سرویس، HTTPS معتبر، ثبات تنظیمات/شناسهٔ containerهای بازیکنان و هر دو binding امنیتی موفق بود؛ backend بدون published port و timerها فعال‌اند. deadline معتبر `2026-10-27T19:14:50Z` باقی ماند؛ renewal یا تمدید دستی، نصب، reload و تغییر policy انجام نشد. نتیجهٔ کامل، حدود آزمون‌ها و آمادگی فاز بعد در [گزارش پایان فاز یک](../implementation/admin-phase-1-finalization-2026-10-26.md) ثبت شده‌اند؛ فاز دو فقط با تأیید صریح جدید آغاز می‌شود.

Password به‌همراه PIN ثابت MFA مستقل یا مقاوم به phishing نیست. انتشار عمومی با کنترل‌های جبرانی مصوب انجام می‌شود؛ سناریوی سه PIN غلط با Password سرقت‌شده همچنان می‌تواند حساب را تا Recovery خصوصی قفل کند.
