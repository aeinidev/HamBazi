# برنامهٔ اجرایی فاز دو Admin — مجاز برای توسعهٔ محلی

**Status: Approved برای پیاده‌سازی و تست محلی، 2026-10-27؛ بدون مجوز استقرار.** پذیرش فاز اول و مجوز صریح شروع فاز دوم در همین گفتگو ثبت شده‌اند. ADR-085 ترتیب اجرای عملیات و ADR-086 سابقهٔ افزودن محروم‌سازی را ثبت می‌کند؛ دستور جدید مالک و ADR-087 فعال‌سازی آن را تا تصمیم فاز سوم متوقف می‌کنند. متن برنامهٔ اولیه در ادامه، مرجع ترتیب وابستگی‌هاست؛ بند انتظار مجوز شروع با این تصویب رفع شده است. این سند مطابق roadmap فاز ۲ در ADR-078/079/080 و بازنگری‌های Local Auth و Staging در ADR-081/083/084 است. مجوز فعلی شامل کدنویسی، Migration افزایشیِ اجرا‌نشده و تست‌های محلی است؛ فعال‌سازی روی سرور نیازمند تأیید جداگانه است. انتشار Public HTTPS فقط برای Admin محیط Staging در ادامهٔ فاز یک جداگانه مجاز شده؛ این برنامه مجوز تغییر ingress یا Production نمی‌دهد. Bootstrap/Recovery همچنان فقط SSH خصوصی هستند.

## ترتیب وابستگی‌ها

| گام                          | خروجی محدود                                                                                                                                                                                       | شرط پذیرش                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ۲٫۱ — قرارداد و مجوز عملیات  | فهرست operation/permission، scope محیط/بازی/بخش، schema و مالک application port؛ ADR فقط برای تصمیم واقعاً باز                                                                                    | پیش‌فرض deny برای غیرمالک، OWNER فقط برای قابلیت ثبت‌شده؛ هیچ مسیر ارتقا به OWNER یا دست‌کاری hidden state                                                                                                 |
| ۲٫۲ — مدیریت مدیران و نقش‌ها | ایجاد Username یکتا توسط OWNER، Password تصادفی دقیقاً ۱۲ نویسه با CSPRNG و حضور حروف بزرگ/کوچک/عدد، نمایش یک‌باره؛ reset مدیر عادی، فعال/غیرفعال/حذف منطقی، roleهای آماده/سفارشی، override محدود | فقط OWNER مدیریت هویت/نقش مدیران را انجام دهد؛ هیچ مدیر دیگری OWNER را تغییر ندهد؛ Password قبلی و همهٔ نشست‌ها بعد از reset نامعتبر شوند؛ هیچ ثبت‌نام، ایمیل/IdP یا Forgot Password برای OWNER اضافه نشود |
| ۲٫۳ — تأیید عمل حساس         | challenge متصل به operation/target/digest/revision/environment، reauth تازه، reason، expiry، مصرف یک‌بار؛ OWNER_FINAL برای مالک یگانه و DUAL_CONTROL برای غیرمالک                                 | خودتأییدی غیرمالک و replay رد؛ مالک بدون مدیر دوم عمل مجاز را تمام کند؛ تغییر payload یا epoch تأیید را باطل کند؛ Password+PIN ثابت ادعای MFA مستقل ندارد                                                  |
| ۲٫۴ — زیرساخت فرمان و Audit  | Idempotency-Key، وضعیت PENDING/SUCCEEDED/FAILED/UNKNOWN، receipt/outbox و reconciliation؛ Audit پذیرش و نتیجه                                                                                     | یک اثر منطقی در retry/crash، نتیجهٔ نامعلوم واقعاً UNKNOWN، outage Audit پیش از اثر مساوی صفر mutation؛ token/secret/hidden state وارد evidence نشود                                                       |
| ۲٫۵ — عملیات محصول مصوب      | availability بازی برای Match جدید، closure اتاق، termination محدود Match و settings مجاز؛ فقط از application port ماژول مالک                                                                      | guardهای state/expectedVersion و writer Match حفظ شوند؛ engine/ruleset فعال تغییر نکند؛ raceهای join/start/finish-vs-terminate آزموده شوند؛ termination Undo یا برد ساختگی ندارد                           |
| ۲٫۶ — UI و پذیرش             | صفحات فارسی RTL برای مدیران/نقش‌ها/نشست‌ها، request/approval/result و Audit؛ پیام خطا/انقضا/UNKNOWN روشن                                                                                          | E2E با Backend واقعی، IDOR/scope/CSRF و revoke حداکثر پنج ثانیه؛ نبود نشت PII خارج scope و عدم اتکا به مخفی‌کردن دکمه                                                                                      |

دعوت در صورت نیاز فقط به جریان داخلی ایجاد/تحویل امن حساب تبدیل می‌شود؛ سرویس ایمیل، ثبت‌نام عمومی یا اتصال هویتی خارجی در این تصمیم وارد نمی‌شود. رمز تولیدشدهٔ مدیر عادی فقط یک بار به OWNER نشان داده می‌شود و raw آن در Audit/DB/لاگ ذخیره نمی‌شود. reset خود OWNER یا ساخت OWNER دوم از هیچ API اضافه نمی‌شود.

