# ADR-090 — مدیریت پیشرفته کاربران و محرومیت زمان‌دار

- Status: Accepted — توسعه و تست محلی؛ استقرار نیازمند مجوز جداگانه
- Owner: مالک HamBazi
- Date: 2026-10-28
- Supersedes: محدودیت اجرایی محروم‌سازی در ADR-087، فقط برای فرمان‌های جدید این سند
- References: ADR-039، ADR-078، ADR-079، ADR-081، ADR-083، ADR-084، ADR-085، ADR-086، ADR-087

پیگیری اجرا — 2026-10-30: پس از مجوز مستقل مالک، [استقرار Staging](../operations/admin-phase-3-deployment-20261030.md) انجام شد. تصمیم‌های این ADR تغییر نکردند؛ نوشتن محرومیت همچنان با flag=false متوقف است و فعال‌سازی و هر انتشار بعدی تأیید جداگانه می‌خواهند؛ QA زندهٔ ابطال نشست مدیر آزمایشی هنوز باز است.

## Context

فاز دوم مشاهدهٔ فهرست و اصلاح نام را فراهم کرده است. USER_STATUS قدیمی عمداً مسدود است. مالک فاز سومِ مدیریت کاربران را با مدت‌های مشخص، دلیل اجباری، توضیح محرمانهٔ اختیاری و بررسی صریح ابطال نشست‌ها تصویب کرده است. گزارش تخلف، مدیریت محتوا، آمارسازی و اقتصاد در این تغییر نیستند.

## Decision

### ۳.۱ — قرارداد و مرز مالکیت

همان Modular Monolith، listener مستقل Admin و مالکیت Users/Matches حفظ می‌شود. جستجوی حداکثر ۶۴ نویسه در UUID، نام نمایشی و publicHandle و فیلتر ACTIVE/BANNED با صفحه‌بندی حداکثر ۵۰ رکورد ارائه می‌شود. جستجوی جدید در /v1/admin/users/search است تا قرارداد منجمد /users دست‌نخورده بماند. صفحه‌بندی بر UUID پایدار است، نه ادعای ترتیب زمانی. ویرایش فقط نام نمایشی با normalizer فعلی است؛ Telegram ID، handle، نتیجه و امتیاز قابل تغییر نیستند. سوابق از port عمومی Matches و فقط شناسه، بازی، وضعیت، تاریخ و placement/winner همان کاربر خوانده می‌شوند؛ snapshots، metrics، event payload، chat و hidden state حتی SELECT نمی‌شوند.

### ۳.۲ — چرخهٔ محرومیت و نشست

USER_RESTRICT و USER_UNRESTRICT از همان request → approve → execute، OWNER_FINAL/DUAL_CONTROL، reasonCode، target version، idempotency و receipt قابل reconciliation استفاده می‌کنند. USER_STATUS قدیمی همچنان بسته می‌ماند. مدت‌ها دقیقاً ۱ ساعت، ۲۴ ساعت، ۷ روز، ۳۰ روز (۲۴ساعته)، دائم؛ شروع از اجرای موفق، زمان UTC سرور، دائم بدون expiresAt. دلیل enum اجباری ABUSE/SPAM/SECURITY/INCIDENT_RESPONSE/APPEAL؛ متن آزاد فقط در توضیح محرمانه.

Users مالک user_restrictions است. درج محرومیت، status=BANNED، افزایش profile_version و auth_version و receipt در یک تراکنش‌اند. رفع محرومیت و انقضا نیز auth_version را افزایش می‌دهند؛ هیچ توکن قبلی احیا نمی‌شود. قفل مشترک بر userId، کنترل نسخه و unique index محرومیت باز جلوی رقابت را می‌گیرند. unrestrict به restrictionId فعلی متصل است؛ BANNED قدیمی بدون رکورد فقط با null و نسخهٔ فعلی قابل رفع دستی است، خودکار منقضی نمی‌شود.

در هر اعتبارسنجی هویت BANNED، انقضای رسیده به‌صورت atomic بررسی و سپس هویت دوباره خوانده می‌شود. Worker موجود نیز از مسیر cleanup Users دوره‌ای انقضا را انجام می‌دهد؛ سرویس جدید نداریم. شکست DB یا Audit مجوز عبور ایجاد نمی‌کند. realtime از همان revalidation نشست موجود استفاده می‌کند؛ مهلت policy فعلی و کنترل درخواست بعدی حفظ می‌شود، ادعای قطع آنی همهٔ socketها نداریم. Match فعال، state، نتیجه و امتیاز تغییر نمی‌کنند؛ timeout/reconnect/Bot takeover همان سیاست مصوب است.

احراز هویت مطابق تصمیم‌های فعلی Local Authentication حفظ می‌شود؛ Password همراه PIN ثابت، MFA مستقل یا مقاوم در برابر فیشینگ محسوب نمی‌شود. این فاز آن را تغییر یا به‌عنوان MFA واقعی معرفی نمی‌کند.

