# آمادگی انتشار فاز سوم Admin روی Staging

تاریخ بررسی: 2026-10-28. مرجع معماری ADR-090 است. این کار فقط آماده‌سازی محلی است؛ نصب، اتصال به Staging/Production، تغییر OWNER و شروع فاز چهارم مجاز نیستند. نتیجهٔ نهایی کنترل‌ها در `docs/security/admin-phase3-release-qualification.json` ثبت می‌شود؛ این سند به‌تنهایی مجوز نصب نیست.

## نتیجهٔ نهایی محلی

نسخهٔ عملکردی محلی آزموده شده، اما **انتشار هنوز مسدود است**: اجرای رسمی CI در preflight نسخهٔ Docker متوقف شد (`29.8.2` محلی در برابر `29.8.1` مصوب). همچنین سورس فاز سوم هنوز commit‌نشده است؛ evidence رسمی CI به source تمیز و بازبینی‌شده نیاز دارد. pin یا شرط clean-source برای عبور تغییر نکرد؛ گزارش محلی به‌عنوان CI موفق معرفی نمی‌شود.

| کنترل                       | نتیجه                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build و Scan نهایی          | API، Bot، Worker، Web، Admin و PostgreSQL/Redis: هفت ایمیج ثابت، HIGH/CRITICAL/UNKNOWN صفر؛ دیتابیس advisory تازهٔ 2026-10-28                                                                                                  |
| `pnpm check`                | موفق: format، lint، مرز معماری، typecheck، تست‌ها، Build و قراردادها؛ ۲۴۲۶ تست ثبت‌شده                                                                                                                                         |
| Admin Integration           | ۴۰ تست موفق؛ هویت/TLS=۱۳، فاز دوم=۹، فاز سوم=۱۴، Backup/Restore OWNER ساختگی=۴؛ دو مجموعهٔ مرورگر واقعی نیز در همین harness اجرا شدند                                                                                          |
| اجرای ایمیج واقعی           | سرویس‌های اصلی: ۴۶ کنترل و دو سناریوی مرورگر؛ Admin: ۳۸ کنترل با NODE_ENV=production و TLS معتبر PostgreSQL/Redis/HTTPS، Argon2 بومی UID=1000، رد plaintext، ورود OWNER ساختگی، PENDING بدون اختیار، CSRF، محرومیت/رفع و Audit |
| عملکرد گسترده و Migration   | ۳۰۵ تست دیتابیس/Integration و شش سناریوی مرورگر؛ drift صفر، deploy/redeploy و restart موفق، بازیابی منطقی ۴۵ جدول؛ ارتقای SQL دارای داده از ۱۹ به ۲۱ Migration و حفظ کاربر/OWNER/Audit ساختگی نیز جداگانه موفق                 |
| Backup کامل رمزگذاری‌شده    | CMS/AES-256-GCM با کلید صرفاً ساختگی؛ رد فایل دستکاری‌شده پیش از restore، بازیابی واقعی ۴۵ جدول و globals/هر دو دیتابیس در container بدون شبکه/port/host-volume؛ تطبیق داده، ساختار، trigger و grants و بررسی یکپارچگی موفق    |
| مرورگرهای مستقل و مرز ورودی | Admin=۷، Web=۳۰، SDK=۳۸ (شامل همان ۳۰ و هشت مورد اضافه)، Preview=۲؛ چهار تست Nginx و تست‌های خصوصی PTY/root موفق؛ دو مورد real-only Admin در harness واقعی اجرا شدند                                                           |
| Supply chain                | اسکن کامل تاریخچه/candidate و ممیزی وابستگی‌ها موفق؛ ۱۹۸ تست infra با scanner واقعی، شامل canary credential تازه، موفق؛ هیچ استثنا یا suppression جدید                                                                         |

fallback همان digest فاز سوم با flag=false واقعاً اجرا شد: نشست معتبر باقی ماند، محرومیت موجود حفظ شد و نوشتن تازه 403 گرفت. انقضای همان محرومیت با کد ایمیج و clock تزریق‌شدهٔ fixture و نقش API تأیید شد؛ ساعت سیستم تغییر نکرد. هیچ downgrade مخرب، حذف Audit یا بازیابی روی دادهٔ واقعی انجام نشد.

خطاهای اجرای تشخیصی پنهان نشده‌اند: در اجراهای هم‌زمان با Build، تأخیر راه‌اندازی/timeout تست دیتابیس رخ داد و دو مرورگر مستقل روی پورت مشترک برخورد کردند؛ اجرای سری با همان حدود زمان و assertions عبور کرد. یک canary native در اجرای جامع به timeout سی‌ثانیه‌ای رسید؛ هر ۱۹۸ تست infra مستقل و همان canary بدون تغییر timeout عبور کردند و سپس `pnpm check` با cache معتبر taskهای موفق Turbo مجدداً عبور کرد. اسکن Secret و infra خارج از cache دوباره اجرا شدند. اختلاف واقعی Schema با اصلاح مدل Prisma رفع شد، نه تغییر Migration یا سست‌کردن drift gate.

