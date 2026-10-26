# نهایی‌سازی فاز یک Admin — پایان ۲۷ اکتبر ۲۰۲۶

## وضعیت و مجوز

**فاز یک در محدودهٔ مصوب Staging تکمیل و آمادهٔ پذیرش نهایی مالک است.** بکاپ پس از تغییر Password، کپی خارج سرور، بازیابی واقعی ایزوله و کنترل نهایی حساب/سرویس/امنیت موفق‌اند. پایان بررسی `2026-10-26T21:30:59Z`، معادل ۰۱:۰۰:۵۹ تهران در ۲۷ اکتبر است. PIN واقعی حفظ شد؛ نبود `PIN_CHANGED` طبیعی و آزمون تغییر آن فقط با هویت مصنوعی ایزوله موفق است. حساب OWNER و Production در این نوبت تغییر نکردند. فاز دو آغاز نشده و فقط با تأیید صریح جدید مالک مجاز است.

در بررسی واقعی `2026-10-26T14:20:38Z`، OWNER، operator، session و PIN failure همگی صفر و شمار Migration موفق ۱۷ بود. receipt بکاپ مخصوص OWNER، checkpoint و فایل lock مراسم وجود نداشتند. هیچ حساب پیش‌فرض/آزمایشی روی Staging ساخته نشده است. بکاپ کامل اصلاح libcurl، جای receipt مخصوص هویت در ADR-084 نیست.

**به‌روزرسانی مجوز در ادامهٔ همین فاز:** مالک انتشار Public HTTPS را فقط برای Admin محیط Staging، پس از تأیید بکاپ حاوی OWNER و بازیابی ایزوله، صریحاً مجاز کرده است. Production و فاز دو همچنان خارج از مجوز اجرا هستند. [گزارش انتشار عمومی](../operations/admin-public-https-staging-20261027.md) مرجع نتیجهٔ این تغییر است. [برنامهٔ فاز دو](admin-phase-2-execution-plan.md) فقط سند است؛ شروع آن به تأیید صریح پس از گزارش پذیرش فاز یک نیاز دارد.

## پیش‌نیازهای بررسی‌شده

| کنترل                           | وضعیت                                                                                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core/Admin binding و مهلت واقعی | بازبینی نهایی فقط‌خواندنی `2026-10-26T21:30:59Z` برای هر دو موفق؛ deadline معتبر `2026-10-27T19:14:50Z`، بدون تغییر دستی؛ timerهای تمدید/توقف فعال‌اند                                    |
| realm/environment و ingress     | فقط Staging؛ یک OWNER واقعی فعال؛ Backend بدون published port؛ تغییر ingress عمومی فقط در مجوز جدید همین گزارش                                                                            |
| بستهٔ اپراتوری                  | revision تأییدشده `ecbbd10d235051d7f631d544db24bc3ffc347e7d50587ed4ac76f8b6a9bb3fb6`؛ hash، مالکیت root و منع write عمومی ۷۶ فایل ماژول هویت/schema با manifest بازبینی‌شده تطبیق داده شد |
| Runtime مقصد                    | Node 24.20.0 و PostgreSQL client 18.6 نصب‌اند؛ Argon2 واقعی و TLS با verify-full هر دو role خصوصی مجدداً موفق                                                                             |
| grant محدود بکاپ                | SELECT هر شش جدول Admin برای role خصوصی recovery برقرار؛ مجوز جدیدی در این نوبت اعمال نشد                                                                                                 |
| مسیرهای خصوصی                   | پوشه‌های private/backups متعلق به root و mode 0700؛ receipt نهایی باید root:root/0600 باشد                                                                                                |
| Backup مخصوص OWNER              | **موفق:** نسخهٔ نهایی پس از تغییر Password خارج سرور است؛ hash، بازیابی واقعی ایزوله و receipt خصوصی تأیید و ثبت شدند                                                                     |
| custody و محرمانگی              | عبارت Backup مستقل در vault خارج VPS؛ Username/Password/PIN فقط در TTY شخصی و بدون ضبط؛ Codex ورودی آن ترمینال یا مرورگر شخصی را نمی‌خواند                                                |

