# گزارش توسعهٔ محلی فاز دوم Admin Dashboard

> این گزارش سابقهٔ تحویل اولیه است. بازنگری آماده‌سازی انتشار در [گزارش رفع موانع](admin-phase-2-release-readiness.md)، شواهد اسکن تازه در [نتایج امنیتی](../security/admin-phase2-release-scans.json) و برنامهٔ نصب/بکاپ/بازگشت در [runbook انتشار](admin-phase-2-release-runbook.md) ثبت می‌شوند. طبق ADR-087، محروم‌سازی در نسخهٔ فعلی غیرفعال است؛ ادعای قبلی اجرای آن در ادامه مجوز فعال‌سازی نیست.

**تاریخ: 2026-10-27 — توسعهٔ محلی؛ بدون استقرار یا مجوز انتشار.** حساب واقعی OWNER، PIN، داده‌های Staging/Production، Firewall و ingress سرور دست‌نخورده‌اند. همهٔ حساب‌ها و داده‌های تست در محیط‌های موقت محلی ساخته شده‌اند. این گزارش جای تأیید امنیتی انتشار یا اجازهٔ فاز سوم نیست.

## خروجی

- مدیریت مدیر عادی فقط توسط OWNER: ساخت Username یکتا و رمز CSPRNG دقیقاً ۱۲ نویسه، نمایش یک‌باره، reset رمز مدیر عادی، فعال/غیرفعال/حذف منطقی و ابطال نشست‌ها. هیچ reset/forgot رمز OWNER یا مسیر ایجاد مالک دوم اضافه نشده است.
- الگوهای Super Admin/Moderator/Support/Operator، نقش سفارشی، عضویت و override با تقدم deny؛ scope محیط/بازی/بخش در Backend و پیش از pagination/detail enforce می‌شود. OWNER فقط برای permission ثبت‌شده اختیار خودکار دارد؛ guard هویت، Audit و یکپارچگی داده حذف نمی‌شوند.
- پیش‌نمایش تعداد اعضای متأثر از تغییر/حذف نقش به payload و digest متصل است؛ تغییر عضویت، revision و تأیید قبلی را باطل می‌کند. دسترسی جاری از primary خوانده می‌شود؛ UI هر ۲٫۵ ثانیه بررسی و با lease پنج‌ثانیه‌ای داده/cache را پاک می‌کند.
- جریان request/approval/execute با reason، digest، expectedVersion، تأیید OWNER_FINAL یا دو مدیر متمایز، reauth و rotation نشست؛ challenge ۱۲۰ ثانیه و مجوز اجرا حداکثر ۶۰ ثانیه. محدودیت پایدار سه خطای PIN و اعتبارسنجی Password پیش از شمارش PIN حفظ شده‌اند. Password+PIN ثابت، MFA مستقل نیست.
- اثر/receipt در تراکنش ماژول مالک؛ Audit پذیرش پیش از اثر و ثبت نتیجه پس از receipt، deduplication و وضعیت واقعی UNKNOWN. reconciliation فقط receipt ثبت‌شده را می‌خواند؛ retry پس از expiry نیازمند renew همان UUID و تأیید تازه است.
- اصلاح نام و محروم‌سازی/رفع محرومیت کاربر مطابق ADR-086؛ نسل پایدار نشست مانع زنده‌شدن token قدیمی پس از unban است. پذیرش بازی جدید با gate مستقل از release، بستن اتاق پیش از شروع و termination محدود Match بدون تغییر hidden state، engine pins، نتایج یا آمار.
- UI فارسی RTL و responsive برای مدیران، نقش‌ها، نشست/فعالیت، درخواست و تأیید. دادهٔ حساس خروجی و ورودی فقط در حافظهٔ صفحه است. API پیش‌فرض بسته، CSRF، HTTPS و rate limit حفظ شده‌اند؛ کاندید Nginx با مسیرهای ثبت‌شده همگام است.
- نوشتن role/operation با شرط realm حتی هنگام برخورد UUID کنترل می‌شود؛ آزمون PostgreSQL مانع overwrite دادهٔ realm دیگر است. دو Migration افزایشی و grant کمینه برای role جداگانهٔ عملیات آماده‌اند؛ **روی سرور اجرا نشده‌اند**. mutationها پیش‌فرض خاموش‌اند و URL عملیات باید به همان primary با role اختصاصی متصل شود؛ fallback به credential بازیکنان وجود ندارد.
- قالب بکاپ هویت ۹جدولی، پشتیبانی خواندن قالب قدیمی شش‌جدولی و restore واقعی ایزوله؛ bundle خصوصی تأییدشده و بکاپ‌های واقعی مالک تغییر نکرده‌اند. بکاپ هویت جای بکاپ کامل دادهٔ محصول نیست.

تصمیم‌ها: [ADR-085](../adr/085-admin-phase-two-operations.md)، [ADR-086](../adr/086-admin-user-ban-and-session-generation.md). مراجع ADR-039/078/079 و اسناد معماری به این دو تصمیم متصل شده‌اند. سرویس، dependency یا سامانهٔ هویتی جدید اضافه نشده است.