digestها، source snapshot، sourceDirty=true، هویت toolchain، نتیجهٔ هر gate و عدم تغییر ۴۵۰ فایل runtime در گزارش JSON ثبت شده‌اند. bytes بستهٔ client Admin نیز با Build محلی نهایی تطابق دارند. اصلاحات بعد از snapshot فقط مستندات/evidence هستند. ابزارهای rehearsal و artifactهای ثابت در پوشهٔ خصوصیِ درج‌شده در گزارش نگه‌داری می‌شوند؛ آرشیو و کلید ساختگی Backup پس از restore پاک شدند. این اثبات محلی جای بکاپ واقعی تازه و restore خارج سرور در مراسم انتشار آینده را نمی‌گیرد.

## اصلاح کشف‌شده در Qualification

آزمون واقعی `prisma migrate diff --exit-code` اختلاف کلید خارجی `user_restrictions.user_id` را آشکار کرد: Migration از `ON UPDATE NO ACTION` استفاده می‌کرد و مدل Prisma مقدار ضمنی `CASCADE` داشت. مدل با `onUpdate: NoAction` صریح با SQL هماهنگ شد. Migration یا داده‌ای بازنویسی نشد. آزمون drift، deploy مجدد و Integration باید برای همین نسخه عبور کنند.

## پیش‌شرط‌های انتشار آینده

1. تأیید جداگانهٔ Staging؛ ثبت snapshot کد، digest ایمیج‌های API/Bot/Worker/Web/Admin و هویت PostgreSQL/Redis. اسکن تمام این ایمیج‌ها با دیتابیس advisory تازه، بدون HIGH/CRITICAL/UNKNOWN مسدودکننده، باید به همین digestها متصل باشد. شواهد قدیمی یا ایمیج اولیهٔ قبل از اصلاح Schema معتبرِ نسخهٔ نهایی نیستند.
2. Qualification مصوب با toolchain دقیق و source review‌شده. نسخهٔ Docker این رایانه `29.8.2` است؛ `infra/ci/toolchain.json` برای CI نسخهٔ `29.8.1` را الزام می‌کند. شرط CI یا فایل toolchain برای عبور تغییر نمی‌کند. گزارش محلی جای evidence رسمی CI با source تمیز را نمی‌گیرد؛ candidate با `sourceDirty=true` صادقانه ثبت می‌شود.
3. پیش‌بررسی فقط پس از مجوز نصب: فضای آزاد، سلامت PostgreSQL/Redis/Nginx/API/Bot/Worker/Web/Admin، گواهی و timerها، digest فعلی، grantها و اعتبار deadline امنیتی. این بررسی‌ها در آماده‌سازی محلی انجام نمی‌شوند و هیچ مهلتی تمدید نمی‌شود.

## بکاپ و بازیابی

- پیش از Maintenance، بکاپ **کامل و تازهٔ PostgreSQL** لازم است: همهٔ دیتابیس‌های غیر template، globals/roleها، schema، grants و تنظیمات نقش در دیتابیس؛ به‌ویژه users، user_restrictions، user_admin_effects، admin_operations و تمام Audit. بکاپ نه‌جدولی OWNER مکمل است و جای بکاپ کامل را نمی‌گیرد.
- از مسیر خصوصی full-backup آزموده‌شدهٔ انتشار قبلی استفاده شود: snapshot سازگار هر دیتابیس، `pg_dump` قالب custom، globals و CMS با AES-256-GCM و گواهی گیرندهٔ تأییدشده. private key و عبارت رمزگذاری فقط در اختیار مالک و خارج سرور بمانند؛ ورود تعاملی فقط در ترمینال خصوصی و بدون ضبط انجام شود. کلید واقعی یا Passphrase در Build، env اجرایی تست، چت یا Git دریافت نمی‌شود.
- archive رمزگذاری‌شده خارج سرور کپی و SHA-256 دو طرف تطبیق داده شود. صرف تطابق هش، بازیابی معتبر محسوب نمی‌شود. همان archive پس از احراز صحت AEAD، در PostgreSQL disposable با `network=none`، بدون port عمومی و بدون mount دادهٔ میزبان بازیابی شود؛ rows/digests، constraints، triggers، grants، ownership و کنترل یکپارچگی مقایسه شوند. شکست decrypt/restore/reconcile، نصب را متوقف می‌کند.
- کلید `ADMIN_COMMAND_KEY` برای توضیحات محرمانه، همراه با realm و نسخهٔ کد، در vault یا بکاپ رمزگذاری‌شدهٔ مستقل حفظ شود. DB dump بدون این کلید برای بازیابی متن محرمانه کافی نیست؛ چرخش خام کلید مجاز نیست. کلیدهای امضای نشست، PIN pepper، تنظیمات خصوصی و checkpoint OWNER نیز باید طبق runbook فعلی قابل بازیابی باشند.
- نسخهٔ ابزار خصوصی Backup/Restore نیز باید با `admin-local-identity+private-notes-v3` سازگار باشد؛ آن را پیش از مراسم بکاپ/بازیابی انتشار آینده و بدون اجرای Bootstrap/Recovery یا تغییر checkpoint/credential مالک تطبیق دهید. تست نه‌جدولی OWNER با schema جدید جدا از تست full backup لازم است.
- تست‌های این آماده‌سازی فقط داده و کلید **ساختگی** دارند. هیچ رسید محلی به‌عنوان اثبات بکاپ تازهٔ واقعی یا کپی خارج سرور گزارش نمی‌شود. انجام بکاپ و بازیابی واقعی همان نسخه، gate انسانی انتشار آینده باقی می‌ماند.

