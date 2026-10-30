# انتشار فاز سوم Admin روی Staging — 2026-10-30

**منتشرشده و سالم؛ QA خواندنی OWNER موفق است.** [شواهد مقصد](../security/admin-phase3-staging-deployment-2026-10-30.json) نتیجهٔ واقعی را ثبت می‌کند. آزمون زندهٔ نقش محدود و اجرای صریح ابطال نشست مدیر آزمایشی هنوز پذیرفته‌شده اعلام نمی‌شود؛ شمارندهٔ موفق `ADMIN_REVOKE_SESSIONS` پس از انتشار صفر است. این محدودیت با موفقیت محلی جایگزین نشده است.

## نسخه، داده و کنترل امنیتی

پنج ایمیج API، Bot، Worker، Web و Admin با digestهای مصوبِ متصل به commit تمیز `c7add7b` نصب شدند. تمام ۲۸ gate همان Qualification محلی موفق‌اند؛ کد برنامه پس از آن تغییر نکرده است. CI کامل یا GitHub Actions جدید در این عملیات ادعا نمی‌شود. PostgreSQL 18.6، Redis 8.10.2، شناسهٔ کانتینرها و volumeهای داده و Docker سرور حفظ شدند؛ pin 29.9.2 فقط محلی/CI است.

اسکن تازهٔ هر هفت ایمیج روی سرور، با دیتابیس رسمی به‌روزشدهٔ `2026-10-30T07:16:25Z` و ابزار با hash مصوب موفق شد: پنج برنامه صفر finding؛ PostgreSQL و Redis هرکدام یک MEDIUM و صفر HIGH/CRITICAL/UNKNOWN. source هر دو کنترلر، آستانه‌ها و freshness تغییر نکردند. renewal واقعی پس از نصب موفق و هر چهار timer فعال‌اند؛ deadline هر دو **2026-10-31T07:16:25Z، معادل ۱۰:۴۶:۲۵ تهران در ۳۱ اکتبر** از مسیر عادی به دست آمد. تضمین عبور از finding یا قطع feed آینده داده نمی‌شود.

Migrationهای افزایشی `202610280001_admin_private_notes` و `202610280002_user_restrictions` با migrator اجرا شدند؛ ۱۹→۲۱، checksum همهٔ نسخه‌ها، redeploy بدون pending و diff واقعی Prisma بدون drift موفق‌اند. پس از DDL/grant و پیش از راه‌اندازی writerها، شمارش و fingerprint تمام **۴۳ جدول قبلی به‌جز metadata Migration** برابر بود؛ فقط ستون nullable جدید در projection تطبیق حذف شد. grantهای محدود مصوب اعمال و timeout جستجو فقط روی نقش مستقل reader برابر ۲ ثانیه شد؛ برای این تنظیم نقش، operator خصوصی موجود استفاده شد و CREATEROLE به migrator یا برنامه‌ها داده نشد. منع دسترسی عملیات به هویت/hidden state، منع نوشتن reader و Audit append-only تأییدند.

OWNER همان یک حساب فعال با credentialVersion=2، sessionEpoch=2، authorizationVersion=1، PIN failures=0 و بدون lock است. Password/PIN و signing key، pepper، command key و DSNها تغییر نکردند؛ PASSWORD_CHANGED همان یک رویداد قبلی و PIN_CHANGED صفر است. چهار نشست نسل قدیم همچنان با نسخهٔ فعلی نامعتبرند؛ این به معنی revoked_at داشتن همهٔ آن‌ها نیست. ابزار Bootstrap/Recovery اجرا نشد و هیچ حساب پیش‌فرض یا مدیر آزمایشی جدیدی ساخته نشد.

## بکاپ و پنجرهٔ نصب