## شواهد تست

| بررسی                                                                         | نتیجهٔ اجرای نهایی                                                                                                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`، `pnpm lint`، `pnpm check:architecture`، `pnpm typecheck` | موفق؛ ۱۶ workspace، ۳۴۴ فایل source در بررسی مرز معماری                                                                                                                  |
| `pnpm build` و `pnpm --filter @hambazi/api contract:check`                    | موفق؛ ۱۴ task build، قراردادهای قدیمی و Admin تازه سازگار                                                                                                                |
| `pnpm --filter @hambazi/api test`                                             | ۶۲ فایل / ۱۰۶۲ تست موفق                                                                                                                                                  |
| `pnpm --filter @hambazi/database test`                                        | ۳۶ تست موفق؛ مرز receipt/قفل تازه و fixtureهای callers نیز اصلاح و آزموده شدند                                                                                           |
| `pnpm --filter @hambazi/config test`                                          | ۲۷۹ تست موفق، شامل بستن mutation ناقص و role/primary ناسازگار                                                                                                            |
| `pnpm exec turbo run test --filter='!@hambazi/web' --concurrency=2`           | ۳۷ task موفق در workspaceهای غیر Web؛ اجرای جداگانهٔ تشخیصی، بدون تغییر CI یا حذف gate Web                                                                               |
| `pnpm --filter @hambazi/api test:admin:local`                                 | ۱۳ تست امنیت فاز اول + ۸ تست فاز دوم + ۴ تست واقعی بکاپ/restore؛ هر سه نشانگر نهایی PASSED                                                                               |
| `pnpm --filter @hambazi/api test:admin:ingress`                               | ۳ تست موفق با Nginx واقعی محلی و `nginx -t`؛ خطای quote عبارت `{36}` کاندید رفع شد                                                                                       |
| `pnpm test:infra --maxWorkers=2`                                              | ۱۹۲ تست موفق و ۲ canary اختیاری اجرا‌نشده به‌دلیل نبود `SECURITY_SCANNER_DIR` در این اجرا؛ اسکن واقعی Secret جداگانه انجام شد                                            |
| `pnpm --filter @hambazi/api test:admin:private`                               | هر دو کنترل فایل خصوصی/root و TTY واقعی موفق                                                                                                                             |
| `pnpm --filter @hambazi/admin test:browser`                                   | ۷ سناریوی fixture موفق؛ سناریوی هشتم مخصوص Backend واقعی فقط در harness بالا اجرا و موفق شد                                                                              |
| UI با Backend واقعی در harness                                                | OWNER login/PENDING، CSRF، رمز یک‌باره، rotation، نقش چندقیدی و ماندگاری آن، accessibility بدون violation و موبایل بدون overflow؛ تصاویر صرفاً fixture محلی بازبینی شدند |
| dependency scan                                                               | موفق، صفر finding در تمام severityها؛ lockfile و dependencyها تغییر نکرده‌اند                                                                                            |
| Secret scan                                                                   | **BLOCKED**: تاریخچه ۳ مورد خارج از استثنای مصوب؛ tree فعلی ۱ مورد؛ جزئیات در بخش مانع امنیتی                                                                            |
| `pnpm check` / تست Web بازیکنان                                               | **موفق نیست**؛ بعد از اصلاح تست‌های DB، Web جداگانه ۱۳۴ موفق / ۳ ناموفق دارد. هیچ فایل Web تغییر نکرده است                                                               |

سه شکست Web در `apps/web/tests/unit/owner-staging.test.tsx` مربوط به SSR لابی/کارت کهربا/عکس پروفایل‌اند: به‌جای محتوای مورد انتظار، Loading اولیه render می‌شود. هر سه نام تست در کپی موقت سورس HEAD `a24ce45`، با dependencyهای تثبیت‌شده و build جداگانهٔ Shared/Contracts/Validation پایه نیز شکست خوردند؛ کپی پایه آزمون‌های قدیمیِ ناموفق دیگری هم دارد و green کامل ادعا نمی‌شود. کپی موقت پاک شد. این گزارش شکست سراسری را پنهان یا تست Web را در CI مستثنا نمی‌کند؛ رفع آن بدهی جداگانهٔ خارج از diff فاز دوم است.

## پذیرش و محدودیت‌ها

| معیار            | شواهد/محدوده                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01…05 و AC-09 | deny-by-default، schema سخت‌گیرانه، عدم delegation مجوزهای admins/roles، حفاظت مالک در application و SQL، deny و scope قبل از query/pagination؛ تست‌های Admin و PostgreSQL                                    |
| AC-06/07/08/18   | Bootstrap/Recovery خصوصی فاز اول تغییر نکرده‌اند؛ Local Auth جای invite/IdP قبلی است. emergency عمومی فعال نشده؛ آزمون TTY و بکاپ قدیم/جدید انجام می‌شود، بدون ساخت حساب واقعی                                |
| AC-10/11/12      | primary authority، policy/auth/session version، عدم احیای نشست پس از فعال‌سازی مجدد؛ آزمون مرورگر revoke و پاسخ معلق ≤۵s. qualification چند replica، failover و بار هم‌زمان در سرور در این تحویل ادعا نمی‌شود |
| AC-13…17         | OWNER_FINAL، منع خودتأییدی غیرمالک، expiry/replay/revision، Audit failure قبل اثر، UNKNOWN و deduplication؛ unit و DB race                                                                                    |
| AC-19/20         | writer lock مشترک و حفظ snapshot/pins/results، قفل Room در رقابت start، preview تعداد اعضای نقش و ابطال تأیید با تغییر عضویت                                                                                  |
| AC-21/22         | مرورگر با Backend واقعی TLS، PENDING بدون اختیار، CSRF، رمز یک‌باره و rotation، editor با allow/deny چندقیدی، RTL/mobile و accessibility؛ تست ingress مستقل از OpenAPI                                        |

فهرست عملیات، نشست‌ها و فعالیت هر مدیر فعلاً ۵۰ مورد اخیر را نشان می‌دهد؛ دادهٔ قدیمی حذف نمی‌شود و export/گزارش تاریخی پیشرفته خارج از این فاز است. فهرست مدیران و منابع محصول pagination دارد. سقف نقش ۱۰۰، عضویت ۱۶ و grant مؤثر ۲۵۶ است. admission عبورکرده از gate پیش از commit تغییر بازی، in-flight محسوب می‌شود؛ بستن پذیرش، بازی فعال را متوقف نمی‌کند.

## مانع امنیتی انتشار

اسکن Secret با gitleaks 8.30.1 و hash ابزار مصوب اجرا شده است. گزارش اولیه علاوه بر استثنای دقیق مصوب، دو literal ساختگی در تست‌های تاریخی و یک revision عمومیِ بخش `previousContinuousApplication.roleSourceCommits.api` در `infra/docker/staging/staging-test-user-current.json` را شناسایی کرد؛ `git cat-file -t` عمومی‌بودن هر دو revision این سند را به‌عنوان commit تأیید کرد. نمونهٔ تست تازه و literalهای تست فعلی به ورودی غیرثابت تبدیل شدند. تاریخچهٔ Git بازنویسی و allowlist/سیاست اسکن تغییر نکرده است. **موارد خارج از استثنای دقیقِ فعلی همچنان gate انتشار را مسدود می‌کنند**؛ نتیجهٔ بررسی انسانی مجوز دورزدن scanner نیست. اجرای نهایی: history دارای ۴ detection، شامل ۱ مورد مصوب و ۳ مورد مسدودکننده؛ current دارای ۱ detection و همان ۱ مورد مسدودکننده است. مطابق [ADR-068](../adr/068-exact-public-provenance-secret-scan-exception.md)، هر field/location/source جدید نیازمند تصمیم صریح مستقل است؛ استثنای تازه‌ای اعمال نشد.

## مراحل لازم پیش از نصبِ دارای مجوز

۱. رفع سه شکست قدیمی Web و مانع اسکن Secret بدون حذف کنترل یا بازنویسی بی‌مجوز تاریخچه؛ ساخت artifact/ایمیج تثبیت‌شده و scan و Qualification معتبر همان نسخه. Qualification سرور، deadline امنیتی یا وضعیت timer آن در این کار بررسی/تغییر نشده است.
۲. بکاپ تازهٔ کامل محصول و هویت، انتقال رمزگذاری‌شده به خارج سرور و restore ایزولهٔ همان نسخه با ورود عبارت فقط توسط مالک؛ نصب bundle خصوصی سازگار نیز مجوز می‌خواهد.
۳. dry run Migration و grants؛ نصب هماهنگ Auth/API/Gateway سازگار با نسل نشست و drain نسخهٔ قدیمی **پیش از فعال‌سازی ban/unban**؛ role کمینه و pool/timeout محدود عملیات جدا باشند.
۴. فقط با تأیید جداگانه: سلامت پیش از نصب، schema افزایشی و release overlap، نصب کد با mutation خاموش، `nginx -t`، smoke هویت/CSRF/RBAC و سپس فعال‌سازی کنترل‌شده؛ OWNER واقعی عمداً قفل یا تغییر داده نشود.
۵. بازگشت: ابتدا mutation بسته، UNKNOWNها با receipt محصول reconcile، سپس rollback سازگار. پس از ban/unban، بازگشت به Auth قدیمی امن نیست؛ Match/Room خاتمه‌یافته یا نتیجهٔ ثبت‌شده با SQL معکوس دست‌کاری نمی‌شود. بازگردانی قابل‌اجرا فقط فرمان جدید با نسخهٔ جاری است.

workload هم‌زمان Admin، peak و بودجهٔ latency/SLO پیش از پذیرش عملکرد در Staging باید تعیین شوند؛ load/soak، پذیرش چند replica و بازی واقعی بازیکنان در سرور اجرا نشده‌اند. تکمیل تست محلی این gateها را تصویب نمی‌کند. فاز سوم آغاز نشده است.