### ۳.۳ — RBAC، Audit و محرمانگی

مجوزهای جدید users.history.view، users.restrictions.view/manage/approve/notes.view صریح و مستقل‌اند. نقش‌های آماده یا users.manage قدیمی خودکار مجوز نمی‌گیرند؛ OWNER فقط در entitlement همهٔ قابلیت‌های ثبت‌شده را دارد. قید game روی کاربران سراسری معتبر نیست؛ environment همچنان enforce می‌شود. برای نمایش history/restrictions، users.view نیز لازم است.

توضیح حداکثر ۲۰۰۰ نویسه تنها در request است، در action/Audit/response معمولی ثبت نمی‌شود. HMAC intent متن را به همان تأیید متصل می‌کند؛ ciphertext مستقل AES-256-GCM با IV تصادفی، AAD شامل realm/operation/target در admin_operations ذخیره می‌شود. کلید purpose-specific با HKDF-SHA256 از ADMIN_COMMAND_KEY موجود و salt realm مشتق می‌شود؛ secret جدید یا سرویس جدید اضافه نمی‌شود. حفاظت در برابر DB-only disclosure برقرار است؛ دسترسی به secret برنامه می‌تواند متن را رمزگشایی کند. نگهداری/تغییر کلید باید همراه restore یا re-encryption باشد؛ تعویض خام command key توضیحات قدیمی را ناخوانا می‌کند.

GET private-note فقط با دو مجوز restriction view و notes.view، احراز هویت کامل و Audit موفق PRIVATE_NOTE_VIEWED پاسخ می‌دهد. Audit فقط شناسه/کد دلیل است؛ content در telemetry، browser storage و cache پایدار قرار نمی‌گیرد. evidence چرخهٔ محرومیت با شناسهٔ operation به Audit وصل است؛ رکوردهای پایان‌یافته تغییرناپذیرند. حذف/retention متن محرمانه تصمیم باز و مانع گسترش فراتر از Staging است؛ در این فاز خودکار حذف یا سیاست نگهداری نامصوب نداریم.

### ۳.۴ — UI

همان React و Midnight Neon فارسی/RTL: جستجو و فیلتر، پروفایل، سوابق خلاصه، تاریخچهٔ محرومیت، انتخاب مدت و دلیل/توضیح اختیاری، پیش‌نمایش → احراز هویت مجدد → تأیید → اجرای صریح. هیچ PIN اشتباهی روی OWNER واقعی آزمایش نمی‌شود. بازسازی UI مدیر عادی با تغییر نسخهٔ دسترسی/سیاست حفظ می‌شود؛ برای OWNER فقط افزایش policyRevision ناشی از تغییر نقش دیگران، نتیجهٔ عملیات خودش را پاک نمی‌کند. تغییر هویت/مالکیت، ابطال نشست و کنترل Backend همچنان لازم و مستقل‌اند. grantها در Backend بررسی می‌شوند.

### ۳.۵ — فعال‌سازی و پذیرش

ADMIN_USER_RESTRICTIONS_ENABLED پیش‌فرض false و وابسته به mutations=true است. خاموش‌کردن این flag فقط نوشتن/تأیید تازه را می‌بندد؛ adapterهای outcome برای reconciliation رسیدهای قبلاً commit‌شده باقی می‌مانند تا Audit نهایی گم نشود، بدون اجرای دوبارهٔ اثر. Migrationهای additive و grantهای phase3 قبل از فعال‌سازی و پس از backup/restore مورد تأیید اعمال می‌شوند؛ کد حاضر فقط محلی است. تست دوره‌ای/بار/ظرفیت به سرور آینده موکول است، ظرفیت تأیید نمی‌شود. تست محلی صریح revoke/disable/403 جایگزین جعل شواهد ناقص تست زندهٔ فاز دوم نمی‌شود.

## Alternatives

Redis TTL به‌عنوان حقیقت محرومیت، سرویس moderation مستقل، استفاده از USER_STATUS قدیمی، متن آزاد در Audit و ذخیرهٔ plaintext رد شدند: یا دوام/ایمنی ندارند یا برای این محدوده غیرضروری‌اند.

## Consequences / Risks

Migration و grant جدید و به‌روزرسانی allowlist proxy لازم است؛ pool و page size محدود می‌مانند. جستجوی contains ممکن است در دیتابیس بزرگ پرهزینه باشد؛ فعلاً statement_timeout=2s روی نقش مستقل reader و سقف طول/اندازه، بعداً index بر اساس اندازه‌گیری. پس از فعال‌سازی، rollback به binary فاقد انقضای محرومیت زمان‌دار بدون حفظ مسیر enforcement مجاز نیست. دورهٔ بازگشت باید کد سازگار همین فاز و دادهٔ محدودیت‌ها را حفظ کند؛ کاهش نسخۀ دیتابیس یا پاک‌کردن محدودیت‌ها ممنوع است.
