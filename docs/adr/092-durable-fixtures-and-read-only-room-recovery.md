# ADR-092 — دوام fixtureها و snapshot فقط‌خواندنی برای recovery اتاق

- **Status:** Accepted برای اصلاح و آزمون محلی؛ مجوز استقرار نیست.
- **Owner:** مالک HamBazi
- **Date:** 2026-10-29
- **Supersedes:** هیچ‌کدام؛ حفاظت writerها، RBAC، OWNER، Audit و سیاست‌های CI حفظ می‌شوند.
- **Related:** [ADR-091](091-proposed-phase3-staging-timeout-risk.md)، [راهنمای CI](../operations/ci.md).

## Context

مهلت ۵۰۰۰ms پنج آزمون هم‌زمانی، ساخت و بررسی fixtureها را نیز شامل می‌شود. Docker این رایانه داده را روی دیسک USB نگه می‌داشت؛ آزمون کوچک `pg_test_fsync` برای fdatasync حدود ۲۲–۳۳ms روی آن و حدود ۱٫۶ms روی دیسک داخلی نشان داد. اجرای native قبلی روی tmpfs، شاهد کافی برای دوام Docker نبود. زمان‌سنجی fixtureهای ترتیبی نیز حدود ۴٫۹s برای شش اتاق خصوصی و ۴٫۷s برای آماده‌سازی هشت گروه Presence ثبت کرد. این اعداد پذیرش ظرفیت نیستند.

علاوه بر I/O و orchestration تست، `Rooms.startSnapshot` از مسیر عمومی `read/current` استفاده می‌کرد؛ این مسیر برای انقضای اتاق می‌تواند بنویسد و قفل سراسری Room می‌گیرد. در نتیجه خواندن recovery هشت اتاق مستقل هم سری می‌شد. ایجاد هم‌زمان Matchهای خصوصی نیز می‌تواند روی predicate pageهای Serializable رقابت کند؛ تکرار فوری retryها این رقابت را تشدید می‌کرد.

## Decision

1. fixture PostgreSQL داخل پوشهٔ تازه و خصوصی روی دیسک runner ایجاد می‌شود؛ tmpfs/ramfs، alias، مسیر مشترک و دادهٔ ازپیش‌موجود پذیرفته نیست. fsync، synchronous_commit و full_page_writes روشن‌اند. فقط دادهٔ همان fixture، پس از توقف کانتینر، پاک می‌شود؛ daemon و volumeهای موجود تغییر نمی‌کنند.
2. تعداد Match، subscription، موج و درخواست‌های سناریوی هدف و assertionهای رفتاری و تمام مهلت‌های موجود حفظ می‌شوند. کار مستقلِ آماده‌سازی و بررسی/بستن نشست‌ها داخل همان test هم‌زمان اجرا می‌شود؛ کار domain از محدودهٔ test خارج نمی‌شود. hook موجود اتصال، probe واقعی همان connectionها را نیز پیش از اعلام آمادگی اجرا می‌کند. خواندن فقط id/status در fixture به‌جای واکشی چندبارهٔ تمام events/commands/outbox انجام می‌شود؛ مقایسهٔ کامل پیش/پس از workload حفظ است. Userهای fixture با همان فیلدهای ACTIVE روش قبلی، مطابق سایر تست‌های Match، یکجا seed می‌شوند؛ UserIdentity و کنترل‌های واقعی Room/Match همچنان اجرا می‌شوند و تست‌های ساخت حساب جداگانه حفظ می‌شوند.
3. `Database.forModule(...).snapshot` یک تراکنش **Serializable + READ ONLY** واقعی PostgreSQL است، با همان دامنهٔ مالکیت و بدون raw SQL عمومی. mode به connection بعدی نشت نمی‌کند. این مسیر اجازهٔ نوشتن یا قفل writer نمی‌دهد.
4. فقط `RoomsRepository.startSnapshot` از این مسیر استفاده می‌کند. projection و اعتبارسنجی schema/ظرفیت/host/roster حفظ می‌شوند. `STARTING/STARTED/CLOSED` به انقضای lazy نیاز ندارند؛ وضعیت‌های دیگر در application همچنان رد می‌شوند. مسیر عادی read و همهٔ commandها، انقضا، lock و کنترل version قبلی را حفظ می‌کنند.
5. snapshot یک نقطهٔ committed و سازگار را نشان می‌دهد، نه تضمین «جدیدترین وضعیت در آینده». اعتبار عملیات نوشتن همچنان زیر lock و با expectedVersion نزد مالک داده بررسی می‌شود. cache یا TTL جای خواندن تازه را نمی‌گیرد؛ قفل Match در resync و کنترل نقش حذف نمی‌شوند.
6. retry رقابت خصوصی، الگوی موجود Rooms را دنبال می‌کند: jitter محدود فقط پس از rollback، پنج تلاش قبلی، حداکثر چهار انتظار مجموعاً ۱۵۰–۳۰۰ms. خطای مبهم اتصال/commit retry نمی‌شود. هیچ Timeout افزایش نمی‌یابد.
7. fixture گرهٔ Presence پیش از اعلام آمادگی، probe و بررسی واقعی membership را اجرا می‌کند؛ هر دو گره پیش از اتصال client آماده می‌شوند. زمان‌های lease و heartbeat و سناریوی SIGKILL تغییر نمی‌کنند.
8. در `advance`، binding اولیهٔ همان فراخوانی فقط پس از transition یا conflict دوباره خوانده می‌شود. اعتبارسنجی provenance و کنترل locked expectedVersion حفظ می‌شوند؛ cache مشترک یا حذف کنترل تازهٔ Room ایجاد نمی‌شود.
9. projection خصوصی Match و readiness اعضا با یک SELECT پارامتری و ثابت، فقط در scope مالک Matches و بدون state مخفی، خوانده می‌شود. یک statement، snapshot سازگار همان نقطه را می‌دهد؛ حداکثر ۶۵ سطر برای تشخیص roster نامعتبر محدود است. مسیر create همچنان در تراکنش Serializable قبلی اجرا می‌شود و mutationها lock/version قبلی را حفظ می‌کنند.