بکاپ اولیه و بکاپ نهایی تلاش قبلی، واقعاً خارج سرور بازیابی شده بودند. در اجرای نهایی، بکاپ تازهٔ **بدون writer** با hash `1039d8acb043bcc4d036bd7c0141e6b805204853b38780444f8fe6e76044ae92` تهیه شد؛ کپی خارج سرور و hash دو طرف تطبیق یافت و همان archive با ورود کلید فقط در ترمینال خصوصی مالک واقعاً بازیابی شد. دو دیتابیس و globals، همهٔ ۴۴ جدول، constraints/triggers/grants/settings و pg_amcheck تأیید شدند؛ capsule شامل ۸۱ فایل تنظیمات و کلید با binding معتبر بود. کلید خصوصی گیرنده روی سرور قرار نگرفت؛ plaintext در فایل/لاگ یا Git ذخیره نشد. PostgreSQL آزمایش `network=none`، بدون پورت و bind/volume واقعی بود و پاک شد. receipt همین نسخه پیش از DDL تطبیق یافت؛ receipt قدیمی جای این کنترل قرار نگرفت.

کپی رمزگذاری‌شده در `/home/mehdi/.local/share/hambazi/backups/staging/20261030-admin-phase3-r2-6fqogtxz/` و مدارک خصوصی در مسیرهای JSON نگه‌داری می‌شوند. snapshot هر دیتابیس مستقل است؛ ادعای snapshot اتمیک کل cluster، PITR/RPO یا retention جدید نداریم. backup قبلی فقط rehearsal اولیهٔ منقضی‌نشده بود؛ نقطهٔ بازگشت نهایی همین archive تازه است.

Maintenance نهایی از **۱۲:۲۷:۰۱ تا ۱۲:۳۱:۰۱ تهران، حدود ۴ دقیقه** طول کشید. ورودی عمومی با guard موجود بسته و writerها کنترل‌شده متوقف شدند. API، Worker، Web و سپس Bot با readiness واقعی راه افتادند؛ Admin از systemd و guard عادی `--admit` شروع شد. پس از native health، TLS سه pool Admin، renewal عادی و verifierها، Nginx با `nginx -t` قبل از reload بازگشایی شد. فقط دو GET محدودِ پروفایل/سوابق/محرومیت و private-note به allowlist قبلی اضافه شد؛ پورت Backend، Firewall، DNS و گواهی‌ها تغییر نکردند.

## تست مقصد و پذیرش

- Nginx، PostgreSQL، Redis، API، Bot، Worker، Web و Admin سالم‌اند؛ PING احرازشدهٔ Redis با TLS و کنترل peer موفق است. تمام Backendها و دو سرویس داده بدون پورت عمومی‌اند.
- **۲۴ کنترل HTTPS/API** موفق: Web/Login=200، APIهای محافظت‌شده و تمام مسیرهای جدید بدون نشست=401، POST بدون Origin/CSRF معتبر=403، Bootstrap/Recovery/Forgot/Reset عمومی=404 و نبود namespace Admin روی API بازیکنان. هیچ credential واقعی یا PIN اشتباه ارسال نشد؛ شمارندهٔ سه تلاش مالک آزمایش زنده نشد.
- Chromium ناشناس روی HTTPS معتبر، Login فارسی/RTL، فقط Username/Password در مرحلهٔ نخست، نبود PIN پیش از Password و نبود overflow در موبایل ۳۹۰ و دسکتاپ ۱۴۴۰ را تأیید کرد؛ screenshot/trace یا اطلاعات ورود دریافت نشد.
- مالک موفقیت ورود و جستجو، پروفایل، سوابق بازی و تب محرومیت‌ها را گزارش کرد. یک PASSWORD_VERIFIED و یک LOGIN_SUCCEEDED تازه پس از نصب نیز مستقل در Audit ثبت‌اند؛ مشاهدهٔ صفحات، گزارش مستقیم مالک است.
- `ADMIN_USER_RESTRICTIONS_ENABLED=false` طبق برنامهٔ مصوب حفظ شد. دیدن سوابق با ثبت محرومیت جدید متفاوت است؛ ban/unban، انقضا و ابطال توکن ناشی از محرومیت در fixture مصوب پوشش دارند و اثر زنده‌ای روی کاربر واقعی ایجاد نشد. تعداد restriction، note و عملیات UNKNOWN هنگام بررسی صفر است.