## معماری و داده

Modular Monolith، `apps/admin` مستقل و listener/Auth/DB roleهای جدا حفظ می‌شوند. فرمان Admin از port مستند ماژول مالک عبور می‌کند؛ query مستقیم جدول‌های بازی یا import internal ممنوع است. PostgreSQL منبع حقیقت authorization و approval است؛ Redis فقط cache/rate limit/coordination است. تغییر grant/role باید روی نشست زنده با زمان مشخص و قابل‌آزمون اثر کند؛ برای اتصال موجود حداکثر پنج ثانیه، حتی با Redis unavailable، مطابق معماری پذیرفته‌شده.

جداول نقش/عضویت/override، challenge/approval و command/receipt فقط پس از تأیید اجرای فاز و با migration افزایشی و release overlap اضافه می‌شوند. session epoch، authorization version و ownership epoch جزئی از invalidation هستند. scope واقعی query و aggregate در Backend enforce می‌شود. مجوز عملیات جدید برای OWNER به‌صورت registry-based و برای سایر نقش‌ها فقط با grant صریح است؛ این اختیار هیچ auth، Audit، TLS، immutable evidence یا guard یکپارچگی بازی را حذف نمی‌کند.

سرویس جدید، Kafka، Kubernetes، warehouse یا Replica بدون شواهد نیاز اضافه نمی‌شود. queue/outbox/worker موجود تنها در صورت نیاز عملیات استفاده می‌شوند؛ گزارش‌های سنگین و بار بی‌حد وارد request بازی نمی‌شوند.

## ایمنی و تست

ابتدا fixtureهای role/permission و escalation، deny precedence، scope و revocation با DB/Redis واقعی نوشته می‌شوند. سپس challenge replay/expiry، self-approval غیرمالک، OWNER_FINAL، Audit rollback و crash/idempotency بررسی می‌شوند. برای game operation از engine fixture و application writer استفاده می‌شود؛ دادهٔ بازی Staging برای تست مخرب تغییر نمی‌کند. UI ابتدا با fixture و سپس با E2E کنترل‌شدهٔ Backend واقعی آزموده می‌شود.

پیش از نصب Staging هر بسته، image/dependency/secret scan، contract diff، migration compatibility، بکاپ معتبر، سلامت قبل/بعد و برنامهٔ بازگشت لازم‌اند. عملیات برگشت‌ناپذیر UI باید اثر و نبود Undo را صریح نشان دهد. rollback فقط admission/settings قابل‌برگشت را برمی‌گرداند؛ Match پایان‌یافته، تاریخچه یا آمار با SQL معکوس جعل نمی‌شوند.

## معیار پایان و تصمیم‌های باقی‌مانده

AC-01…AC-22 مرتبط باید با شواهد trace شوند: حفاظت root، اختیارات نقش/override، scope، revoke، یک اثر در retry، Audit failure، OWNER_FINAL و مرزهای Match. تعریف workload همزمان Admin و بودجهٔ query/latency پیش از پذیرش تداخل عملیات محصول تعیین شود؛ اعداد load/SLO حدس زده نمی‌شوند. آزمون بهره‌برداری عمومی و soak بلندمدت متعلق به gate مربوط خود هستند و موفقیت فاز دو جای آن‌ها نیست.

moderation محتوایی، پشتیبانی، آمار پیشرفته، امور مالی، ربات مدیران، Public Admin و Production خارج از این بسته‌اند. پس از گزارش نهایی فاز دو، کار متوقف و برای فاز بعد مجوز جدا دریافت می‌شود. مجوز صریح توسعهٔ محلی فاز دو دریافت شده است؛ این مجوز، نصب یا فعال‌سازی روی سرور و شروع فاز سه را شامل نمی‌شود.

## بازنگری محدودهٔ تصویب‌شده در 2026-10-27

مالک محروم‌سازی/رفع محرومیت کاربران را نیز صریحاً به این فاز افزود؛ این استثنای OD-005 ابتدا مطابق ADR-086 توسعه یافت، اما با دستور جدید مالک و ADR-087 اجازهٔ فعال‌سازی آن پس گرفته شد؛ ban/unban در UI، application، runtime و grant دیتابیس فاز دوم بسته است. نقش‌ها/مدیران، نام نمایشی کاربر (بدون تغییر وضعیت)، gate پذیرش بازی، بستن اتاق پیش از شروع و termination محدود Match در بستهٔ محلی قرار دارند. setting ثبت‌شدهٔ فعلی فقط gate پذیرش است؛ تنظیمات دلخواه و Feature Flag منتشرنشده، گزارش محتوایی و پشتیبانی وارد نمی‌شوند. وضعیت آزمون و gateهای استقرار در گزارش فاز دوم ثبت می‌شود. استقرار روی Staging/Production هنوز مجوز ندارد.