مرجع مرزبندی و پروفایل مراسم [ADR-084](../adr/084-staging-owner-private-ssh-ceremony.md) و [runbook خصوصی](../operations/admin-owner-staging-ceremony.md) است. اختیار root/SSH نمایندهٔ اختیار مالک Staging است؛ دو امضای Ed25519 در این پروفایل لازم نیستند. Password + PIN ثابت MFA مستقل یا مقاوم به فیشینگ محسوب نمی‌شود. بازیابی خصوصی PIN به Password فعلی نیاز دارد؛ Forgot/Reset Password برای OWNER وجود ندارد.

## بکاپ واقعی پیش از OWNER — تأییدشده

مالک پیام موفقیت بکاپ و سپس پیام موفقیت restore را از ترمینال خصوصی خودش اعلام کرد. archive واقعی `owner-b9df4c34-8c54-441e-84b2-0aacb0447367.hba` در `2026-10-26T14:48:19Z` ساخته شد؛ اندازه ۶۱۳۴ بایت و SHA-256 برابر `69c595fde28be899fddd03a55af41576b96766a3eb9ff7c889392e3bac808204` است. کپی 0600 متعلق به کاربر در `/home/mehdi/.local/share/hambazi/backups/staging/owner-phase1/` با hash سرور تطبیق داده شد. هیچ dump یا capsule خام روی دستگاه یا در گزارش نوشته نشد.

restore-test مورد تأیید با ورودی شخصی عبارت رمزگذاری، receipt واقعی با `checkedAtUTC=2026-10-26T14:51:36.278Z` صادر کرد. receipt با profile/realm/revision و hash archive تطبیق و با helper اتمیک خصوصی در `/opt/hambazi/admin/private/owner-backup-rehearsal.json`، root:root/0600 نصب شد. پیش از نصب، هر دو controller دوباره verify شدند و شمار OWNER/operator/session همگی صفر بود. این receipt دست‌ساز یا مربوط به fixture یا بکاپ کامل libcurl نیست. ورودی‌های ترمینال مالک خوانده یا ضبط نشدند.

gate بکاپ برای Bootstrap آماده است؛ فرمان خصوصی ساخت OWNER برای ورود شخصی مالک ارائه شده و تا دریافت شواهد واقعی، حساب ایجادشده اعلام نمی‌شود. مجوز قبلی ساخت Staging معتبر است و تأیید مجدد درخواست نشده است.

## نخستین OWNER واقعی — ایجادشده

مالک فرمان خصوصی را با ورود شخصی Username/Password/PIN اجرا و پیام `ADMIN_STAGING_OWNER_CEREMONY_COMPLETED` را اعلام کرد. بررسی خواندنی `2026-10-26T14:59:33Z` تأیید کرد دقیقاً یک OWNER/operator در realm Staging فعال است؛ realm خارجی، نشست مدیریتی، PIN failure یا lock وجود ندارد. credentialVersion/sessionEpoch/authorizationVersion هر سه ۱ هستند. هر دو verifier از نوع Argon2id، متفاوت و با salt مستقل‌اند؛ هیچ verifier یا Username در خروجی گزارش درج نشد.

رویداد `OWNER_BOOTSTRAPPED` در `2026-10-26T14:58:30.274Z` ثبت شده است. Audit خصوصی مراسم دارای `STARTED` و `SUCCEEDED` است، checkpoint root:root/0600 دقیقاً به همان binding مالک متصل و فاقد pending است و lock موقت حذف شده است. رویداد قدیمی `LOGIN_DENIED` مربوط به `2026-10-25T20:40:08Z` قبل از این حساب است و شکست PIN یا ورود حساب جدید محسوب نمی‌شود.

برای حفاظت از هویت واقعی، بکاپ جدید پس از enrollment درخواست شد؛ سپس ورود واقعی، تغییر Password/PIN و ابطال نشست‌ها دنبال می‌شوند. حساب جدید برای آزمون قفل سه‌تلاشی استفاده نمی‌شود. تا تکمیل این پذیرش و بکاپ نهایی، فاز یک پایان‌یافته اعلام نمی‌شود.

### بکاپ حاوی OWNER و شواهد ورود واقعی

