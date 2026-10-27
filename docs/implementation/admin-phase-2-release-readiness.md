# گزارش آماده‌سازی انتشار فاز دوم Admin

> تکمیلی 2026-10-27: پس از این گزارش، مالک نصب Staging را مستقلاً مجاز کرد. وضعیت واقعی و پذیرش‌های هنوز باز در [گزارش استقرار Staging](../operations/admin-phase-2-staging-2026-10-27.md) ثبت است؛ متن زیر سابقهٔ آماده‌سازی قبل از مجوز را حفظ می‌کند.

**2026-10-27 — LOCAL ONLY — آمادهٔ درخواست مجوز نصب Staging؛ مجوز نصب صادر نشده است.** این گزارش جایگزین وضعیت قبلی موانع انتشار است. هیچ اتصال/تغییر Staging یا Production، تغییر حساب/PIN واقعی OWNER، commit یا بازنویسی تاریخچه انجام نشده است. فاز سوم شروع نشده و USER_STATUS/محروم‌سازی همچنان در Backend، grant و UI بسته است.

## اصلاحات نهایی

- طبق [ADR-089](../adr/089-admin-phase-two-image-security-refresh.md)، PostgreSQL **18.6** و Redis **8.10.2** حفظ شدند. baseهای رسمی و pinهای SHA-256 تازه، musl اصلاح‌شده را تأمین می‌کنند؛ مشتق PostgreSQL بسته‌های امضاشدهٔ **brotli-libs 1.2.1-r0** و **libcurl 8.23.0-r0** را به‌صورت آفلاین نصب می‌کند. HIGHهای CVE-2026-111497 و CVE-2026-92392 و UNKNOWN مربوط به CVE-2026-107891 رفع شدند. بازتولید مستقل همان digest PostgreSQL تأیید شد؛ معماری collation، سیاست volume و حذف gosu آسیب‌پذیر حفظ شدند.
- Node به **24.22.1** در CI، Build و runtime ارتقا یافت؛ اصلاح Brotli/TLS/DNS داخل باینری Node با به‌روزرسانی بستهٔ shared سیستم‌عامل به‌تنهایی انجام نمی‌شد. native crypto و Brotli در runtime واقعی آزموده شدند. dependency و pnpm lockfile تغییر نکردند. runtime همچنان بدون npm/Corepack/Yarn و با UID 1000 است؛ کل filesystem نهایی اسکن شد.
- ۱۳ FK موجود Admin در مدل Prisma با نام و رفتار واقعی‌شان تطبیق یافتند؛ **هیچ SQL، Migration، حذف constraint یا تغییر داده** برای این اصلاح ایجاد نشد. drift صفر است. آزمون restart به‌جای عدد تاریخی ۱۵، نام دقیق Migrationهای موفق را می‌سنجد؛ انتظارهای قدیمی identity/session نیز metadata موجود `authVersion` را صریحاً بررسی می‌کنند.
- سه شکست اولیهٔ Web، fixtureهای SSR/تصویر/layout/SDK و انتظار سه سناریوی Lobby تحت flag موجود کهربا اصلاح شدند. در حالت flag روشن فقط GET ثبت‌شدهٔ capabilities مجاز است؛ نبود write/Socket/start ناخواسته همچنان آزموده می‌شود. مرورگر Qualification ایمیج نیز تمام درخواست‌های غیرمحلی را قطع می‌کند تا fixture با Staging واقعی تماس نگیرد.
- Secret Scan کامل history و candidate حفظ شد. فقط سه مورد دقیقِ تأییدشدهٔ مالک در [ADR-088](../adr/088-admin-exact-secret-false-positives.md) به استثنای قبلی افزوده شده‌اند؛ هیچ استثنای کلی، تغییر detector، ignore-unfixed یا تضعیف freshness/severity اعمال نشد. محروم‌سازی مطابق [ADR-087](../adr/087-admin-phase-two-release-boundary.md) غیرفعال می‌ماند.

## شواهد و آزمون‌ها

