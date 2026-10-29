# آمادگی انتشار فاز سوم Admin روی Staging

تاریخ بررسی: 2026-10-29. **انتشار NO-GO است: Qualification کامل نشده و دیسک محلی خطای I/O دارد.** مرجع جاری [checkpoint مستند](../security/admin-phase3-recovery-checkpoint.json) است؛ گزارش‌های قبلی تاریخی‌اند و مجوز نصب نیستند. اسکن نهایی تاریخچه/candidate و بررسی formatting/diff همین checkpoint نیز موفق‌اند؛ این‌ها جای Qualification کامل نیستند.

## نتیجهٔ تکمیل‌شده

- commit کد `a9dbf14a852f2b47ace78f5e793fe0df0046e2db`: پنج timeout قبلی با حفظ workload، assertionها و حدود زمان رفع و هر **۳۰۶ تست Backend و شش سناریوی release مرورگر در همان اجرای یکپارچه** موفق شدند. Database=۱۸، API=۲۶۳، Worker=۲۵؛ deploy/redeploy، restart و بازیابی منطقی تمام ۴۵ جدول نیز موفق‌اند.
- علت‌ها شامل fixture ترتیبی نزدیک مهلت، تأخیر fsync دیسک USB و قفل writer سراسری در recovery اتاق بودند. fixtureهای مستقل در همان test موازی، داده روی دیسک پایدار و خصوصی runner، snapshot اتاق Serializable/READ ONLY و projection خصوصی Match یک SELECT محدود شدند؛ fsync و تمام کنترل‌های lock/version/مالکیت حفظ‌اند. probe واقعی آمادگی و jitter محدود پس از rollback اضافه شد؛ پنج تلاش قبلی تغییر نکرد. [ADR-092](../adr/092-durable-fixtures-and-read-only-room-recovery.md) جزئیات و محدودیت‌ها را ثبت می‌کند.
- گراف quality همان typecheck/test/build را یک بار در گراف اجباری Turbo اجرا می‌کند؛ Infra، concurrency=1 و همهٔ مهلت‌ها حفظ‌اند. دو اشکال مستقل مرورگر نیز با تست ابتدا ناموفق/سپس موفق رفع شدند: گم‌شدن invalidation حین catchup و باقی‌ماندن intent پس از رد قطعی `GAME_STATE_CONFLICT`. retry مبهم شبکه همچنان همان شناسه و body را حفظ می‌کند؛ اقدام تازه انتخاب صریح کاربر می‌خواهد.
- طبق تأیید صریح مالک، workflow/toolchain و آزمون‌های منفی به pin دقیق **Docker 29.9.2** هماهنگ شدند؛ [ADR-041](../adr/041-ci-trust-and-evidence.md) به‌روز است. هیچ daemon یا سروری توسط این کار ارتقا نیافت.
- CI واقعی روی checkout تمیزِ دارای تاریخچهٔ کامل و بدون `.env` از **۲۰ gate**، شامل quality، قراردادها، secret/dependency scan، Admin integration/private/ingress/browser و scan پایه، عبور کرد؛ در `application-image-build` متوقف شد. **CI موفق نیست و manifest موفق صادر نشده است.** اجرای GitHub Actions میزبانی‌شده انجام نشده است.
- تصویر دقیق Redis ثبت‌شدهٔ Staging با inspect/export فقط‌خواندنی دریافت و تطبیق داده شد: `a2b331…`، نسخهٔ 8.10.2. هر هفت تصویر baseline و rollback مشروط با advisory تازه هنگام scan، HIGH/CRITICAL/UNKNOWN صفر داشتند؛ بعضی شدت‌های پایین‌تر صفر نیستند. **ناسازگاری Redis اثبات نشد؛ اجرای کامل نهایی با همان تصویر هنوز باقی است.** اطلاعات دیتابیس/OWNER خوانده یا تغییر نکرد.
- آزمون مستقل انتقال PostgreSQL پس از تغییر fixture موفق است. برنامهٔ full backup رمزگذاری‌شده، capsule کلید/تنظیمات، کپی خارج سرور، بازیابی همان archive و Rollback سازگار آماده است؛ بکاپ واقعی تازه در این کار انجام نشده است.