نسخهٔ `owner-6be89773-a302-4330-9360-246ebd1c3a3d.hba`، اندازهٔ ۶۸۵۹ بایت، با SHA-256 برابر `2baa095dc59ba378b6040d55f896ae1b5f02b32e03b5f977c718817caaaeaa9a` به رایانه منتقل شده و مجوز 0600 و هش دو طرف تأیید شده‌اند. دریافت عبارت رمزگذاری و restore فقط در ترمینال شخصی مالک انجام شد. رسید واقعی همین نسخه با زمان `2026-10-26T20:32:21.452Z`، source revision تأییدشده و profile/realm صحیح بررسی و در مسیر خصوصی سرور نصب شد. رسید قدیمیِ قبل Bootstrap جای این کنترل استفاده نشد؛ تا ایجاد رسید واقعی، انتشار متوقف ماند.

بازبینی فقط‌خواندنی پس از این رسید، یک OWNER فعال با PIN failure صفر و بدون lock را تأیید کرد. Audit واقعی `PASSWORD_VERIFIED` در `15:07:07.065Z` و `LOGIN_SUCCEEDED` در `15:07:14.191Z` روز ۲۶ اکتبر وجود دارد؛ هیچ Password/PIN/cookie یا ورودی مرورگر خوانده نشد. credential/session epoch هنوز ۱ است؛ آزمون واقعی تغییر Password/PIN و ابطال نشست‌ها هنوز به‌عنوان انجام‌شده گزارش نمی‌شود.

### پذیرش Public HTTPS و تعویض اطلاعات — در حال تکمیل

انتشار عمومی مجاز Staging در `2026-10-26T20:41:03Z` انجام شد؛ گزارش تفصیلی و آزمون‌های زنده در [گزارش انتشار عمومی](../operations/admin-public-https-staging-20261027.md) است. DNS عمومی و TLS از خارج سرور، Login/assetها، 401 پیش‌فرض APIها، 403 برای Origin/CSRF/bearer نامعتبر، 404 مسیرهای خصوصی و 429 rate limit تأیید شدند. Backend published port ندارد؛ هیچ تغییر Firewall، Production یا دادهٔ بازی انجام نشد. همهٔ سرویس‌ها پس از انتشار سالم بودند.

مالک override قدیمی hosts را حذف و ورود عمومی و مرحلهٔ PIN را موفق اعلام کرد؛ Audit نیز ورود در `20:47:19.391Z` را تأیید کرد. تغییر Password در `20:51:13.120Z` ثبت و credentialVersion/sessionEpoch به ۲ رسید؛ ورود مجدد در `20:51:36.534Z` موفق بود. نشست‌های نسخهٔ ۱ با guard مقایسهٔ نسخه‌ها در primary فوراً فاقد اعتبارند؛ پرشدن فیزیکی `revoked_at` شرط ابطال نسخه‌ای نیست. OWNER فعال، PIN failure صفر و بدون lock ماند.

در بازبینی نخست، `PIN_CHANGED` وجود نداشت؛ مالک سپس روشن کرد PIN را عمداً حفظ کرده است. این نبود رویداد، شکست قابلیت یا gate مسدودکننده نیست. معیار پذیرش PIN به تست با حساب مصنوعی ایزوله تغییر کرد؛ PIN حساب واقعی، lock و نشست‌های نسخهٔ جاری دست‌کاری نشدند. بکاپ/restore متناظر Password جدید که در بازبینی قبل منتظر مجوز بود، با درخواست نهایی مالک طبق بخش بعد تکمیل شد.

### نتیجهٔ بازبینی فقط‌خواندنی ۲۷ اکتبر

در `2026-10-26T21:00:33.041Z`، معادل ۰۰:۳۰:۳۳ تهران در ۲۷ اکتبر، `PASSWORD_CHANGED` دقیقاً یک بار و `PIN_CHANGED` صفر بار بود. credentialVersion و sessionEpoch هر دو ۲ هستند. هر چهار ردیف نشست ایجادشده پیش از تغییر Password نسخهٔ قدیمی دارند؛ شمار نشست‌های قبلیِ دارای نسخهٔ قابل‌پذیرش صفر است. guard به primary متصل است و هر دو نسخه را در هر درخواست کنترل می‌کند؛ `revoked_at=NULL` در ردیف قدیمی این ابطال را خنثی نمی‌کند. ورود موفق پس از تغییر Password نیز در Audit ثبت شده است. OWNER فعال، بدون lock و PIN failure صفر باقی ماند.

