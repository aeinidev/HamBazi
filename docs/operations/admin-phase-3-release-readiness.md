# آمادگی انتشار فاز سوم Admin روی Staging

تاریخ بررسی: 2026-10-28. مرجع معماری ADR-090 است. این کار فقط آماده‌سازی محلی است؛ نصب، اتصال به Staging/Production، تغییر OWNER و شروع فاز چهارم مجاز نیستند. نتیجهٔ جاری در [گزارش تکمیلی آماده‌سازی](../security/admin-phase3-staging-preparation.json)، اجرای ناموفق CI در `docs/security/admin-phase3-docker-29.8.2-qualification.json` و نتیجهٔ تاریخی پیش از ارتقای pin در `docs/security/admin-phase3-release-qualification.json` ثبت شده است؛ این سند به‌تنهایی مجوز نصب نیست.

## ادامهٔ آماده‌سازی با ریسک ثبت‌شده — انتشار NO-GO

دستور مالک فقط ثبت ریسک timeout خط ۶۰۰ و ادامهٔ آماده‌سازی را مجاز می‌کند؛ پذیرش رسمی شکست CI یا استقرار نیست. تست‌ها، assertionها، timeoutها، workflow و سیاست‌های امنیتی بدون تغییر باقی ماندند. CI جامع همچنان ناموفق است و manifest موفق صادر نشده است.

- candidate جدید از commit تمیز `aca52da5e585b97cbce79cab7cddf123317e2dd6` با originهای ثبت‌شدهٔ Staging و featureهای همان پروفایل ساخته شد. اختلاف با commit اجرای CI قبلی فقط مستندات است. پنج ایمیج API/Bot/Worker/Web/Admin اسکن شدند و تمام شدت‌ها صفرند؛ [فهرست ثابت artifactها](../security/admin-phase3-staging-artifacts.json) بستهٔ قابل نصب یا تأیید انتشار نیست.
- ۴۰ تست Admin و مرورگرهای واقعیِ داخل harness، ۳۸ کنترل TLS/احراز هویت/RBAC/CSRF/Audit روی همان ایمیج، ارتقای دارای داده از ۱۹ به ۲۱ Migration و بازیابی CMS/AES-256-GCM همهٔ ۴۵ جدول و globals/دو دیتابیس موفق‌اند. علاوه بر fixture استاندارد، این کنترل‌ها با PostgreSQL ثبت‌شدهٔ Staging (`7de…`) نیز محلی اجرا شدند؛ Redis آن rehearsal همچنان fixture `16b…` بود.
- ۲۰۰ تست infra با scanner واقعی و ۵۰ کنترل مالکیت کلیدهای Backup موفق‌اند. شش سناریوی release مرورگر در fixture مستقل Docker بدون skip موفق شدند. دو اجرای native هر ۳۰۵ تست Backend را پاس کردند، ولی مرحلهٔ مرورگر همان اجراها شکست خورد؛ این اجراها PASS کلی نیستند و جای CI Docker را نمی‌گیرند.
- بررسی تشخیصیِ suiteهای بعد از خطای اولیه، timeout مستقل `private-room-match.test.ts:206` و سه timeout در `match-reconnect.test.ts:158/229/442` را آشکار کرد. هر شکست مستقل در گزارش JSON ثبت می‌شود؛ نتیجهٔ تشخیصی ناموفق باقی می‌ماند. موفقیت مرورگر مستقل یا تعویق تست ظرفیت این شکست‌ها را رفع نمی‌کند.
- جمع‌آوری نهایی Docker همهٔ ۳۰۵ تست Backend را اجرا کرد: ۳۰۰ موفق و همان پنج timeout ناموفق. مراحل مستقل بعدی شامل Worker، پایداری پس از restart، هر شش سناریوی release مرورگر و restore منطقی ۴۵ جدول نیز کامل شدند؛ exit نهایی همچنان ۱ است. این runner تشخیصیِ خصوصی جای CI اصلی یا شواهد PASS نیست. اسکن نهایی تاریخچه/candidate و ممیزی وابستگی‌ها نیز بدون یافتهٔ بررسی‌نشده موفق‌اند؛ هیچ استثنای جدید اضافه نشد.
- ایمیج دقیق Redis ثبت‌شدهٔ Staging (`a2b331…`) در Docker و آرشیوهای محلی موجود نیست؛ scan و سازگاری **تمام** سرویس‌های retained تأیید نشده‌اند. شش ایمیج baseline موجود جداگانه بررسی شدند: HIGH/CRITICAL/UNKNOWN صفر، PostgreSQL یک MEDIUM دارد. این بررسی جزئی، Qualification کامل baseline یا تأیید deadline سرور نیست. هیچ ایمیجی بی‌اجازه از سرور دریافت یا جایگزین نشده است.

