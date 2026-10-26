# انتشار خصوصی HamBazi Admin — ۲۶ اکتبر ۲۰۲۶

> **پیگیری انتشار:** مسیر SSH-only این سند وضعیت تاریخی نصب خصوصی است. تصمیم و مجوز بعدیِ Public HTTPS فقط برای Staging در [گزارش انتشار عمومی](../operations/admin-public-https-staging-20261027.md) پیگیری می‌شود. Bootstrap/Recovery با این تغییر عمومی نمی‌شوند؛ Production و فاز دو خارج از مجوزند.

> **نصب جدید خصوصی:** [گزارش نصب ابزار OWNER و تغییر credential](admin-private-owner-installation-2026-10-26.md) وضعیت نسخهٔ مستقر جدید، migration هفدهم و پیش‌نیازهای باقی‌مانده را ثبت می‌کند. اطلاعات image و شمار migration در ادامه، سابقهٔ انتشار نخست هستند. دسترسی همچنان SSH-only است و حسابی ایجاد نشده است.

> **آماده‌سازی جدید، بدون تغییر سرور:** [گزارش Public HTTPS](admin-public-https-preparation-2026-10-26.md) و [ADR-083](../adr/083-admin-public-https-and-self-credential-rotation.md) مرجع کد جدید ورود عمومی و self-service Password/PIN هستند. وضعیت‌های این سند سابقهٔ زمان گزارش‌اند؛ کد جدید هنوز مستقر نشده و gateهای Bootstrap/Recovery واقعی و مجوز انتشار باقی‌اند.

**بازبینی پس از انتشار:** [آمادگی OWNER در ۲۶ اکتبر](admin-owner-readiness-2026-10-26.md) بررسی خواندنی تازه، موانع ایجاد حساب و مسیر تهیهٔ کلیدها/ورود تعاملی را ثبت می‌کند. انتشار فاز یک، آماده‌بودن CLI بدون فایل یا تغییر Password را ثابت نمی‌کند؛ حساب همچنان ایجاد نشده است.

## نتیجه و محدوده

با درخواست صریح مالک برای انتشار و انتخاب «فقط تونل SSH»، **فاز یک** روی سرور موجود منتشر شد. زمان رسید نهایی `2026-10-25T20:43:26Z`، برابر با بامداد ۲۶ اکتبر به وقت تهران است. مرجع تصمیم [ADR-082](../adr/082-admin-private-ssh-deployment.md) و مرجع عملکرد برنامه [گزارش فاز یک](admin-dashboard-phase-1.md) هستند.

صفحهٔ ورود در `https://admin.hambazi.top` فقط از مسیر SSH قابل استفاده است؛ بازکردن دامنه از اینترنت باید شکست بخورد. **هیچ حساب مدیر یا OWNER و هیچ نشست مدیریتی ساخته نشده است.** فقط realm خالی `staging` برای تنظیم محیط و ثبت ورود ناموفق وجود دارد. ورود واقعی به ceremony خصوصی بعدی، اطلاعات انتخاب‌شدهٔ مالک و تأیید مستقل او وابسته است. فاز دو، مدیریت مدیران و عملیات تغییردهندهٔ محصول اجرا نشده‌اند.

## مسیر اجراشده

```text
مرورگر: https://admin.hambazi.top:443
  → تونل SSH احرازشده
  → Nginx سرور: 127.0.0.1:9443، گواهی معتبر همین دامنه
  → HTTPS با اعتبارسنجی CA: admin-api.internal / 10.89.18.14:9444
  → PostgreSQL / Redis موجود، TLS و credentialهای مستقل Admin
```

HTTP عمومی فقط ACME challenge را سرو می‌کند؛ HTTPS عمومی این hostname با `ssl_reject_handshake` بسته است. پورت‌های ۹۴۴۳ و ۹۴۴۴ از اینترنت قابل اتصال نیستند. کانتینر `hambazi-admin-api` هیچ published port ندارد؛ user برابر `1000:1000`، root filesystem فقط‌خواندنی، cap-drop ALL، no-new-privileges، سقف حافظهٔ ۳۸۴ MiB، نیم CPU و محدودیت PID دارد. Systemd مالک lifecycle است؛ Docker restart policy برابر `no` است.

