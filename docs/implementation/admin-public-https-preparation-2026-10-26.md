# آماده‌سازی Public HTTPS برای Admin — ۲۶ اکتبر ۲۰۲۶

> **پیگیری اجرا:** این سند گزارش آماده‌سازی اولیه است. تمدید واقعی آزمایشی در [گزارش گواهی](../operations/admin-certificate-dry-run-20261026.md) و انتشار جداگانهٔ مجاز Staging با hook جدید در [گزارش انتشار عمومی](../operations/admin-public-https-staging-20261027.md) ثبت می‌شوند. وضعیت‌های «نصب/حساب/انتشار مجاز نشده» در ادامه تاریخی‌اند؛ مجوز جدید فقط برای Staging است و فاز دو را شامل نمی‌شود.

> **تصمیم جدید مراسم Staging — [ADR-084](../adr/084-staging-owner-private-ssh-ceremony.md):** دو امضای Ed25519 و فایل credential خام برای Staging با پروفایل صریح SSH/root/TTY، تأیید عمل، checkpoint و Audit خصوصی جایگزین می‌شوند؛ Recovery به Password فعلی همان OWNER نیاز دارد. backup رمزگذاری‌شده و تمرین restore خارج سرور پیش‌نیازند. این تغییر محلی است؛ نصب، حساب واقعی، public ingress و فاز دو مجاز نشده‌اند. مطالب قبلیِ دو proof در این محدوده تاریخی‌اند؛ برای محیط‌های دیگر پابرجا هستند.

## نتیجه و مرز اجرا

این اصلاح ادامهٔ محدود **فاز یک، ورود و امنیت هویت خود OWNER** است. کد، migration افزایشی، config نمونهٔ Nginx، hook گواهی، تست و اسناد فقط در مخزن محلی آماده شده‌اند. **هیچ اتصال عملیاتی به سرور، نصب، migration، تغییر Firewall/DNS، restart، فعال‌سازی عمومی یا ساخت حساب واقعی انجام نشده است.** وضعیت نصب سرور همچنان همان SSH-only گزارش قبلی است. فاز دو آغاز نشده است.

تصمیم معتبر [ADR-083](../adr/083-admin-public-https-and-self-credential-rotation.md) است. الزام تونل برای مرورگر عادی از طرح هدف حذف شده؛ خصوصی‌بودن Backend و مسیر Bootstrap/Recovery حفظ شده است. باقی‌بودن یک gate سرور به معنی مجوز دورزدن آن یا تأیید انتشار نیست.

## مسیر هدف و سطح دسترسی

```text
هر مرورگر → https://admin.hambazi.top
  → Nginx: HTTPS معتبر، rate/body/connection limits، route/method allowlist
  → HTTPS با اعتبارسنجی CA و نام admin-api.internal
  → Backend خصوصی 10.89.18.14:9444، بدون published port
  → PostgreSQL / Redis با role و ACL مستقل و TLS

اپراتور مجاز + دو proof مستقل → SSH خصوصی → Bootstrap/Recovery
```

| مسیر                                                      | دسترسی و کنترل                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `/`، `index.html` و assetهای محلی                         | قابل‌دسترسی عمومی فقط پس از مجوز انتشار و gate گواهی؛ CSP و no-store                    |
| `POST /v1/admin/auth/login`                               | Username/Password، بدون session قبلی؛ Origin/Host دقیق، rate limit و پیام عمومی         |
| `POST /v1/admin/auth/pin`                                 | فقط cookie نوع PENDING معتبر و CSRF؛ بدون دسترسی به داده                                |
| اطلاعات داشبورد و کاربران/بازی‌ها/اتاق‌ها/Match           | FULL session، نقش/permission/scope جاری در Backend                                      |
| `POST /v1/admin/auth/password/change` و `/pin/change`     | فقط OWNER حاضر در FULL session، CSRF، Password و PIN فعلی؛ باطل‌کردن همهٔ نشست‌های قبلی |
| Logout و session/access خود                               | FULL session؛ mutation دارای CSRF؛ polling دسترسی idle را تمدید نمی‌کند                 |
| Signup/Forgot/Bootstrap/Recovery/Unlock/SQL/metrics proxy | هیچ مسیر عمومی ندارند؛ route/method ناشناخته در Nginx رد می‌شود                         |