## نصب آینده و کنترل پذیرش

با مجوز جداگانه، mutationهای Admin در Maintenance بسته و flag محرومیت خاموش بماند؛ migrationهای additive `202610280001_admin_private_notes` و `202610280002_user_restrictions` با migrator اعمال و سپس grants فاز سوم جداگانه اعمال شوند. timeout دوثانیه‌ای reader فقط در دیتابیس مقصد برقرار شود. از grant گسترده، تغییر credential یا اجرای ابزار OWNER استفاده نشود.

API و Worker سازگار و Admin با digest آزموده‌شده نصب شوند؛ Backend روی پورت عمومی منتشر نشود. allowlist دقیق مسیرهای جدید proxy و `nginx -t` پیش از هر reload حفظ شوند. پس از کنترل health، Login صحیح OWNER فقط توسط مالک و بدون PIN اشتباه بررسی شود. QA عملیات فقط روی کاربر/مدیر synthetic و با حداقل مجوز انجام شود: 401 ناشناس و PENDING، 403 مدیر فاقد مجوز، CSRF، approve/execute جدا، Audit، محرومیت/رفع، توکن قدیمی نامعتبر، `ADMIN_REVOKE_SESSIONS` و disable واقعی. حساب OWNER و PIN آن تغییر نکنند.

فعال‌سازی `ADMIN_USER_RESTRICTIONS_ENABLED` مرحله‌ای مستقل و نیازمند مجوز صریح است؛ پیش‌فرض false باقی می‌ماند. مقدارهای ۱ ساعت، ۲۴ ساعت، ۷ روز، ۳۰ روز و دائم، دلیل اجباری و مجوز مستقل توضیح محرمانه مطابق ADR-090 حفظ شوند. تست ظرفیت/Stress/Load به سرور آینده موکول است و ظرفیت عملیاتی تأیید نمی‌شود.

## Rollback ایمن

- پیش از ثبت اولین محرومیت فاز سوم: mutation بسته، binary قبلی فقط پس از بررسی سازگاری schema/grants و jobها قابل بازگشت است؛ migration پایین نرود و هیچ Audit یا داده‌ای حذف نشود.
- پس از ثبت محرومیت: flag نوشتن/تأیید جدید خاموش شود و نسخهٔ سازگار فاز سوم با enforcement و expiry در API/Worker حفظ شود. خاموشی flag reconciliation اثرهای قبلاً commit‌شده را متوقف نمی‌کند. بازگشت به فاز دومِ فاقد انقضا پذیرفته نیست.
- digest نهایی همین candidate در حالت read-only/flag=false fallback سازگار است. بسته‌شدن ورودی mutation جای قطع Auth/expiry یا فعال‌سازی اجباری سرویس بدون Qualification را نمی‌گیرد. در شکست، Admin containment حفظ و سرویس‌های بازی سالم دست‌نخورده بمانند.
- restore کامل راهکار معمول rollback کد نیست: فقط در حادثهٔ داده، Maintenance کامل، ارزیابی داده‌های پس از backup و تأیید مالک انجام شود. حذف volume، down migration و بازگردانی dump روی سرویس زنده ممنوع است.

ریسک‌های باز: retention توضیحات محرمانه و چرخش کلید پیش از Production، هزینهٔ جستجوی contains در حجم زیاد، deadline/freshness واقعی مقصد و نبود پذیرش ظرفیت. این‌ها با غیرفعال‌کردن اسکن یا ساخت شواهد جایگزین حل نمی‌شوند.