ایمیج فعال از artifact دقیق ساخته شده، نه از pull یک tag شناور:

- image ID: `sha256:555792041c92f20da9770554ae6dd9a36dbcabbe0e9ac0d3d1ddff44105d0fb4`
- payload SHA-256: `4b48e9f5ceed4e7b1f08a1ee7ccf7cc95b51c70472eb7e17e03c134c3b34427b`
- مسیر رسید و شواهد خصوصی سرور: `/opt/hambazi/admin/releases/20261025-phase1/`
- receipt نهایی: `deployment-receipt.json` در همان مسیر؛ فاقد credential خام.

## اتصال از رایانهٔ مالک

Origin، hostname گواهی و Secure Cookie باید `https://admin.hambazi.top` باقی بمانند. بازکردن `https://localhost:18443` جایگزین معتبر نیست. DNS عمومی تغییر نکرده است.

### مرورگر عادی با نگاشت محلی hostname

این تنظیمات سمت رایانهٔ مالک‌اند و خودکار اعمال نشده‌اند. ابتدا یک سطر موقت در `/etc/hosts` اضافه شود:

```text
127.0.0.1 admin.hambazi.top
```

در لینوکس فعلی bind پورت ۴۴۳ اختیار محلی root می‌خواهد؛ در ترمینال جداگانه:

```bash
sudo ssh -NT \
  -i /home/mehdi/Downloads/private-key-file.pem \
  -o UserKnownHostsFile=/home/mehdi/.ssh/known_hosts \
  -o StrictHostKeyChecking=yes \
  -o IdentitiesOnly=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L 127.0.0.1:443:127.0.0.1:9443 \
  root@89.46.217.9
```

سپس `https://admin.hambazi.top` در مرورگر باز شود. پورت محلی ۴۴۳ باید آزاد باشد و مرورگر نباید این hostname را از proxy خارجی عبور دهد. پس از پایان، تونل با Ctrl+C بسته و سطر موقت hosts حذف شود. اعتبارسنجی TLS و کلید میزبان SSH نباید خاموش شوند؛ در صورت تغییر کلید، fingerprint باید مستقل بررسی شود.

### روش بدون bind پورت privileged

برای مرورگر اختصاصی Chromium می‌توان تونل `127.0.0.1:18443 → 127.0.0.1:9443` ساخت و فقط در همان process مرورگر از آرگومان زیر استفاده کرد:

```text
--host-resolver-rules=MAP admin.hambazi.top:443 127.0.0.1:18443
--no-proxy-server
```

مرورگر باید profile جدا داشته باشد و همچنان URL اصلی HTTPS را باز کند. این روش با Chromium/Playwright و اعتبارسنجی واقعی TLS آزمایش شد؛ به تغییر hosts یا غیرفعال‌کردن certificate verification نیاز ندارد. تونل تست اپراتور در پایان انتشار بسته شد.

## دیتابیس، Redis و اثر بر سرویس‌های بازی

پیش از تغییر schema، تعداد Match غیرنهایی صفر بود. dump خصوصی PostgreSQL با فرمت custom گرفته و catalog آن با `pg_restore --list` بررسی شد؛ restore کامل در این انتشار انجام نشد. SHA-256 پشتیبان:

```text
559a6fea4c3ca399750318d34a015d424200ed7f5f3709b8e62e1e1eb57b53c8
```

Prisma واقعی migration افزایشی `202610250001_admin_local_identity` را اعمال کرد؛ شمار migrationهای موفق از ۱۵ به ۱۶ و جدول‌های Admin به شش رسید. roleهای runtime، reader، bootstrap و recovery با secretهای مجزا و بیرون Git ساخته شدند. علاوه بر grants فایل `admin-permissions.sql`، مجوز CONNECT همان database صریحاً به این چهار role داده شد؛ PUBLIC و roleهای بازیکنان گسترش نیافتند. reader فقط ستون‌های metadata را می‌خواند و به hidden state یا chat دسترسی ندارد. credentialهای bootstrap/recovery و کلید خصوصی CA در کانتینر runtime mount نشده‌اند.