[ADR-091](../adr/091-proposed-phase3-staging-timeout-risk.md) صرفاً پیشنهاد مشروط و هنوز تصویب‌نشده برای R01/R02 است؛ timeoutهای reconnect و هر شکست مستقل دیگر را نمی‌پوشاند، بنابراین اکنون واجد شرایط اجرا نیست. پذیرش ریسک اولیه، CI را PASS نمی‌کند. مسیر پیش‌فرض، رفع علت و CI کامل موفق است.

[برنامهٔ انتشار، بکاپ و Rollback](admin-phase-3-staging-release-plan.md) برای مجوز بعدی آماده است: full backup واقعی تازه، capsule رمزگذاری‌شدهٔ تنظیمات/کلیدها، کپی خارج سرور، بازیابی واقعی همان archive و receipt منطبق باید **پیش از نصب** تکمیل شوند. ابزارهای خصوصی قدیمی به release قبلی مقیدند؛ rebinding مسیر/گیرنده و بررسی نسخهٔ ابزار gate مراسم واقعی است. فعلاً بکاپ واقعی، live health یا تمدید/تغییر deadline انجام نشده است. خاموش‌کردن کل management پیشنهاد نمی‌شود؛ flag محرومیت جدید false می‌ماند و operations DSN، RBAC، تأیید فاز دوم و reconciliation حفظ می‌شوند.

## شواهد اجرای قبلی Docker 29.8.2

نسخهٔ مورد انتظار با مجوز مالک در workflow و toolchain به `29.8.2` منتقل شد؛
ADR-041 و راهنمای CI/بازتولید نیز هماهنگ‌اند. بررسی نسخه همچنان دقیق است و
snapshotter، هش ابزارها، freshness، شدت‌های مسدودکننده و اسکن تاریخچه تغییر نکرده‌اند.
آزمون منفی نسخهٔ قبلی و snapshotter خاموش، همراه با ۲۸ آزمون سیاست CI، موفق شد.
فایل bytecode تولیدی Python از ردیابی Git خارج و خروجی‌های Python به `.gitignore`
افزوده شدند؛ شرط سورس تمیز حفظ شد. cache اسکن محلی نیز به مجوز لازم `0700` محدود شد.

**انتشار همچنان مسدود است؛ علت جاری دیگر اختلاف pin یا سورس commit‌نشده نیست.**
کد candidate در commit `beaad2b26a5ddea3ef88234bb9075cba1f2db35d` با سورس تمیز و
نصب frozen، بدون `.env` محیط کاری، در کپی محلی دارای تاریخچهٔ کامل Git بررسی شد.
اسکریپت واقعی `infra/ci/verify.mjs` از ۲۳ gate عبور کرد، اما در
`migration-fault-release` شکست خورد. سناریوی
`apps/api/tests/integration/match-processing.test.ts:600`
با عنوان `keeps current-cursor recovery waves fresh across concurrent commands and locked role changes`
در اجرای جامع و تکرار مستقل شکست خورد؛ اجرای محدود نیز timeout پس از حدود
`5005.5ms` در برابر مهلت ثابت `5000ms` را تأیید کرد. علت زیرساختی/عملکردیِ کندی
هنوز قطعی نیست و Regression ناشی از Docker اثبات نشده است. این آزمونِ صحت هم‌زمانی
با تعویق تست ظرفیت حذف نمی‌شود؛ هیچ assertion، نمونه یا مهلتی کاهش/افزایش نیافت.
manifest موفق CI ساخته نشد؛ اجرای GitHub Actions میزبانی‌شده نیز انجام نشده است.

نتایج موفق همین بازبینی:

- کیفیت جامع، قراردادها و diff تمیز تولید قرارداد، Bot، Admin Integration،
  ترمینال خصوصی و Nginx؛ Build چهار ایمیج و اجرای واقعی آن‌ها در خود CI.
- اسکن تاریخچه/candidate و وابستگی‌ها بدون یافتهٔ بررسی‌نشده؛ هفت ایمیج
  API/Bot/Worker/Web/Admin/PostgreSQL/Redis بدون HIGH/CRITICAL/UNKNOWN، با DB advisory تازه.
- چهار gate بعد از مرحلهٔ ناموفق جداگانه اجرا شدند: Web=۳۰، SDK=۳۸، Preview=۲
  و Build عادی Web؛ این موفقیت‌ها جای CI جامع موفق معرفی نمی‌شوند.
- Admin نهایی: ۴۰ تست Integration، ۳۸ کنترل production/TLS روی همان digest،
  ارتقای دارای داده از ۱۹ به ۲۱ Migration، حفظ OWNER/Audit ساختگی و بازیابی
  رمزگذاری‌شدهٔ واقعی ۴۵ جدول در محیط بدون شبکه، با رد archive دستکاری‌شده.