ورود عادی مدیر با Password مستقیم است؛ OWNER پس از Password فقط PENDING می‌گیرد و پس از PIN شش‌رقمی FULL می‌شود. PENDING در هیچ guard به‌عنوان session مدیریتی پذیرفته نمی‌شود. غیرفعال‌شدن/تغییر epoch یا grant از primary بررسی می‌شود. مخفی‌کردن UI جای این بررسی نیست.

## تغییرات کد و حفاظت‌های اجرایی

- `packages/config/src/admin.ts`: `ADMIN_INGRESS_MODE=public-proxy` و `ADMIN_PROXY_PEERS` به‌صورت صریح لازم‌اند. پیش‌فرض سازگار `private` باقی می‌ماند؛ صرف نصب کد ورود عمومی را فعال نمی‌کند. peerهای proxy باید خصوصی، متمایز از bind و در private allowlist باشند. تنظیم public bind همچنان رد می‌شود.
- `apps/api/src/composition/admin-http.ts`: IP فقط از `X-Hambazi-Client-IP` تک-IP معتبر و socket peer مورد اعتماد پذیرفته می‌شود. Nginx آن را با `$remote_addr` بازنویسی می‌کند؛ زنجیرهٔ XFF، هدر identity و `trustProxy=true` استفاده نمی‌شوند. limiter Redis، IP کاربر را می‌بیند؛ هویت کاربر همچنان فقط session معتبر است. health check خصوصی از IP خود Backend هدر پراکسی نمی‌دهد.
- `apps/api/src/admin/infrastructure/http.ts`: global guard روی module، handler بدون policy را می‌بندد؛ capability ثبت‌نشده رد است. در کنار آن، کنترل scope و سیاست دامنهٔ هر use case باقی است. CSRF mutationها در guard هم بررسی و نتیجهٔ auth فقط در همان request reuse می‌شود.
- `application/service.ts`: تغییر Password و PIN از مسیر مشترک reauthentication/lock/version fence اجرا می‌شوند. Hash بیرون transaction کوتاه، سپس recheck root/session/version؛ Audit، receipt، verifier و epochها اتمیک‌اند. Password غلط، شمارندهٔ PIN را تغییر نمی‌دهد؛ PIN غلط بعد Password صحیح در همهٔ مسیرهای حساس از همان counter استفاده می‌کند. retry ناموفق همان commandId دوباره شمرده نمی‌شود.
- `apps/admin/src/app.tsx`: صفحهٔ «امنیت حساب مالک» با دو گزینهٔ Password/PIN، تأیید مقدار جدید و توضیح خروج همهٔ نشست‌ها. پس از موفقیت به login برمی‌گردد؛ raw input در storage مرورگر نوشته نمی‌شود و فیلدها پس از درخواست پاک می‌شوند. تغییر هر دو secret دو اقدام مستقل با reauthentication و ورود مجدد است؛ تغییر PIN به‌تنهایی Password را عوض نمی‌کند.
- `infra/docker/admin/public-https.conf`: candidate قابل‌بررسی با allowlist هدر/route/method، TLS upstream، no request/response buffering، سقف ۸ KiB، CSP، no-store و بدون access log حاوی credential. حالت public از CDN مستقل فرض شده؛ اگر Cloudflare proxy در آینده فعال شود، زنجیرهٔ IP باید جدا qualify شود، نه با اعتماد به هدر عمومی آن.
- `infra/scripts/admin-security.py`: profile کنترل باید با env واقعی برابر باشد. در public-proxy، **فایل hook تحت hash کنترل و مالکیت root** قرار دارد و certificate زنده با chain/hostname/key و receipt خصوصی تطبیق می‌کند. image/container/file hash، expiry و containment قبلی حذف نشده‌اند. تغییر فایل‌های bind‌شده نیازمند qualification انتشار تازه است؛ hash جدید نباید صرفاً برای ساکت‌کردن gate جایگزین شود.

API تولیدشده `1.1.0` است؛ مسیر جدید additive است و baseline v1 قبلی بازنویسی نمی‌شود. session/cookie/security schemaهای قدیمی تغییر wire نمی‌کنند.

### نقش محدود شبکه در public profile

allowlist داخلی بین Nginx و Backend همچنان لازم است؛ allowlist مراجعه‌کنندگان اینترنتی یا VPN شرط ورود عادی نیست. request headerها از client به‌طور آزاد forward نمی‌شوند: فقط Host ثابت، Cookie، Origin، Content-Type، CSRF، Authorization برای رد bearer نامعتبر، و هدر IP بازنویسی‌شده عبور می‌کنند. Bootstrap حتی با session کامل OWNER از این مسیر عمومی قابل اجرا نیست.