هر هشت سرویس PostgreSQL، Redis، Nginx، API، Bot، Worker، Web و Admin سالم بودند؛ فایل تنظیمات بازیکنان و ID چهار container برنامه ثابت ماندند. Backend پورت منتشرشده ندارد. اعتبار هر دو کنترلر بدون اجرای renewal یا نوشتن log بررسی شد؛ اسکن موجود Admin صفر HIGH/CRITICAL/UNKNOWN و یک MEDIUM مطابق policy دارد. public HTTPS و APIهای بدون credential دوباره فقط با GET آزموده شدند؛ Login پاسخ 200، session/access پاسخ 401 و مسیرهای Recovery/Forgot پاسخ 404 دادند. تمام headerهای امنیتی دریافتی بررسی شدند؛ بعضی headerهای API در دو لایه با مقدار امن تکرار می‌شوند و به این دلیل assertion تک‌مقداری اولیه اصلاح شد؛ هیچ header یا تنظیم سرور تغییر نکرد.

آزمون PostgreSQL محلی اکنون یک سناریوی صریح تغییر PIN دارد: همان هویت مصنوعی در DB یک‌بارمصرف، PIN جدیدِ hash‌شده، ثابت‌ماندن verifier رمز، نامعتبرشدن دو FULL و یک PENDING قدیمی، رد PIN قبلی، ورود با PIN جدید، ثبت Audit و counter صفر را تأیید می‌کند. PIN مصنوعی در پایان به مقدار fixture بازمی‌گردد و تمام منابع اختصاصی runner پاک می‌شوند. هیچ fixture یا credential آزمایشی روی سرور ساخته نشد.

### بکاپ نهایی پس از تغییر Password — تأییدشده

پیش‌بررسی `2026-10-26T21:20:02Z` سلامت هر هشت سرویس، اعتبار Core/Admin تا `2026-10-27T19:14:50Z`، خصوصی‌بودن پورت Backend و ثابت‌بودن تنظیمات بازیکنان را تأیید کرد. حساب نسخهٔ ۲ فعال، PIN failure صفر، بدون lock و دارای چهار نشست قدیمی نامعتبر است. checkpoint بدون pending و مراسم بدون lock باقی‌مانده بود.

مالک ابزار خصوصی را در SSH/TTY شخصی اجرا و عبارت مستقل بکاپ را فقط در prompt مخفی وارد کرد. فایل تازهٔ `owner-846fe695-e2a5-4665-a7b0-853e57e67749.hba` در `2026-10-26T21:22:05Z`، پس از رویداد تغییر Password، ایجاد شد؛ اندازه ۸۷۱۴ بایت و SHA-256 برابر `3fc12bd7cb25d39c727854a85bc27a552952e85b0a943c3da89712dfdeb43194` است. فایل root:root/0600 سرور به `/home/mehdi/.local/share/hambazi/backups/staging/owner-phase1/` منتقل شد؛ مالکیت کاربر، mode 0600، اندازه و hash نسخهٔ خارج سرور تطبیق دارند. هیچ dump، کلید، Password، PIN یا عبارت decrypt خام در چت یا مخزن نوشته نشد.

هشت فایل مؤثر ابزار restore/رمزگذاری/TTY و SQLهای schema/grant در بستهٔ خصوصی رایانه با manifest مصوب revision `ecbbd10d235051d7f631d544db24bc3ffc347e7d50587ed4ac76f8b6a9bb3fb6` تطبیق داده شدند؛ خود manifest نیز با digest canonical همان revision برابر بود. مالک restore همین archive را در ترمینال شخصی خارج از SSH و با ورود مخفی عبارت بکاپ انجام داد. رسید واقعی `owner-846fe695-e2a5-4665-a7b0-853e57e67749.hba.restore.json` با زمان `2026-10-26T21:29:50.022Z` صادر شد؛ profile/realm/revision، hash archive، `restored=true` و `offServerCopyVerified=true` تطبیق دارند. تا ایجاد این رسید، صرف اعلام موفقیت شفاهی برای عبور از gate استفاده نشد.