10. `check` همان format/lint/boundary/typecheck/test/build/contracts را حفظ می‌کند؛ typecheck، test و build در یک گراف Turbo اجرا می‌شوند تا وابستگی‌های مشترک در invocationهای جدا و اجباری چند بار تکرار نشوند. تست‌های Infra جداگانه حفظ‌اند. `TURBO_FORCE=true`، concurrency=1، گیت‌های ۲۸گانه و تمام مهلت‌ها ثابت می‌مانند.

11. مانع مرورگر release یک race جدا در Realtime را آشکار کرد: `sync` هم‌زمان زود برمی‌گشت، invalidation میان یک read گم می‌شد و cursor می‌توانست gap مشاهده‌شده را با snapshot قدیمی پاک کند. cursor بالاترین seq مشاهده‌شده را حفظ می‌کند؛ snapshot دارای gap وارد UI نمی‌شود. syncها Promise مشترک و حداکثر دو read در هر نوبت دارند؛ در عقب‌ماندگی پایدار fail-closed و retry صریح مجاز است. timeout هر request، lease/heartbeat، احراز هویت، نقش، schema و action ID تغییر نمی‌کنند. completion اتصال قبلی مجوز تغییر وضعیت اتصال جدید ندارد. دو تست بازتولید ابتدا FAIL و پس از اصلاح موفق شدند؛ کنترل محدودبودن retry و قطع/اتصال دوباره نیز افزوده شد. این اصلاح برای ordinary/personal/Kahroba از همان transport مشترک استفاده می‌کند و سرویس جدید ندارد.

12. تشخیص scalar-only اجرای یکپارچه نشان داد پس از `GAME_STATE_CONFLICT` قطعی، view تازه ACTIVE/PLAYER و اقدام مجاز بود ولی intent قدیمی با `retryable=true` UI را مسدود نگه می‌داشت. در چرخهٔ فرمان Coup و Kahroba، این رد قطعی پس از sync برای **همان intent** terminal است؛ اقدام تازه فقط با snapshot/شناسهٔ تازه و انتخاب صریح کاربر ساخته می‌شود. خطای مبهم شبکه همچنان دقیقاً همان action ID و body را برای بررسی نتیجه نگه می‌دارد. قرارداد خطا و version guard Backend تغییر نمی‌کنند. تست مرورگرِ conflict قطعی و تست lifecycle ابتدا روی رفتار قبلی FAIL و پس از اصلاح PASS شدند؛ هیچ test/timeout قبلی حذف یا تضعیف نشد.

## Alternatives

- افزایش Timeout، کاهش fixture/موج، skip، خاموش‌کردن fsync یا پذیرش tmpfs: با الزامات این کار سازگار نیستند.
- انتقال دادهٔ کل daemon یا تعویض سرویس دادهٔ Staging: لازم نیست و خارج از مجوز است.
- snapshot با isolation ضعیف‌تر، cache مجوز/roster یا حذف lock writer: تضمین‌های فعلی را حفظ نمی‌کند.

## Consequences

سطح داخلی Database و repository اتاق به‌صورت additive توسعه می‌یابد؛ Migration، سرویس و API عمومی تازه لازم نیست. آزمون واقعی دو connection باید ثبات snapshot هنگام commit هم‌زمان، رد UPDATE حتی با نقش دارای مجوز نوشتن، و قابلیت نوشتن پس از پایان snapshot را ثابت کند. آزمون‌های retry، مالکیت/پاک‌سازی fixture و کل suiteهای قبلی لازم‌اند؛ موفقیت جزئی CI موفق نیست. ظرفیت، سلامت زنده، بکاپ واقعی، مجوز انتشار و فاز چهارم از این تصمیم نتیجه‌گیری نمی‌شوند.

## Validation checkpoint — 2026-10-29

[شواهد جاری](../security/admin-phase3-recovery-checkpoint.json): هر ۳۰۶ تست Backend و شش release browser در همان اجرای یکپارچه موفق شدند؛ تست‌های بازتولید catchup/intent قبل از اصلاح FAIL و بعد PASS بودند. CI فقط ۲۰ gate را تکمیل کرد و موفق نیست. قطع USB و خطای ext4 روی دیسک مخزن/Docker ادامهٔ Build/Qualification را متوقف کرد؛ حفظ commitها در کپی مستقل و bundle تأیید شد. کنترل‌ها و حدود زمان تغییر نکرده‌اند؛ این نتیجه مجوز استقرار یا پذیرش ظرفیت نیست.