پروفایل اولیهٔ edge: ۱۲۰ request/min/IP با burst ۲۰؛ ۲۰ auth/min/IP و ۳۰ auth/min کل پنل هرکدام burst ۱۰؛ سقف کل ۲۰ request/s با burst ۳۰ و ۱۰ اتصال همزمان/IP. Backend همچنان سقف in-flight/KDF/pool و limiter توزیع‌شده دارد. این‌ها مقادیر صریح candidate کوچک اولیه‌اند، نه ادعای پذیرش بار عمومی یا تنظیم پنهان production. پشت NAT چند مدیر quota مشترک خواهند داشت. سقف auth کل، هزینهٔ KDF و حجم Audit شکست ورود را نیز محدود می‌کند.

## داده، Migration و rollback

Migration `202610260001_admin_password_rotation` فقط `PASSWORD_CHANGED` را به check constraint رویدادهای Audit اضافه می‌کند؛ جدول یا دادهٔ بازی تغییر نمی‌کند. runtime grant در فایل جدا `admin-permissions.sql` فقط مجوز UPDATE ستون `password_verifier` را اضافه می‌کند؛ مالکیت، نام/نقش/status مدیر یا جدول‌های محصول همچنان قابل ویرایش نیستند. شمار migration در inventory جدید ۱۷ است.

ترتیب انتشار آینده: backup مجاز و سازگار → migration افزایشی با نسخهٔ قبلی → narrow grant → کد/پیکربندی جدید در مسیر بسته و qualification → فعال‌سازی فقط با تأیید جدا. بدون grant/schema کامل، تغییر Password جدید باید fail closed کند؛ برای رفع آن به runtime مالک schema یا superuser داده نمی‌شود. نسخهٔ قبلی با event جدید به‌صورت string سازگار است. rollback اپراتوری Admin را با maintenance می‌بندد و نسخه/env/Nginx قبلیِ واجد شواهد معتبر را برمی‌گرداند؛ down migration یا restore خودکار دیتابیس مشترک انجام نمی‌شود.

به دلیل profile جدید، مسیر loopbackِ canary نیز باید هدر IP معتبر را از Nginx بفرستد؛ پراکسی SSH-only قدیمی با Backend در حالت public-proxy بدون این هدر عمداً 403 می‌گیرد. این تغییر باید در diff انتشار دیده و خصوصی آزمایش شود، نه با ضعیف‌کردن کنترل header.

## تمدید گواهی: چه چیزی آماده است و چه چیزی ثابت نشده؟

**مشکل خروجی واقعی سرور هنوز رفع‌شده یا آزمایش‌شده اعلام نمی‌شود.** این نوبت مجوز تغییر سرور ندارد. timeout قبلی اتصال مستقیم Let’s Encrypt و وابستگی صدور اولیه به تونل رایانهٔ اپراتور، با تست محلی ناپدید نمی‌شوند.

کد `infra/scripts/admin-certbot-hook.py` برای reuse timer موجود Certbot آماده است؛ lineageهای دیگر را بی‌اثر رد می‌کند. برای `hambazi-admin`:

1. مسیر root-owned و symlinkهای مجاز فقط به archive همان lineage، permission کلید و ساختار فایل‌ها بررسی می‌شوند.
2. OpenSSL، system CA، نام `admin.hambazi.top`، کاربرد serverAuth، انقضا با حاشیهٔ هفت روز و تطبیق public key کلید خصوصی با cert را می‌سنجد؛ TLS verification خاموش نمی‌شود.
3. `nginx -t` پیش از reload اجرا می‌شود؛ fingerprint گواهی واقعاً سرو‌شده با SNI روی loopback:443 باید با cert جدید برابر باشد. receipt خصوصی فقط پس از موفقیت همهٔ این مراحل ثبت می‌شود.
4. marker عمومی یا maintenance را باز نمی‌کند، روی DB/حساب‌ها اثر ندارد و image policy را بازنویسی نمی‌کند. شکست hook موفقیت کاذب ثبت نمی‌کند. این hook فقط certificate عمومی دامنه را پوشش می‌دهد؛ CA و leaf خصوصی Backend نیز inventory/تاریخ انقضا و مسیر rotation مستقل لازم دارند و با خاموش‌کردن TLS verification جایگزین نمی‌شوند.