همان receipt با helper اتمیک root-private در `/opt/hambazi/admin/private/owner-backup-rehearsal.json` ثبت شد. بررسی `21:30:50.618Z` دوباره فقط یک OWNER فعال، credentialVersion/sessionEpoch برابر ۲ و authorizationVersion برابر ۱، PIN failure صفر، نبود lock و checkpoint بدون pending را تأیید کرد. `PASSWORD_CHANGED` یک بار، `PIN_CHANGED`/Recovery/قفل صفر بار و هر چهار نشست پیش از تغییر Password نامعتبر باقی ماندند. هیچ verifier، Password، PIN یا کلید خام در خروجی قرار نگرفت و هیچ رکورد حساب تغییر نکرد.

در پایان `21:30:59.414Z`، سلامت PostgreSQL، Redis، Nginx، API، Bot، Worker، Web و Admin دوباره موفق بود. hash تنظیمات بازیکنان و شناسهٔ چهار container برنامه با baseline قبل بکاپ برابر ماند. HTTPS معتبر همهٔ hostnameهای Staging تأیید شد؛ Web/Admin پاسخ 200 و root غیرمسیر API/Bot پاسخ مورد انتظار 404 داشتند. Backend بدون published port و هر پنج timer امنیت/گواهی فعال‌اند. اعتبار اسکن و binding موجود برای Core/Admin حفظ شد؛ Admin صفر HIGH/CRITICAL/UNKNOWN و یک MEDIUM مطابق policy دارد. deadline مشاهده‌شده `2026-10-27T19:14:50Z`، برابر ۲۲:۴۴:۵۰ تهران در ۲۷ اکتبر است؛ این زمان دستی تمدید نشده و ضمانت تمدید دائمی نیست.

این نوبت فقط archive تازهٔ رمزگذاری‌شده، کپی/receipt آن و مستندات را اضافه کرد. هیچ migration، نصب، reload/restart، تغییر Firewall، credential/OWNER/PIN، policy امنیت یا Production انجام نشد. بازیابی واقعی فقط در container موقت محلیِ بدون شبکه انجام و منابع همان آزمون توسط ابزار پاک شدند؛ هیچ restore روی دیتابیس سرویس‌دهنده اجرا نشد.

## مسیر تعاملی، بدون دریافت اطلاعات محرمانه در چت

### ۱. بکاپ پیش از ساخت حساب

فقط در ترمینال شخصیِ بدون ضبط و اشتراک صفحه اجرا شود. secret را در فرمان، محیط shell، فایل، چت یا ورودی Codex ننویسید. هر فیلد را جداگانه پس از prompt وارد کنید؛ paste چندخطی رد می‌شود.

```sh
ssh -tt -i /home/mehdi/Downloads/private-key-file.pem \
  -o UserKnownHostsFile=/home/mehdi/.ssh/known_hosts \
  -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes \
  root@89.46.217.9 \
  'ulimit -c 0; exec node /opt/hambazi/admin/operator/apps/api/dist/composition/admin-owner-backup-cli.js --confirm-private-owner-backup'
```

عبارت رمزگذاری مستقل حداقل ۲۰ نویسه و تکرار آن مخفی وارد و در vault خارج سرور نگه‌داری می‌شود؛ از Password/PIN مالک استفادهٔ مجدد نشود. تأیید نهایی prompt، `BACKUP OWNER STAGING` است. فقط پیام غیرمحرمانهٔ `ADMIN_STAGING_OWNER_BACKUP_CREATED` به Codex اعلام شود؛ عبارت رمزگذاری ارسال نشود.

سپس Codex فقط archive رمزگذاری‌شده را به `/home/mehdi/.local/share/hambazi/backups/staging/owner-phase1/` منتقل، mode 0600 و hash دو طرف را بررسی می‌کند. نام دقیق فایل و فرمان restore-test روی همان دستگاه ارائه می‌شود. مالک عبارت Backup را شخصاً در ترمینال محلی وارد می‌کند؛ ابزار هیچ هدف سرور یا URL نمی‌پذیرد و فقط container موقت network=none را restore می‌کند. receipt واقعی باید به archive، revision نصب‌شده و زمان حداکثر ۲۴ ساعت متصل باشد؛ پس از بررسی، در مسیر خصوصی سرور نصب می‌شود. هیچ receipt دستی برای سبزکردن gate ساخته نمی‌شود.

