# ADR-085 — اجرای فاز دوم Admin با فرمان محدود و اثر اتمیک

- **Status:** Accepted برای توسعه و آزمون محلی؛ مرز انتشار محرومیت با ADR-087 محدود شده؛ استقرار نیازمند تأیید جداگانهٔ OWNER.
- **Date:** 2026-10-27
- **Owner:** مالک پروژه HamBazi
- **Extends:** ADR-039، ADR-078، ADR-079، ADR-080، ADR-081، ADR-083 و ADR-084.
- **Supersedes:** صرفاً وضعیت «منتظر مجوز» برنامهٔ اجرایی فاز دوم؛ احراز هویت فاز اول، حساب واقعی OWNER و مرزهای استقرار تغییر نمی‌کنند.

## Context

مالک فاز اول را پذیرفته و توسعهٔ محلی فاز دوم برای مدیران/نقش‌ها، کاربران، بازی‌ها و اتاق‌ها را مجاز کرده است. انتشار روی Staging یا Production مجاز نیست. در کد فاز اول فقط خواندن این منابع وجود داشت. وضعیت release بازی‌ها در PostgreSQL عمداً DISABLED است، در حالی که registration خصوصی می‌تواند یک بازی را برای جمع محدود قابل بازی کند؛ نوشتن ACTIVE روی همان ستون، کنترل انتشار را تضعیف می‌کرد.

## Decision

### قرارداد و اختیار

Registry مجوزها و schema عملیات در `packages/validation/src/admin-management.ts` است. مسیر جدید بدون policy ثبت‌شده بسته است؛ عملیات ناشناخته برای OWNER نیز بسته است. نقش OWNER یک role قابل تخصیص نیست و از binding ثابت realm استخراج می‌شود. مجوزهای `admins.*` و `roles.*` فقط برای OWNER هستند؛ واردکردن این مجوزها در نقش یا override رد می‌شود و حتی رکورد خراب دیتابیس به مدیر عادی اختیار مدیریت OWNER نمی‌دهد.

نقش‌های Super Admin، Moderator، Support و Operator الگوهای صریح قابل بازبینی‌اند؛ تا OWNER نقش را ذخیره و تخصیص ندهد هیچ اختیاری ایجاد نمی‌شود. نقش‌های سفارشی و override فردی با تقدم deny پشتیبانی می‌شوند. بخش از prefix مجوز، محیط از realm/config و scope بازی از فهرست صریح game ID به دست می‌آید؛ wildcard و scope بین محیط‌ها وجود ندارد. Users دادهٔ عمومی بین بازی‌هاست و grant محدود به بازی برای آن رد می‌شود. نقش‌ها حداکثر ۱۰۰، عضویت هر مدیر حداکثر ۱۶ و مجموع grant مؤثر حداکثر ۲۵۶ است؛ فهرست‌ها bounded هستند.

تغییر فردی `authorizationVersion` و تغییر نقش مشترک یا عضویت `policyRevision` را افزایش می‌دهد. پیش‌نمایش تغییر/حذف نقش تعداد اعضای متأثر را نشان می‌دهد؛ این تعداد در payload/digest ثبت و زیر realm lock دوباره بررسی می‌شود. تغییر عضویت بین درخواست و اجرا، حتی با تعداد برابر، تأیید قدیمی را با revision باطل می‌کند. هر درخواست Backend، وضعیت/نسخه/نشست و مجوز جاری را از primary می‌خواند؛ Redis authority نیست. UI در پیش‌زمینه هر ۲٫۵ ثانیه access را بررسی و با lease پنج‌ثانیه‌ای، هنگام قطع یا توقف پاسخ داده و cache را پاک می‌کند. پاسخ قدیمی پس از تغییر revision یا شروع بررسی جدید پذیرفته نمی‌شود.

### جریان عملیات

`request → PENDING → reauthenticate/approve → APPROVED → execute → SUCCEEDED|FAILED|UNKNOWN`

درخواست شامل UUID پایدار، action سخت‌گیرانه، expectedVersion و reasonCode محدود است. digest HMAC به payload نرمال‌شده، محیط و دلیل متصل است. رکورد به درخواست‌کننده، نشست، authorization/credential/session version و policy/ownership epoch متصل می‌شود. چالش حداکثر ۱۲۰ ثانیه و مجوز اجرا حداکثر ۶۰ ثانیه و محدود به پایان همان چالش است؛ تأیید و اجرای تکراری اثر جدید ندارند.

