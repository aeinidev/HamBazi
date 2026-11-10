# استقرار اصلاحات موبایل پروفایل روی Staging

انتشار `profile-ux-20261110-b4e2e3fa` در `2026-11-10T08:38:35Z` فعال شد؛ سلامت نهایی در `2026-11-10T10:07:58Z` تأیید شد.

فقط شش فایل Web مربوط به کیبورد و Modal آواتار از workspace به snapshot نسخهٔ مستقرشده اضافه شدند. فقط کانتینر Web جایگزین شد؛ Image و شناسهٔ کانتینرهای API، Bot، Worker، Admin، PostgreSQL و Redis حفظ شدند. محدودیت دو کاربر، ingress و سیاست امنیتی تغییر نکردند. Production دست‌نخورده است.

- Image جدید: `hambazi-profile-ux/web:20261110-962afb12ddcef7c9@sha256:c5f8309c45c4a3030c2eb92668a1de2c1c4257492e9e712c77d53912adebc32b`.
- Image والد و بازگشت: `sha256:030d12df4f48cb6c0f6fcb7c9544ba51db7904408ffa0bd3ac2cde2cc8deea10`.
- Source snapshot: `c9899074fe200798b627435bb41c018988bc139376cf35119916ddfb10e2918d`.
- Build input: `962afb12ddcef7c9d0b837d581a2e2dfcf66a6e38f166f3e87eb82f0f85ff51c`.

## بکاپ و ایمنی

پس از drain و توقف نویسندگان Core/Admin، نبود Match فعال و اتصال نویسندهٔ دیگر تأیید شد. بکاپ تازهٔ رمز‌شده با اندازهٔ `124328086` بایت و SHA-256 زیر ساخته شد:

`f986a5c17309f8d5fe2dc9d95507b97782e4ef48ce6a84518bd0cfe4a9f2642d`

همان فایل با اندازه و checksum برابر به مسیر خصوصی زیر منتقل شد:

`/home/mehdi/.local/share/hambazi/backups/staging/profile-ux-20261110-b4e2e3fa/`

بازیابی واقعی در PostgreSQL جداشده، بدون شبکه، volume یا پورت عمومی انجام شد. هر دو دیتابیس، ۴۵ جدول، داده‌ها، ساختار، نقش‌ها، دسترسی‌ها و capsule تنظیمات/کلیدها تطبیق داده شدند؛ `pg_amcheck` و پاک‌سازی محیط آزمایش موفق بودند. رسید `restore.json` پیش از تغییر Compose دوباره روی سرور پذیرفته شد. هیچ داده‌ای روی سرور زنده restore یا rewind نشد.

Migration جدید لازم نبود؛ هر ۲۲ Migration قبلی و checksum فایل‌های آن‌ها بررسی شدند و صفر Migration ناموفق وجود داشت. هیچ فرمان Migration اجرا نشد. آرشیو بازگشت Web روی سرور با checksum و هر ۲۳ blob آن تأیید و حفظ شد؛ انتقال اولیهٔ این آرشیو به لپتاپ timeout شد و فایل ناقص استفاده نشد. این محدودیت شامل بکاپ دیتابیس/تنظیمات نیست که کامل خارج از سرور بازیابی شد.

## تأیید نسخه

- نصب offline با frozen lockfile، Build، Typecheck و ۱۴۹ تست واحد در snapshot جداشده موفق بودند. وابستگی build موتور برای fixture تست ابتدا ساخته نشده بود؛ پس از build همان وابستگی، کل مجموعه گذشت.
- ۵۶ تست Chromium/WebKit در مرحلهٔ پیاده‌سازی و ۱۴ تست UX روی snapshot انتشار گذشتند.
- اسکن شش Image فعلی، Image جدید و بازگشت با gateهای عادی امنیتی موفق بود؛ مدت اعتبار یا سیاست severity تمدید/تضعیف نشد. اسکن secret خروجی عمومی نیز گذشت.
- Image نهایی با کاربر nonroot، filesystem فقط‌خواندنی و بدون شبکه readiness سالم داشت. فایل‌های اصلی مجوز HEIF، MIME، `nosniff`، CSP، Brotli و cache headerها تأیید شدند.
- مرورگر زندهٔ Chromium و WebKit در عرض‌های ۳۲۰، ۳۹۰ و ۱۲۸۰ گذشت: کیبورد با viewport شبیه‌سازی‌شده، انتخاب هر ۱۰ آواتار، HEIF، drag/pinch، نبود اسلایدر، تطابق preview/export، قفل اسکرول و مدیریت پیش‌نویس. اطلاعات ذخیره‌شدهٔ حساب آزمایش تغییر نکرد.
- API احرازشده، username آزاد/نامعتبر و رد PATCH نامعتبر گذشتند. شناسهٔ خارج از فهرست با امضای معتبر از HTTPS با `401 UNAUTHENTICATED` رد شد؛ token صادر نشد و تعداد کاربران دو نفر ماند.
- صفر خطای JavaScript و نقض CSP مشاهده شد و credential در storage مرورگر باقی نماند. setup اولیهٔ تست زنده platform را `unknown` می‌داد؛ با استفاده از fragment واقعی راه‌اندازی SDK، همان تست بدون تغییر محصول گذشت.
- سلامت داخلی تمام سرویس‌ها، TLS عمومی، پاسخ ۲۰۰ Web/Admin، پاسخ ۴۰۱ پروفایل بدون احراز هویت، بسته‌بودن مسیرهای خصوصی و فعال‌بودن timerهای تمدید/انقضای امنیت و Certbot تأیید شدند. rollback لازم نشد.
- پس از همگام‌سازی پین Web در manifest و Compose مخزن، ۲۰۸ تست زیرساخت گذشت؛ سه تست اختیاری وابسته به `SECURITY_SCANNER_DIR` اجرا نشدند. اسکن واقعی Imageهای انتشار جداگانه روی سرور انجام و تأیید شده است.

تست native روی دستگاه واقعی Android/iOS Telegram انجام نشده است. هشدار شناخته‌شدهٔ اندازهٔ bundle/decoder HEIF باقی است. هیچ آزمون load/soak یا تغییر backend برای این انتشار انجام نشد.

شواهد خصوصی: `/opt/hambazi/releases/profile-ux-20261110-b4e2e3fa/` و `/home/mehdi/.cache/profile-ux-20261110-b4e2e3fa/`.