## توقف قبلی و اصلاح ابزار

تلاش اول پیش از اجرای DDL به خطای دسترسی خورد: کد Migration زیر پوشه‌های root/0700 و config/0600 برای UID1000 خوانا نبود. طبق برنامه توقف و بازگشت انجام شد؛ schema در ۱۹ ماند، داده restore نشد و فاز دوم در ۰۳:۴۵:۴۸ تهران دوباره سالم شد. در نخستین بازگشت، helper وضعیت قدیمی exited را حدود ۵۲ میلی‌ثانیه پیش از شروع واقعی Admin، شکست startup تشخیص داد و دوباره contain کرد. انتظار bounded موجود با همان ۹۰ ثانیه و الزام Running+healthy اصلاح شد؛ حالت خروج پایدار یا unhealthy موفق تلقی نمی‌شود و timeout محصول تغییر نکرد.

اصلاح نهایی فقط کد عمومیِ hash-شده را به directory=0755/file=0644 و engine=0755 نرمال کرد؛ ریشهٔ release همچنان 0700 و فایل credential همچنان 0600 و خارج از mount کد است. فایل config فقط ارجاع به environment دارد، نه مقدار secret. حالت‌های خطای file/parent/nested directory در کانتینر ایزوله بازتولید و پس از اصلاح Prisma واقعی با UID1000 موفق شد؛ همین validation روی مقصد **پیش از Maintenance** نیز موفق شد. guard بکاپ شش حالت نامعتبر را رد کرد؛ readiness پنج سناریو و انتظار native چهار سناریو را پوشش داد. بازگرداندن دقیق grantها و reader timeout نیز در PostgreSQL ایزوله آزمایش شد.

فقط دو مسیر admission موجود با مالک فایل 1000:1000/0600 و hash کنترلر به ابزار بکاپ افزوده شدند؛ mismatch مالک، mode، link یا hash همچنان رد می‌شود. انتقال digest-only نام ایمیج‌ها را حفظ نکرده بود؛ tagهای مصوب صرفاً به همان image IDهای تطبیق‌یافته بازمتصل شدند و image bytes تغییر نکردند. کمبود دیسک با حذف دو **کش عمومی منقضی و بدون استفاده** رفع شد؛ cache فعال، داده، backup و ایمیج‌های بازگشت حذف نشدند. خطای کمکی ثبت گزارش scan به PASS تبدیل نشد؛ اسکن واقعی مجدد، شواهد نهایی را تولید کرد.

## باقی‌مانده و بازگشت

QA زندهٔ authenticated 403 برای مدیر محدود و زنجیرهٔ OWNER_FINAL→ADMIN_REVOKE_SESSIONS→رد نشست قبلی هنوز گزارش/تطبیق نشده است؛ تست‌های محلی و چهار نشست قدیمی مالک جای آن را نمی‌گیرند. فعال‌سازی محرومیت و QA زندهٔ ban/unban نیازمند تصمیم مجاز جداگانه است. تست ظرفیت/Load/Stress/Soak برای سرور آینده باقی ماند؛ این انتشار تأیید Production یا آغاز فاز چهارم نیست.

فایل‌ها، code/imageهای قبلی و بکاپ رمزگذاری‌شده حفظ‌اند. rollback فقط با شواهد امنیتی معتبر و سازگاری schema/grants/jobs انجام می‌شود؛ down migration، حذف داده/Audit یا restore روی دیتابیس زنده مجاز نیست. پس از هر اثر محرومیت، API/Worker سازگار با enforcement/expiry/reconciliation باید حفظ شوند. [برنامهٔ انتشار/بازگشت](admin-phase-3-staging-release-plan.md) مرجع اجرایی است. Production و اطلاعات ورود OWNER دست‌نخورده ماندند.