OWNER با Password و PIN فعلی، reason و تأیید صریح همان target/payload تصمیم `OWNER_FINAL` می‌گیرد. برای مدیر عادی، تأیید Password تازهٔ مدیر دیگری با مجوز approve و همان scope لازم است؛ خودتأییدی ممنوع است. مالک می‌تواند درخواست مدیر دیگری را نیز تأیید کند، ولی actor بازنویسی نمی‌شود و مجوز/نشست فعلی درخواست‌کننده همچنان لازم است. در reauth نشست rotate و binding همان درخواست به نشست جدید منتقل می‌شود؛ انقضای مطلق نشست افزایش نمی‌یابد. نسخهٔ approver هنگام اجرا دوباره بررسی می‌شود. هیچ Break-glass عمومی یا تأیید قابل استفاده برای عملیات دیگر ساخته نمی‌شود.

Password نامعتبر شمارندهٔ PIN را افزایش نمی‌دهد. PIN نامعتبر فقط پس از Password صحیح، همان شمارندهٔ پایدار سه‌تلاش فاز اول را مصرف می‌کند؛ receipt تلاش از شمارش دوبارهٔ retry جلوگیری می‌کند. Password+PIN ثابت، MFA مستقل یا مقاوم در برابر فیشینگ نیست. Bootstrap، بازیابی خصوصی PIN با Password فعلی و نبود Forgot/Reset Password برای OWNER حفظ می‌شوند.

### مدیریت هویت

ساخت، تغییر دسترسی/وضعیت، reset رمز مدیر عادی، ابطال نشست‌ها و حذف منطقی، فقط پس از OWNER_FINAL و در تراکنش Admin انجام می‌شوند. Username نرمال و یکتا، tombstone غیرقابل استفادهٔ مجدد، PIN مدیر عادی NULL و binding مالک غیرقابل تغییر است. رمز دقیقاً ۱۲ نویسه با CSPRNG `randomInt` و rejection sampling، از A–Z/a–z/0–9 با حضور هر سه دسته است. raw فقط در اولین پاسخ موفق نمایش داده می‌شود؛ DB، receipt و Audit آن را نگه نمی‌دارند. پاسخ گم‌شده با reset جدید جبران می‌شود، نه ذخیرهٔ قابل‌بازیابی رمز. reset و disable/delete تمام نشست‌ها و تأییدهای قبلی مدیر را با epoch/version نامعتبر می‌کنند.

### تراکنش و Audit

برای اثر در خود Admin، admission، اثر، receipt و Audit نتیجه در یک تراکنش زیر realm lock ثبت می‌شوند. برای محصول ابتدا admission در Admin durable می‌شود؛ سپس فقط application port ماژول مالک فراخوانی می‌شود. Users/Games/Rooms/Matches هرکدام outcome outbox/receipt append-only خود را دارند و اثر و نتیجه را در تراکنش خود اتمیک ثبت می‌کنند. هیچ query خارجی، raw SQL دلخواه، مدل Prisma مشترک یا network I/O داخل تراکنش ماژول دیگر وجود ندارد.

پس از admission، وضعیت تا دریافت receipt مالک UNKNOWN است. قطع اتصال یا شکست Audit نتیجه، موفقیت/شکست جعلی تولید نمی‌کند. retry با همان UUID/actor/realm/digest توسط ماژول مالک deduplicate می‌شود. پس از انقضای تأیید، UNKNOWN فاقد receipt قابل اجرای مجدد نیست؛ درخواست‌کننده باید همان UUID/payload را renew و با challenge و reauth تازه تأیید کند. renew ابتدا receipt موجود را reconcile می‌کند و UNKNOWN را به موفقیت جعلی یا فرمان جدید تبدیل نمی‌کند. status و reconciliation محدود دوره‌ای فقط receipt ثبت‌شده را به Audit منتقل می‌کنند؛ فرمان فاقد receipt را خودکار و به‌اجبار اجرا نمی‌کنند. اسکن UUID به‌صورت صفحه‌ای می‌چرخد تا رکوردهای قدیمیِ بدون اثر، reconciliation نتیجه‌های جدید را گرسنه نکنند. UNKNOWN بدون receipt نیازمند بررسی/تلاش مجدد همان فرمان است، نه فرمان تکراری جدید.

Audit شامل actor، target، operation، commandId، reasonCode، mode و زمان است؛ raw credential، نام نمایشی/متن آزاد، hidden state، cookie و token وارد Audit نمی‌شوند. تاریخچهٔ مدیر و تغییر دسترسی با query محدود و index مستقل خوانده می‌شود. خطای شناخته‌شدهٔ application پس از rollback از adapter بازگردانده می‌شود؛ SQL و خطای اصلی DB بیرون نمی‌روند. ساخت role/operation با INSERT و ویرایش آن با UPDATE شرطیِ realm انجام می‌شود؛ upsert صرفاً بر مبنای UUID استفاده نمی‌شود. برخورد UUID با رکورد realm دیگر موجب خطا و rollback است، نه overwrite آن رکورد.

### عملیات محصول