### ۲. ایجاد OWNER پس از بکاپ و restore موفق

پس از تأیید واقعی مرحلهٔ قبل، مالک این فرمان را در SSH/TTY شخصی اجرا می‌کند؛ در حال حاضر نباید پیش از receipt اجرا شود:

```sh
ulimit -c 0
node /opt/hambazi/admin/operator/apps/api/dist/composition/admin-owner-staging.js bootstrap --confirm-private-owner-ceremony
```

Username بین ۳ تا ۶۴ نویسهٔ لاتین/عدد/`_`/`.`/`-` است و با حرف یا عدد شروع می‌شود؛ lowercase ذخیره می‌شود. Password بین ۱۲ تا ۲۵۶ نویسه و PIN دقیقاً شش رقم لاتین است؛ هر دو تکرار می‌شوند. انتخاب قوی و نگه‌داری در vault شخصی لازم است. تغییر Username مالک در CRUD عادی مجاز نیست. تأیید همان عملیات `CREATE OWNER STAGING` است.

Codex فقط خروجی‌های غیرمحرمانه را بررسی می‌کند: OWNER یکتا، status فعال، verifierهای جداگانهٔ Argon2id، PIN failure صفر، نبود lock، Audit موفق، checkpoint نهایی بدون pending، عدم ساخت هویت دوم و دسترسی‌های DB محدود. هیچ verifier، Username، Password، PIN، cookie یا token در گزارش درج نمی‌شود. خطای commit نامعلوم با checkpoint و receipt reconcile می‌شود؛ lock/checkpoint برای عبور حذف نمی‌شوند.

بلافاصله پس از enrollment، بکاپ مخصوص OWNER و کپی خارج سرور تکرار شود؛ بکاپ قبل enrollment شامل حساب جدید نیست. ابزار هر بار archive تازه می‌سازد؛ هیچ نسخهٔ قبلی برای عبور از gate بازنویسی نمی‌شود. فقط receipt حاصل از restore واقعی نصب می‌شود.

### ۳. ورود واقعی و تغییر Password/PIN

پس از پذیرش انتشار عمومی Staging، از مرورگر عادی و `https://admin.hambazi.top` استفاده شود؛ مرورگر اختصاصی قبلی با resolver mapping و تونل، اثبات دسترسی عمومی نیست. تا پیش از انتشار، روش خصوصی در [راهنمای استقرار خصوصی](admin-private-deployment-2026-10-26.md) معتبر است. اعتبارسنجی گواهی در هیچ‌کدام خاموش نمی‌شود.

1. مالک Username/Password را شخصاً وارد کند؛ مرحلهٔ PIN فقط بعد از تأیید Password ظاهر شود. پیش از PIN، نشست فقط PENDING و فاقد اختیار مدیریتی است.
2. فقط PIN صحیح وارد شود و Dashboard مشاهده شود. **روی حساب واقعی PIN اشتباه یا قفل عمدی آزمایش نشود.** توقف یا typo را بدون تکرار کور به Codex اعلام کنید؛ lock را با SQL یا reset دور نزنید.
3. برای سنجش revoke واقعی، دو context مرورگر مستقل، مثلاً پنجرهٔ اصلی و Incognito، با نشست‌های جدا باز شوند. دو tab هم‌پروفایل cookie مستقل ندارند.
4. از «امنیت حساب مالک»، Password با احراز مجدد فعلی تغییر کند. هر دو نشست قبلی باید نامعتبر شوند؛ context دوم پس از refresh باید login نشان دهد. ورود دوباره با Password جدید و PIN فعلی انجام شود.
5. طبق دستور نهایی مالک، PIN واقعی حفظ می‌شود؛ تغییر PIN، احراز مجدد، revoke و ورود با PIN جدید فقط روی fixture ایزوله آزمایش می‌شوند. رویداد واقعی `PIN_CHANGED` شرط پذیرش این حساب نیست.
6. Codex فقط Audit eventها، credential/session epoch، بی‌اعتباری نسخه‌ای نشست‌ها و صفر بودن counter/lock را بررسی می‌کند؛ screenshot، trace، network body، token یا ورودی مرورگر شخصی خوانده نمی‌شود. سناریوهای منفی، concurrency و lock سه‌تلاشی در fixture جدا باقی می‌مانند.
7. بکاپ متناظر Password جدید، کپی خارج سرور و restore-test با تأیید نهایی مالک تکمیل شدند؛ مسیر و receipt آن در بخش قبل ثبت است. vault تاریخچهٔ Password متناظر snapshotهای نگه‌داری‌شده را حفظ کند؛ retention عمومی/PITR در این کار تعیین نمی‌شود.