چهار HBA rule محدود به IP دقیق افزوده شد: runtime/reader فقط `10.89.18.14/32` و ابزار خصوصی bootstrap/recovery فقط gateway میزبان `10.89.18.1/32`. Redis user مستقل `admin` فقط namespace هش‌شدهٔ `admin-v1:staging` و فرمان‌های لازم rate limiter/connection را دارد. ACL کاربران API، Worker و health حفظ شد.

Redis موجود مسیر مدیریتی ACL در دسترس نداشت؛ بنابراین پس از بررسی مجدد صفر بودن Match فعال، maintenance کوتاه انجام و همان Redis container restart شد. Bot/API/Worker/Web به‌صورت کنترل‌شده متوقف و دوباره راه‌اندازی شدند. image ID، container ID، credentialهای موجود و volumeها حفظ شدند؛ فایل Nginx اصلی عیناً بازگردانده شد. فقط hash دو فایل HBA و startup Redis پس از بررسی delta دقیق در کنترل امنیت موجود به‌روز شد؛ image pin، policy، deadline و controller اصلی تغییر نکردند. رسید `access-delta-receipt.json` این تغییر را ثبت می‌کند.

دو شکست اولیهٔ qualification پنهان نشده‌اند: Redis برخلاف appها Docker healthcheck ندارد و probe به TLS PING احرازشده اصلاح شد؛ CONNECT دیتابیس برای roleهای تازه ابتدا غایب بود و سپس صریحاً داده شد. قالب صریح no-new-privileges نیز پیش از فعال‌سازی نهایی اصلاح و فقط کانتینر جدید Admin بازساخته شد. در هیچ‌یک حساب یا نشست واقعی ایجاد نشد.

## امنیت، انقضا و rollback

گواهی عمومی جدید `hambazi-admin` برای همین hostname صادر شد و تا `2027-01-23T19:30:30Z` معتبر است. گواهی‌های موجود بازی تعویض نشدند. صدور به‌دلیل timeout خروجی مستقیم سرور، از CONNECT موقت و محدود به Let’s Encrypt روی SSH انجام شد؛ TLS سرتاسری بررسی شد و proxy و reverse tunnel موقت سپس بسته شدند. **تمدید خودکار این گواهی از نظر اتصال خروجی هنوز qualify نشده است**؛ timer عمومی Certbot به‌تنهایی اثبات موفقیت تمدید نیست. مسیر خروجی معتبر باید پیش از موعد renewal تعیین شود؛ proxy رایانهٔ اپراتور وابستگی دائمی نشده است.

کنترل مستقل `/opt/hambazi/admin/ops/admin-security.py` به image/container دقیق، فایل‌های runtime/TLS/Nginx/UI/unitها و advisory واقعی bind شده است. اسکن actual image فقط یک MEDIUM و صفر HIGH/CRITICAL/UNKNOWN داشت؛ تمدید واقعی از feed معتبر نیز موفق شد. در زمان تحویل، مهلت معتبر **`2026-10-26T19:10:35Z`، برابر با ۲۲:۴۰:۳۵ تهران** است. تمدید ساعتی ممکن است این مهلت را تنها با شواهد تازه و در سقف deadline زیرساخت تمدید کند؛ این تاریخ یک وعدهٔ تمدید دائمی نیست.

واحدهای Admin و دو timer آن فعال و enabled هستند؛ timerهای قبلی زیرساخت هم فعال‌اند. expiry با marker پایدار پنل را ۵۰۳ و کانتینر را متوقف می‌کند. containment زمان‌بندی‌شدهٔ زیرساخت با Conflicts واحد Admin آن را نیز می‌بندد. renewal هرگز marker را حذف یا سرویس بسته را خودکار باز نمی‌کند.

rollback عملیاتی همین انتشار:

```bash
python3 /opt/hambazi/admin/ops/admin-security.py --contain
```