طبق [راهنمای رسمی Certbot](https://eff-certbot.readthedocs.io/en/stable/using.html)، hook deploy فقط پس از تمدید موفق اجرا می‌شود؛ خطای hook به‌تنهایی الزاماً exit اصلی Certbot را ناموفق نمی‌کند. در dry-run باید `--run-deploy-hooks` صریح باشد؛ hook آن مرحله گواهی فعال فعلی را می‌بیند، نه گواهی آزمایشی. بنابراین active بودن timer، `renew` بدون کار به دلیل سررسیدن‌نشدن، یا exit صفر به‌تنهایی gate پذیرش نیستند.

### شرط لازم پیش از انتشار عمومی — فقط پس از مجوز سرور

1. اپراتور مسیر DNS/A/AAAA، TCP و TLS خروجی هر دو ACME directory لازم را از **خود سرور** با trust معتبر بررسی و علت timeout را مشخص کند. اصلاح route/DNS/egress یا proxy مدیریت‌شدهٔ پایدار میزبان، diff و تأیید جدا می‌خواهد؛ proxy موقت لپ‌تاپ، غیرفعال‌کردن TLS و fallback مخفی راه‌حل نیستند. محیط شبکهٔ timer و آزمون باید یکسان و مستقل از SSH session رایانهٔ اپراتور باشند.
2. candidate فقط با login عمومی بسته و ACME HTTP-01 قابل‌دسترسی نصب شود. نبود `/var/www/hambazi-admin/public-enabled` پاسخ HTTPS را 503 نگه می‌دارد؛ marker عمومی در این نوبت ساخته نشده است.
3. hook بازبینی‌شده به lineage و timer واقعیِ Certbot وصل شود. فرمان زیر **دستور آینده و اجرا‌نشده** است و دقیقاً یک cert را هدف می‌گیرد؛ اگر Certbot هدف این flags را پشتیبانی نکند انتشار متوقف می‌شود:

```sh
certbot renew --cert-name hambazi-admin --dry-run --run-deploy-hooks \
  --no-random-sleep-on-renew \
  --deploy-hook /opt/hambazi/admin/ops/admin-certbot-hook.py
```

4. موفقیت واقعی challenge/renewal، receipt تازهٔ hook، certificate سرو‌شده، permission کلید و qualification controller جدید جدا بررسی شوند. renewal نباید نیازمند کارکردن رایانه یا تونل اپراتور باشد. وضعیت timer/service، اجرای بعدی و مسیر بررسی خطا نیز باید واقعی باشند. این گزارش هیچ receipt جعلی برای این مراحل تولید نکرده است.
5. app/private canary، auth/CSRF/permission/rotation، نبود published port و بسته‌بودن Bootstrap/Recovery qualify شوند. artifactهای محلی، تأیید image/scan و health جدید را جایگزین نمی‌کنند. دسترسی عادی public فقط با تأیید صریح مالک و پس از همهٔ این gateها فعال شود.

اطلاعات اتصال SSH و credentialها داخل این config یا گزارش قرار نمی‌گیرند؛ public hostname یک secret نیست. root/DBA مخرب و گم‌شدن همزمان backup/key همچنان خارج توان RBAC برنامه‌اند.

## شواهد تست محلی و محدودیت‌ها

تمام account/key/credentialهای تست مصنوعی و در حافظه یا منابع disposable متعلق به همان runner هستند؛ هیچ account واقعی یا fixture روی Staging/Production ساخته نشده است. runner ingress هیچ URL هدف نمی‌پذیرد و دستورات تخصیص تست به Unix socket محلی Docker مقیدند تا context راه‌دور توسعه‌دهنده نتواند مقصد را عوض کند؛ Nginx دقیقِ digest موجود را فقط روی loopback و پورت تصادفی اجرا و در پایان منابع خودش را پاک می‌کند. آزمون certificate محلی، صدور عمومی یا سلامت egress واقعی نیست.

نتایج نهایی دستورها پس از اجرای همین نسخه در پایین ثبت می‌شوند؛ موفقیت‌ها دامنهٔ محلی دارند:

| بررسی                        | شواهد                                                                                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API unit/security            | ۶۰ فایل و ۱۰۳۶ موفق؛ شامل default-deny و Password/PIN/session/audit/race                                                                                                                              |
| PostgreSQL/Redis integration | ۱۲ موفق با migration واقعی، Hash، audit rollback، race تغییر رمز و restart پایدار PIN lock                                                                                                            |
| Browser Admin                | شش E2E موفق: ورود OWNER/مدیر، قفل، revoke، RTL/axe/CSP، تأیید و پاک‌کردن فرم Password/PIN                                                                                                             |
| Nginx واقعی → HTTPS خصوصی    | admission بسته، ACME و redirect، هدر IP جعلی، PENDING، scopes، CSRF، route deny، credential rotation و edge rate limit؛ سه تست موفق؛ نام غلط upstream پیش از رسیدن درخواست به برنامه با 502 رد می‌شود |
| Config                       | ۱۹ فایل و ۲۷۸ تست config موفق، شامل چهار تست profile Admin                                                                                                                                            |
| Infra                        | اجرای serial: ۲۱ فایل، ۱۹۲ موفق، دو skip موجود؛ hook/receipt و gateها شامل‌اند                                                                                                                        |

اجرای اول infra همزمان با کارهای سنگین، سه timeout پنج‌ثانیه‌ای در تست‌های موجود capacity harness داشت؛ اجرای serial بدون تغییر timeout/assertion موفق شد. این شکست اولیه حذف نشده است. browser با mock قرارداد، Backend با integration واقعی و Nginx با Backend واقعی جدا آزموده شده‌اند؛ ادعای مرورگر متصل به دیتابیس زندهٔ سرور یا عبور CI راه‌دور نمی‌شود.

`pnpm check` سراسری و gate secret/history با این گزارش خودبه‌خود سبز نیستند؛ شکست‌های قدیمی Web SSR و provenance scan در گزارش قبلی ثبت شده‌اند و خارج این اصلاح‌اند. تغییر احراز هویت نباید برای عبور CI به suppress گسترده یا ضعیف‌کردن تست منجر شود.

نصب frozen lockfile، buildهای API/Admin/config، typecheckهای مرتبط، lint سراسری، architecture checks و بررسی همهٔ قراردادهای API موفق‌اند. اسکن dependency با policy موجود صفر finding در همهٔ severityها داشت. آزمون unit کل API ۱۰۳۶ و unit خود UI دو تست موفق داشتند. یکی از تکرارهای integration پیش از SQL در مرحلهٔ ساخت container محلی شکست خورد؛ علت قطعی از پیام محدود harness تعیین نشد، منابع اختصاصی باقی نماندند و اجرای مجدد ۱۲/۱۲ موفق بود. این رخداد به خطای تراکنش Password یا موفقیت محیط سرور تعبیر نمی‌شود.

گیت‌های pull ایمیج Nginx آزمایشیِ pinned و `test:admin:ingress` به CI اضافه شده‌اند تا تست روی runner تمیز به artifact محلی خصوصی وابسته نباشد؛ CI راه‌دور اجرا نشده است. فایل test-image فقط fixture است و مجوز استفاده از آن در deployment یا جایگزین scan واقعی نیست.

## ریسک‌ها و توقف

**Password + PIN ثابت همچنان MFA مستقل یا مقاوم به phishing نیست.** Public HTTPS سطح حمله را افزایش می‌دهد؛ رمز سرقت‌شده هنوز می‌تواند با سه PIN غلط OWNER را قفل کند. Argon2id/pepper، rate چندلایه، محدودیت KDF، CSP، origin/cookie/CSRF، Audit و recovery خصوصی کنترل جبرانی‌اند. جست‌وجوی پیشرفتهٔ Audit، هشدار خودکار، retention و بار مشترک نیازهای عملیاتی مستقلی‌اند؛ vendor/secret/عدد production جدید فرض نشده است.

پیش‌نیازهای [آمادگی OWNER](admin-owner-readiness-2026-10-26.md) دربارهٔ دو کلید مستقل، ورودی خصوصی بدون فایل، custody و backup/restore هنوز با این اصلاح حل نمی‌شوند؛ سرور حتی Password change جدید را تا deployment ندارد. ایجاد نخستین حساب و استفاده از credential موقت باید در مراسم جدا و بدون ارسال رمز در چت انجام شود. public کردن login مجوز انتشار بازی‌ها، رفع موانع هویت یا شروع فاز دو نیست.

**توقف این نوبت:** تحویل کد و تست محلی برای review؛ هیچ فرمان سرور یا Firewall و هیچ فعال‌سازی عمومی انجام نمی‌شود. رفع/آزمون egress و renewal واقعی و نصب artifact مرحلهٔ بعد و وابسته به تأیید جدا هستند.