- **Users:** مشاهده و اصلاح نام با normalizer موجود؛ محروم‌سازی/رفع آن مطابق ADR-087 در این انتشار غیرفعال است؛ ADR-086 صرفاً سابقهٔ توسعه و مدل نسل نشست را نگه می‌دارد.
- **Games:** `admin_availability` و revision جدا فقط پذیرش جدید را محدود می‌کنند. این setting ثبت‌شده و غیرمحرمانه است؛ status انتشار، manifest، engine و ruleset را تغییر نمی‌دهد. ACTIVE به معنی اجازه در محدودهٔ انتشار موجود است، نه انتشار بازی آماده‌نشده. private catalog، lobby و شروع شخصی Coup gate را می‌خوانند. درخواست عبورکرده از gate پیش از commit تغییر، admission در حال انجام محسوب می‌شود؛ Match فعال و retry اثر قبلی حفظ می‌شوند. بستن پذیرش به معنی drain/termination خودکار نیست.
- **Rooms:** فقط WAITING/FULL با expectedVersion و startedMatchId=NULL، زیر همان قفل Room به CLOSED می‌روند. عضویت و تاریخچه حذف نمی‌شوند؛ STARTING/STARTED بسته نمی‌شوند.
- **Matches:** توقف محدود، زیر همان row lock نویسندهٔ بازی، با کنترل نسخه/وضعیت/seq و ثبت lifecycle event، processed command و outbox انجام می‌شود. private snapshot حتی خوانده نمی‌شود. pins/state/result/statistics بازنویسی نمی‌شوند. TERMINATED Undo یا برندهٔ ساختگی ندارد.

تنظیمات دلخواه، تغییر ruleset فعال، مدیریت مالی، محتوای گزارش‌ها و پشتیبانی خارج از این تغییرند. تنها setting قابل نوشتن فعلی gate پذیرش بازی است؛ کلید KV دلخواه یا Feature Flag منتشرنشده وارد نمی‌شود.

### فعال‌سازی و بازیابی

دو migration صرفاً افزایشی و یک فایل grant صریح آماده می‌شوند. role جداگانهٔ `hambazi_admin_operations` فقط ستون‌های لازم و INSERT receipt/event/outbox را دارد؛ به session بازیکنان، snapshot، chat، نتایج و UPDATE/DELETE Audit دسترسی ندارد. runtime Admin به جدول محصول دسترسی مستقیم نمی‌گیرد. mutationها پیش‌فرض خاموش‌اند و فقط با `ADMIN_MUTATIONS_ENABLED=true` و URL همین role فعال می‌شوند؛ نبود URL یا role مجاز، fallback به credential بازیکنان ندارد. deny-by-default، HTTPS، origin/CSRF، cookies و rate limits قبلی حفظ و allowlist کاندید Nginx فقط برای مسیرهای ثبت‌شده گسترش می‌یابد.

بکاپ هویت جدید شامل ۹ جدول است: شش جدول فاز اول به‌اضافهٔ roles، memberships و operations. رمزگذاری AEAD و ورود عبارت فقط در TTY خصوصی حفظ می‌شوند. خواندن و آزمون بازیابی واقعی قالب شش‌جدولی قدیمی نیز پشتیبانی می‌شود. نصب آینده باید bundle خصوصی جدید، grant بکاپ، schema جدید و restore rehearsal منطبق داشته باشد؛ bundle تأییدشدهٔ فعلی بی‌اجازه تغییر نمی‌کند. بکاپ محصول کامل مستقل از بکاپ هویت است؛ restore هویت به‌تنهایی اثر Room/Match/Users را معکوس نمی‌کند و قبل از بازگشایی mutationها receiptهای محصول باید reconcile شوند.

## Alternatives

JWT با role ثابت، super-admin wildcard، ذخیرهٔ raw رمز برای retry، Admin SQL مستقیم روی محصول، transaction توزیع‌شده، صف/سرویس جدید و تغییر release status برای gate رد شدند؛ به‌ترتیب revoke، حفاظت OWNER، محرمانگی، ownership، atomicity قابل اتکا یا سادگی موجود را تضعیف می‌کنند.

## Consequences

مجوز استقرار صادر نشده است. قبل از نصب آینده: بکاپ تازهٔ کامل/هویت و restore، migration/grant dry run، rollout هماهنگ ADR-086، scan و qualification ایمیج جدید، `nginx -t`، smoke و rollback کنترل‌شده لازم‌اند. downgrade کد نباید migrationهای افزایشی را حذف کند؛ ابتدا mutationها بسته و UNKNOWNها reconcile می‌شوند. بازی/اتاق/محرومیت اعمال‌شده با بازگردانی SQL جعل نمی‌شود؛ هر تغییر قابل برگشت یک فرمان تازه با نسخهٔ جاری است.

SLO/peak/retention محصول همچنان تصمیم‌های باز هستند؛ عدد فرضی برای production تصویب نمی‌شود. آزمون محلی bounded و race جای qualification همزمانی واقعی Staging یا soak مصوب را نمی‌گیرد.