## مانع محلی و حفظ تغییرات

kernel قطع USB، خطاهای I/O، خطای ext4 و abort journal را ثبت کرد؛ mount دیسک `/mnt/LinuxExternal` با `emergency_ro,shutdown` دیده شد. این دیسک هم مخزن اصلی و هم دادهٔ Docker را نگه می‌دارد. ادامهٔ نوشتن/ساخت امن نیست. علت فیزیکی قطع USB تعیین نشده است؛ هیچ fsck، remount، repair، restart یا تغییر تنظیمات دیسک/daemon برای دورزدن این وضعیت انجام نشد.

پنج commit کد در کپی مستقل دیسک داخلی حفظ شدند؛ `git fsck --full --no-reflogs` بدون missing/corrupt object موفق و bundle تاریخچهٔ کامل ساخته و verify شد. dangling objectهای تاریخی به معنی خرابی نیستند. این گزارش فقط در شاخهٔ `codex/phase3-storage-recovery` کپی داخلی ثبت می‌شود:

`/home/mehdi/.cache/hambazi-docker2982-ckt22qp8/source`

bundle کد: `/home/mehdi/.cache/hambazi-phase3-fix-tmsnjmzv/phase3-code-preserved.bundle`. روی مخزن خارجی پس از خطای I/O نوشته نشد. این bundle بکاپ اطلاعات واقعی سرور یا OWNER نیست. یک ساخت تشخیصی به اشتباه با تصور توقف زود خاتمه یافت؛ اجرای مجدد نیز کامل نشد. هیچ‌کدام PASS یا اثبات نهایی سازگاری BuildKit محسوب نمی‌شوند.

## مراحل باقی‌مانده

1. سلامت و اتصال پایدار دیسک/فایل‌سیستم محلی توسط مالک بررسی شود؛ تا آن زمان نوشتن روی مخزن اصلی و Docker data-root متوقف بماند. اصالت commitها و سلامت مخزن اصلی پس از دسترسی پایدار دوباره بررسی شوند.
2. روی محیط سالم، Build/Scan تمام artifactهای نهایی، CI واقعیِ هر ۲۸ gate و اجرای کامل با Redis دقیق `a2b331…` و PostgreSQL `7de…` تکمیل شوند. freshness و binding کد/ایمیج دوباره احراز شود. اسکن قدیمی یا نتیجهٔ جزئی جای این کنترل‌ها نیست؛ [ADR-091](../adr/091-proposed-phase3-staging-timeout-risk.md) هرگز تصویب یا استفاده نشده است.
3. فقط پس از تأیید جداگانهٔ استقرار، [برنامهٔ انتشار](admin-phase-3-staging-release-plan.md) اجرا شود: full backup واقعی تازه و capsule رمزگذاری‌شده، کپی خارج سرور و بازیابی واقعی همان archive با receipt منطبق، سلامت همهٔ سرویس‌های مقصد، config/grants/OWNER metadata، advisory/deadline معتبر و سازگاری بارگذاری ایمیج روی daemon فعلیِ بدون تغییر Staging. PIN/Password واقعی در اختیار عامل قرار نگیرد.
4. Rollback پس از هر اثر محرومیت باید API/Worker سازگار با enforcement، expiry و reconciliation را حفظ کند؛ flag=false فقط عملیات جدید را می‌بندد. حذف داده/Audit، down migration یا restore روی DB زنده مجاز نیست.

**انجام نشده:** تغییر Staging/Production/حساب واقعی OWNER، نصب، بکاپ واقعی تازه و سلامت زندهٔ تمام سرویس‌ها، پذیرش ظرفیت/Load/Stress/Soak و فاز چهارم. انتشار همچنان تأیید مستقل می‌خواهد؛ هیچ استثنای امنیتی یا افزایش timeout استفاده نشده است.