| کنترل                                           | نتیجه                                                                                                                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| frozen install / lockfile                       | موفق؛ lockfile ثابت                                                                                                                                                              |
| `pnpm check` با Node 24.22.1 و بدون cache       | ۲۴۲۱ تست؛ format، lint، architecture، ۲۵ task نوع‌سنجی، ۱۴ task Build و contract check موفق؛ ۱۹۸ آزمون Infra شامل canary واقعی Secret                                            |
| مجموعهٔ گستردهٔ HTTP/PostgreSQL/Redis           | ۲۸۶ Integration + ۶ سناریوی مرورگر واقعی موفق؛ PostgreSQL بومی 18.6 و Redis نهایی؛ ارتقای دیتابیس قبلی، restart و دادهٔ ماندگار موفق                                             |
| بازیابی کامل محصول                              | ۴۴ جدول با constraint/trigger/grant تطبیق یافت؛ منبع دست‌نخورده و cleanup موفق                                                                                                   |
| `test:admin:local` روی ایمیج‌های نهایی DB/Redis | ۱۳ امنیت فاز یک + ۹ Integration فاز دو و مرورگر TLS واقعی + ۴ بکاپ رمزگذاری‌شده/Restore موفق                                                                                     |
| ایمیج نهایی Admin، حالت production              | ۳۲ کنترل موفق: native Argon2id/Brotli، UID، inbound HTTPS، verify-full DB و Redis TLS، هر سه نقش DB، CSRF، deny-by-default، Rate Limiting و shutdown                             |
| ایمیج‌های API/Bot/Worker/Web و Rollback         | ۱۲۳ کنترل + ۲ مرورگر ایمیج + ۳ انتقال بین candidateها + ۳ drain درخواست پذیرفته‌شده موفق؛ همان digestهای نهایی                                                                   |
| definition / monitoring rehearsal               | ۲۴ کنترل محلی موفق؛ جای پذیرش مانیتورینگ یا Backend واقعی Staging را نمی‌گیرد                                                                                                    |
| Match admission روی PostgreSQL نهایی            | ۳۴ تست موفق شامل تمام ۲۰ رقابت دوکلاینتی؛ هر مورد با همان مهلت ۵ ثانیه و همان invariantها                                                                                        |
| انتقال سازگار PostgreSQL                        | ۱۷ تست foundation، تطبیق ۴۴ جدول و دادهٔ Unicode/JSONB، constraint/grant، volume guard و restart موفق                                                                            |
| private/TTY و ingress                           | کنترل فایل/root و PTY واقعی + ۳ آزمون Nginx/TLS/admission موفق                                                                                                                   |
| مرورگر Admin                                    | ۷ fixture موفق؛ یک مورد مستقل عمداً skipped و همان مورد در Integration با Backend واقعی اجرا شده است                                                                             |
| مرورگر Web / CSP / preview                      | به‌ترتیب ۳۰ / ۸ / ۲ موفق                                                                                                                                                         |
| Midnight، Chromium/WebKit                       | ۱۳۰ مورد در اجرای گسترده موفق؛ ۶ مورد مرتبط پس از اصلاح انتظار flag روشن دوباره موفق، همان ۶ مورد با flag خاموش نیز موفق؛ مجموع سناریوها ۱۳۶، نه یک اجرای یکپارچهٔ تازهٔ ۱۳۶تایی |
| Kahroba، Chromium/WebKit                        | ۱۰۴ موفق                                                                                                                                                                         |
| dependency / Secret                             | صفر dependency finding؛ history: چهار detection مصوب و صفر blocker، candidate: یک detection مصوب و صفر blocker                                                                   |
| اسکن هفت runtime نهایی                          | **صفر finding در تمام severityها**، شامل HIGH/CRITICAL/UNKNOWN؛ Trivy 0.74.0 و DB تازه؛ [گزارش اسکن](../security/admin-phase2-release-scans.json)                                |

Inventory و digestهای دقیق، snapshot سورس dirty، hash ورودی Build و نتایج Qualification در [شواهد نسخه](../security/admin-phase2-image-qualification.json) ثبت می‌شوند. نام HEAD به‌تنهایی معرف تغییرات فعلی نیست. Qualification فقط برای همین artifactهای immutable است؛ بازسازی یا تغییر runtime/config/Migration نیازمند inventory و بررسی تازه است. اصلاحات صرفاً آزمون/گزارش پس از snapshot، به‌عنوان تغییر runtime جا زده نشده‌اند.

برخی اجراهای هم‌زمان Docker در مرحلهٔ تخصیص سرویس موقت متوقف شدند؛ اجرای ترتیبی Admin و artifactها از نام/volume تازه استفاده می‌کند. مجموعهٔ گسترده با مسیر بومی رسمی harness اجرا شد؛ نتیجهٔ آن به‌جای سنجش ظرفیت Docker یا سرور اعلام نمی‌شود. یک تست مرکب شامل ۲۰ رقابت در Docker از مهلت مجموع ۵ ثانیه عبور می‌کرد؛ علت با بازتولید هدفمند تأیید شد. همان ۲۰ رقابت به موارد مستقل با همان مهلت ۵ ثانیه و تمام invariantها تبدیل شدند و هر ۳۴ مورد مجموعه روی PostgreSQL نهایی گذشتند. نوع‌سنجی تازهٔ API نیز موفق است. هیچ timeout یا کنترل محصول افزایش نیافت و هیچ رقابتی حذف نشد.

## آماده‌بودن نصب و موارد باقی‌مانده

**مانع توسعه/اسکن/Qualification محلیِ شناخته‌شده باقی نمانده است.** برای نصب، تأیید جداگانهٔ مالک و اجرای کنترل‌های مقصد و بکاپ تازهٔ زیر لازم است؛ موفقیت محلی مجوز انتشار نیست.

[Runbook نصب](admin-phase-2-release-runbook.md) آماده است: بکاپ تازهٔ رمزگذاری‌شدهٔ کامل محصول و هویت ۹جدولی، کپی خارج سرور و Restore واقعی همان نسخه، نگه‌داری مستقل کلیدها، migration افزایشی، grant/CONNECT دقیق، تطبیق DNS/CA برای هر سه اتصال Admin، mutation ابتدا خاموش، drain، `nginx -t` و سلامت قبل/بعد. ابزارهای سروری با interpreter قدیمی باید در همان مجوز نصب بررسی شوند. بکاپ واقعی تازه، مهلت امنیتی و وضعیت فعلی سرور در این کار بررسی یا تغییر داده نشده‌اند.

Rollback محلی انتقال بین دو candidate سازگار را می‌آزماید؛ معادل تأیید بازگشت به نسخهٔ نصب‌شدهٔ فاز یک نیست. نسخهٔ قبلی واقعی باید پیش از نصب بررسی شود؛ اگر ناسازگار یا آسیب‌پذیر است، containment و forward fix لازم است، نه فعال‌سازی اجباری یا restore قدیمی روی دادهٔ جدید. وضعیت Match فعال با SQL معکوس نمی‌شود.

**Load/Stress و پذیرش ظرفیت با تصمیم صریح مالک به سرور آینده موکول‌اند. ظرفیت عملیاتی و Production تأیید نشده‌اند.** peak، SLO و soak آینده همچنان نیازمند تصمیم و آزمون همان محیط‌اند؛ هیچ gate امنیتی با این تعویق حذف نشده است.