این فرمان **روی سرور با اختیار اپراتور** اجرا می‌شود، فقط Admin را می‌بندد و سرویس/volume بازی را حذف نمی‌کند. down migration یا restore خودکار روی دیتابیس مشترک مجاز نیست؛ schema افزایشی باقی می‌ماند. بازگشایی پس از بررسی مستقل evidence و علت توقف، حذف صریح marker و اجرای `--admit`/شروع سرویس انجام می‌شود. آزمون واقعی توقف، ۵۰۳، رد restart تا وجود marker، سلامت بازیکنان و بازگشایی تأییدشده موفق شد.

## شواهد پذیرش

| بررسی                            | نتیجه                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Browser روی انتشار واقعی از SSH  | TLS معتبر، HTTP 200، فارسی/RTL، موبایل بدون overflow؛ صفر خطای JS، CSP و axe                                                        |
| ورود نامعتبر و نشست ناشناس       | API برابر 401؛ بدون نمایش PIN یا cookie/session؛ LOGIN_DENIED در Audit                                                              |
| negative HTTP                    | هشت مورد موفق: صفحهٔ protected، bearer بازیکن، forwarded header، Origin بیگانه، نبود Bootstrap/Unlock، نبود player health و منع env |
| دسترسی اینترنت                   | handshake عمومی Admin رد؛ 9443 و 9444 بسته                                                                                          |
| DB privileges و نشست‌ها          | منع خواندن hidden state/chat و تغییر game/grants/owner/password/audit؛ صفر operator/OWNER/session                                   |
| بررسی واقعی با credential reader | metadata مجاز، state_jsonb با SQLSTATE 42501 رد                                                                                     |
| Redis runtime واقعی              | TLS PING موفق؛ key خارج namespace و INFO با NOPERM رد                                                                               |
| lifecycle                        | containment و restart gate موفق؛ دو controller نهایی و health Admin/Core موفق؛ renewal واقعی موفق                                   |
| تست infra محلی                   | ۱۹ فایل، ۱۸۱ موفق و دو skip موجود                                                                                                   |
| تست‌های پیشین برنامه             | Unit/Integration/E2E محلی فاز یک در گزارش همان فاز؛ حساب انسانی روی سرور آزمایش نشده است                                            |

رسیدهای سرور شامل `deployment-receipt.json`، `database-privilege-evidence.json`، `containment-rehearsal.json`، scanهای خصوصی و backup هستند. شواهد مرورگر و HTTP، به‌همراه screenshot، در مسیر خصوصی رایانهٔ اپراتور `/home/mehdi/.cache/hambazi-admin-release-20261025/` قرار دارند؛ credential خام در گزارش نیست.

## موارد باقی‌مانده و توقف فاز

انتشار **نصب بدون حساب و دسترسی خصوصی فاز یک** است و تأیید آمادگی عمومی/مالی/عملیات محصول نیست. قبل از OWNER واقعی، custody دو proof مستقل، backup/rotation کلیدها، retention/archive و هشدارهای Audit، بازیابی عملیاتی و بودجهٔ بار مشترک باید با مالک بسته و ceremony جدا تأیید شود. Password همراه PIN ثابت همچنان MFA مستقل یا مقاوم به phishing نیست.

سه failure قبلی Web SSR در check سراسری حل نشده‌اند؛ UI بازیکن روی سرور تعویض نشد. gate عمومی secret-scan مخزن نیز سبز اعلام نمی‌شود: finding قبلی خط ۱۹۶۷ یک revision عمومی Git است و فایل با HEAD یکسان بررسی شد، اما policy استثنای دقیق به blob/موقعیت قبلی bind است. policy و allowlist تغییر نکردند؛ review یک مورد به‌معنی عبور خودکار gate تاریخچه نیست. اسکن artifact مستقل Admin در آماده‌سازی صفر finding داشت. این تفکیک، تصویب release کامل مخزن یا دورزدن pipeline بازیکنان نیست؛ هیچ image بازیکنی از worktree فعلی منتشر نشد.

در پایان همین انتشار متوقف می‌شویم. ساخت OWNER واقعی و ورود به فاز دو هرکدام به تأیید صریح و پیش‌نیازهای خود نیاز دارند.