- حالت flag=false و انقضای محرومیت موجود با کد همان ایمیج و clock تزریق‌شدهٔ
  fixture موفق‌اند. هیچ حساب واقعی یا سروری تغییر نکرد.

[شواهد بازبینی جاری](../security/admin-phase3-docker-29.8.2-qualification.json)
هویت commit، digestها، نتایج و شکست را ثبت می‌کند. ایمیج‌های جدیدِ core پروفایل
پیش‌فرض CI دارند و payload دارای originهای Staging نیستند. پس از رفع timeout و
موفقیت کامل CI، candidate تمیز با origin/featureهای مقصد ساخته و همان digestها
دوباره کنترل شوند. انتشار همچنان به مجوز جداگانه، بکاپ واقعی تازه و بازیابی معتبر
خارج سرور و کنترل سلامت/freshness مقصد نیاز دارد. ظرفیت عملیاتی تأیید نشده است.

## نتیجهٔ تاریخی محلی پیش از ارتقای pin

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
2. Qualification با toolchain دقیقِ جاری `Docker 29.8.2` و سورس تمیزِ commit‌شده لازم است. اختلاف pin تاریخی با اصلاح مصوب ADR-041 رفع شده؛ timeout آزمون صحت هم‌زمانی در بازبینی جاری هنوز CI جامع را مسدود می‌کند. گزارش موفق جزئی یا تعویق ظرفیت جای رفع این شکست و اجرای کامل CI را نمی‌گیرد.
3. پیش‌بررسی فقط پس از مجوز نصب: فضای آزاد، سلامت PostgreSQL/Redis/Nginx/API/Bot/Worker/Web/Admin، گواهی و timerها، digest فعلی، grantها و اعتبار deadline امنیتی. این بررسی‌ها در آماده‌سازی محلی انجام نمی‌شوند و هیچ مهلتی تمدید نمی‌شود.

## بکاپ و بازیابی

- پیش از Maintenance، بکاپ **کامل و تازهٔ PostgreSQL** لازم است: همهٔ دیتابیس‌های غیر template، globals/roleها، schema، grants و تنظیمات نقش در دیتابیس؛ به‌ویژه users، user_restrictions، user_admin_effects، admin_operations و تمام Audit. بکاپ نه‌جدولی OWNER مکمل است و جای بکاپ کامل را نمی‌گیرد.
- از مسیر خصوصی full-backup آزموده‌شدهٔ انتشار قبلی استفاده شود: snapshot سازگار هر دیتابیس، `pg_dump` قالب custom، globals و CMS با AES-256-GCM و گواهی گیرندهٔ تأییدشده. private key و عبارت رمزگذاری فقط در اختیار مالک و خارج سرور بمانند؛ ورود تعاملی فقط در ترمینال خصوصی و بدون ضبط انجام شود. کلید واقعی یا Passphrase در Build، env اجرایی تست، چت یا Git دریافت نمی‌شود.
- archive رمزگذاری‌شده خارج سرور کپی و SHA-256 دو طرف تطبیق داده شود. صرف تطابق هش، بازیابی معتبر محسوب نمی‌شود. همان archive پس از احراز صحت AEAD، در PostgreSQL disposable با `network=none`، بدون port عمومی و بدون mount دادهٔ میزبان بازیابی شود؛ rows/digests، constraints، triggers، grants، ownership و کنترل یکپارچگی مقایسه شوند. شکست decrypt/restore/reconcile، نصب را متوقف می‌کند.
- کلید `ADMIN_COMMAND_KEY` برای توضیحات محرمانه، همراه با realm و نسخهٔ کد، در vault یا بکاپ رمزگذاری‌شدهٔ مستقل حفظ شود. DB dump بدون این کلید برای بازیابی متن محرمانه کافی نیست؛ چرخش خام کلید مجاز نیست. کلیدهای امضای نشست، PIN pepper، تنظیمات خصوصی و checkpoint OWNER نیز باید طبق runbook فعلی قابل بازیابی باشند.
- بکاپ پیش از Migration با ابزار سازگار با schema فعلی مقصد تهیه و با همان نسخهٔ سازگار بازیابی شود؛ ابزار نیازمند ستون‌های جدید را پیش از ایجاد آن‌ها روی schema قبلی اجرا نکنید. نسخهٔ ابزار خصوصی Backup/Restore پس از ارتقا نیز باید با `admin-local-identity+private-notes-v3` سازگار باشد؛ آن را پیش از مراسم بکاپ/بازیابی انتشار آینده و بدون اجرای Bootstrap/Recovery یا تغییر checkpoint/credential مالک تطبیق دهید. تست نه‌جدولی OWNER با schema جدید جدا از تست full backup لازم است.
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