## تست‌های تازهٔ این نوبت

| تست                                 | نتیجه                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| API Admin unit/security             | ۴ فایل، ۳۴ موفق                                                                        |
| UI unit                             | دو موفق                                                                                |
| Typecheck API/Admin                 | هر دو موفق                                                                             |
| private root filesystem و TTY واقعی | هر دو موفق؛ منع echo/pipe/debug و مسیرهای خصوصی حفظ شد                                 |
| PostgreSQL/Redis Integration        | ۱۳ تست اصلی + چهار rehearsal موفق؛ شامل تغییر PIN فقط روی fixture ایزوله               |
| backup/restore fixture و CLI        | موفق؛ جای بکاپ واقعی را نمی‌گیرد                                                       |
| مرورگر Admin                        | شش موفق؛ ورود/PIN، RTL/accessibility، عدم public recovery، تغییر Password/PIN و revoke |
| قراردادهای API                      | همهٔ قراردادهای واقعی، شامل Admin، موفق                                                |
| Infra                               | ۲۱ فایل، ۱۹۲ موفق، دو skip موجود                                                       |
| Architecture/config/lint محدود      | موفق؛ architecture برای ۱۶ workspace و ۳۳۴ فایل، ۲۷۸ تست config و lint محدودهٔ Admin   |
| بکاپ واقعی OWNER و آزمون restore    | موفق؛ نسخهٔ پس از تغییر Password، hash برابر، restore ایزوله و receipt خصوصی ثبت شد    |
| Bootstrap و Login/rotation واقعی    | Bootstrap، ورود خصوصی/عمومی، تغییر Password و بی‌اعتباری چهار نشست قبلی موفق؛ PIN ثابت |

## حدود پذیرش

اسکن واقعی هفت image و Qualification Core/Admin در [گزارش اصلاح زیرساخت](../operations/postgres-libcurl-deployment-20261026.md) ثبت شده و controllerهای فعال مرجع اعتبار جاری‌اند. global CI یا `pnpm check` این نوبت سبز اعلام نمی‌شود؛ گزارش قبلی Web SSR و findingهای اسکن کل تاریخچه، نتیجهٔ scoped Admin نیستند. بررسی بدون افشای داده تأیید کرد مقدار ۴۰ نویسه‌ای finding قدیمیِ current metadata در `staging-test-user-current.json:1967` یک Git commit موجود در `roleSourceCommits/api` و مراجع provenance است، نه credential. هیچ suppression/ignore جدید یا تغییر scanner اعمال نشد؛ این triage به معنی سبزشدن خودکار اسکن کل history نیست.

معیارهای مصوب فاز یک در Staging تکمیل‌اند: OWNER یکتا و حفاظت‌شده، ورود واقعی عمومی با PIN، default-deny و guardهای Backend، revoke نسخه‌ای همهٔ نشست‌های قدیمی، تست تغییر PIN فقط ایزوله، Audit، بکاپ متناظر نسخهٔ جاری با restore واقعی و سلامت نهایی. مانع باقی‌مانده‌ای در محدودهٔ فاز یک مشاهده نشد. این پذیرش، سبزشدن CI سراسری، اثبات بار/soak فاز بهره‌برداری، RPO/PITR یا مجوز Production نیست. PIN ثابت همچنان MFA مستقل نیست؛ نگه‌داری کلیدها/عبارت بکاپ و پایش تمدید خودکار تعهد عملیاتی باقی می‌مانند.

[برنامهٔ فاز دو](admin-phase-2-execution-plan.md) برای بررسی آماده است؛ هیچ کد، migration، حساب، عملیات محصول یا استقرار آن آغاز نشده و شروعش به تأیید صریح جدید مالک نیاز دارد.
