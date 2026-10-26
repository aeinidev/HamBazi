# راه‌اندازی خصوصی OWNER در Staging

> نسخهٔ خصوصی، policy و Node/PostgreSQL client طبق [گزارش نصب](../implementation/admin-private-owner-installation-2026-10-26.md) نصب و qualify شدند. دستورهای backup/bootstrap/recover پایین هنوز اجرا نشده‌اند و به تأیید جدا نیاز دارند. پیش از ادامه، یافتهٔ HIGH اسکن موجود PostgreSQL و مهلت شواهد مشترک باید رسیدگی و دوباره تأیید شوند؛ هیچ gate یا timer برای این کار تضعیف نشود.

مرجع تصمیم [ADR-084](../adr/084-staging-owner-private-ssh-ceremony.md) است. این روش در مخزن آماده می‌شود؛ **هیچ دستور پایین در این نوبت روی سرور اجرا نشده و هیچ OWNER واقعی ساخته نشده است**. رمزها را در چت ارسال نکنید. bootstrap، backup و recovery را در ترمینال شخصی مالک اجرا کنید؛ Codex نباید ورودی‌های آن ترمینال را بخواند یا ضبط کند.

## پیش از اجازهٔ ساخت حساب

1. نسخهٔ دقیق API/Admin و operator bundle باید بازبینی، اسکن و با مجوز نصب شود؛ فایل‌های frontend/backend مربوط به تغییر Password/PIN، migration افزایشی `202610260001_admin_password_rotation` و grant محدود ستون Password لازم‌اند. نصب با ingress خصوصی فعلی انجام شود؛ candidate عمومی Nginx نصب نشود. سلامت، controllerها، TLS و شمار صفر حساب/نشست دوباره بررسی شوند؛ دادهٔ غیرمنتظره حذف یا بازنویسی نشود.
2. بررسی فقط‌خواندنی همین نوبت نشان داد host سرور Node، pnpm، pg_dump و pg_restore ندارد. برای نسخهٔ host-based ابزار، Node مطابق toolchain پروژه و PostgreSQL client سازگار با major دیتابیس، با تأیید جدا لازم‌اند؛ pnpm برای اجرای bundle آماده لازم نیست. این‌ها executable خصوصی‌اند، نه daemon/port/service جدید. نصب executable یا بستهٔ client در این نوبت انجام نشده است؛ جایگزین بررسی‌نشده یا اجرای ابزار با root در کانتینر runtime بازی مجاز نیست.
3. operator bundle باید layout `apps/api/{dist,node_modules,package.json}` و SQLهای `packages/database/prisma/` را حفظ کند. restore-test از همان migrationهای Admin و grants بسته استفاده می‌کند. native Argon2 و TLS/CA pathها باید با runtime واقعی مقصد smoke شوند؛ build روی لپ‌تاپ به‌تنهایی تأیید host سرور نیست. مسیر مورد نظر این راهنما `/opt/hambazi/admin/operator/`، root-owned و غیرقابل‌نوشتن برای دیگران است.
4. فایل policy خصوصی `/opt/hambazi/admin/private/staging-owner-policy.json` با mode 0600 و والدهای امن نصب شود. `sourceRevision`، SHA-256 بستهٔ کامل مورد تأیید است، نه hash حدسی، placeholder معتبر یا صرفاً HEAD قدیمی:

```json
{
  "schemaVersion": 1,
  "profile": "staging-ssh-root-v1",
  "realm": "staging",
  "environment": "staging",
  "sourceRevision": "<SHA256_OF_REVIEWED_OPERATOR_BUNDLE>",
  "databaseHost": "10.89.18.20",
  "databasePort": 5432,
  "databaseCaFile": "/opt/hambazi/private/tls/data-ca.pem"
}
```

این template خود فایل اجرایی/Policy نصب‌شده نیست. اطلاعات ورود در policy وجود ندارد. فایل‌های `runtime.env` و `operator-database.env` فعلی حفظ و فقط برای مسیر نسخهٔ تأییدشده خوانده می‌شوند؛ دومی باید کلیدهای موجود `ADMIN_BOOTSTRAP_DATABASE_URL` و `ADMIN_RECOVERY_DATABASE_URL` را با role جدا داشته باشد. فایل runtime در ابزار با `NODE_ENV=production` اعتبارسنجی می‌شود تا TLS سست نشود.

بررسی فقط‌خواندنی نشان داد URLهای فعلی به `postgres-staging` و CA داخل `/run/` اشاره می‌کنند؛ این نام/فایل روی host وجود ندارد. ابزار host-based فقط طبق policy، آدرس را به IP خصوصی و CA میزبان تبدیل می‌کند؛ username/password/database و `verify-full` حفظ می‌شوند. SAN گواهی فعلی IP بالا را دارد؛ TLS آن از میزبان باید قبل ceremony تأیید شود. هیچ `/etc/hosts`، DNS، HBA، certificate یا config سرویس بازیکنان برای این تبدیل تغییر نمی‌کند. runtime/reader فعلی در HBA فقط از IP کانتینر Admin مجازند؛ backup میزبان از role خصوصی recovery موجود استفاده می‌کند، نه runtime. برای dump کامل، فقط SELECT روی `admin_sessions` و `admin_grants` به همان role خصوصی در فایل جدا `admin-staging-owner-permissions.sql` آماده شده است؛ این grant روی سرور هنوز اعمال نشده است.

## بکاپ و تمرین بازیابی، پیش از OWNER

در SSH شخصی مالک، با echo/recording سالم، core dump غیرفعال و بدون debug/coverage، ابزار backup اجرا می‌شود. این فرمان آینده فقط پس از مجوز نصب/اجرای سرور است:

```sh
ulimit -c 0
node /opt/hambazi/admin/operator/apps/api/dist/composition/admin-owner-backup-cli.js --confirm-private-owner-backup
```

عبارت رمزگذاری را خود مالک از vault مستقل وارد می‌کند، حداقل ۲۰ نویسه، و در vault خارج سرور نگه می‌دارد؛ از Password/PIN مالک استفادهٔ مجدد نشود. فقط شش جدول Admin در snapshot واحد گرفته می‌شوند؛ role خصوصی recovery با SELECT شش جدول استفاده می‌شود؛ HBA موجود آن را از gateway میزبان مجاز کرده است. `pg_dump` با `verify-full`، CA خصوصی، lock timeout و deadline اجرا می‌شود؛ Password دیتابیس در argv قرار نمی‌گیرد. dump خام و envهای capsule در RAM می‌مانند. خروجی فقط نام archive رمزگذاری‌شده در `/opt/hambazi/admin/backups/` و SHA-256 آن است. این پوشه از قبل root-owned و 0700 لازم است؛ فایل 0600 ساخته می‌شود. این backup جای پشتیبان کامل بازی/زیرساخت یا PITR نیست.

archive رمزگذاری‌شده را در مسیر خصوصی دستگاه مالک کپی و hash آن را با خروجی سرور مقایسه کنید. هیچ فایل plaintext از env یا dump برای انتقال ایجاد نکنید. روی دستگاه مالک با Node/Docker محلی و نسخهٔ همان bundle:

```sh
ulimit -c 0
pnpm --filter @hambazi/api admin:owner:restore-test /absolute/private/path/owner-backup.hba --confirm-owned-offline-restore
```

در bundle بدون pnpm، entrypoint متناظر `apps/api/dist/composition/admin-owner-restore-cli.js` با Node اجرا می‌شود. archive باید متعلق به کاربر جاری و mode 0600 باشد. tool در نشست SSH اجرا نمی‌شود؛ passphrase و تأیید «کپی خارج سرور» تعاملی‌اند. Docker باید image pinnedِ PostgreSQL تست را داشته باشد؛ خود ابزار pull یا اتصال بیرونی نمی‌کند. container نام تصادفی، network=none، بدون port و بدون host volume دارد؛ credential/دادهٔ fixture به سرویس بازی فرستاده نمی‌شود. PostgreSQL موقت در tmpfs با محدودیت حافظه/PID/CPU اجرا و فقط همان container پاک می‌شود. روی محیط قابل اعتماد و بدون dump/swap ناامن اجرا شود؛ Node پاک‌شدن همهٔ کپی‌های RAM را تضمین نمی‌کند.

AEAD قبل از restore بررسی می‌شود. schema/grant/trigger از source همان نسخه ساخته، سپس داده با `--single-transaction --exit-on-error` وارد target خالی می‌شود؛ privilege بیشتر فقط متعلق به sandbox است. owner، رابطه‌ها، triggerهای فعال و منع تغییر binding/Audit توسط runtime بررسی می‌شوند. archive ناشناس یا ساخته‌شده با کلید مشکوک restore نشود؛ backup می‌تواند برای SQL restore دادهٔ مخرب داشته باشد. شکست هر مرحله، receipt موفق تولید نمی‌کند و به سرور اصلی دست نمی‌زند.

فایل `owner-backup.hba.restore.json` فقط پس از موفقیت ساخته می‌شود؛ contains hash archive، hash نسخه و زمان است و هیچ credential ندارد. پس از بررسی اپراتور، همین receipt با root:root/0600 در `/opt/hambazi/admin/private/owner-backup-rehearsal.json` نصب می‌شود. **trueها را دستی به‌جای تمرین واقعی پر نکنید.** قبل ceremony، hash نسخه باید با policy یکسان و عمر receipt حداکثر ۲۴ ساعت باشد. این ابزار off-server بودن را با رد SSH و تأیید انسان کنترل می‌کند؛ اثبات رمزنگاری محل فیزیکی دستگاه ادعا نمی‌شود.

## ایجاد نخستین OWNER، فقط با تأیید جدا

مالک ابتدا مجوز مشخص ساخت حساب واقعی را بدهد؛ آماده‌بودن فایل‌ها یا گزارش تست مجوز ساخت نیست. سپس در SSH تعاملی شخصی، بدون redirect/pipe/`script`/اشتراک صفحه یا ضبط ورودی:

```sh
ulimit -c 0
node /opt/hambazi/admin/operator/apps/api/dist/composition/admin-owner-staging.js bootstrap --confirm-private-owner-ceremony
```

Username، Password و PIN شش‌رقمی و تأیید تکرارها مخفی وارد می‌شوند؛ هیچ‌کدام آرگومان یا متغیر shell نیستند. عبارت تأیید همان عملیات در prompt وارد می‌شود. input pipe و TTY غیرمنطبق، root نبودن، debug، policy غیر Staging، receipt قدیمی، evidence منقضی یا maintenance باعث رد می‌شوند. اطلاعات رمز را از این ترمینال به چت/گزارش منتقل نکنید. حساب پیش‌فرض، username ثابت یا OWNER دوم وجود ندارد.

checkpoint و فایل audit در مسیر خصوصی بیرون DB نگه‌داری شوند. UUID مالک/command و رسید غیرمحرمانهٔ enrollment باید در custody خارج سرور هم ثبت شوند. بلافاصله پس از enrollment، backup جدید و کپی خارج سرور تهیه شود؛ backup قبل enrollment دادهٔ OWNER ساخته‌شده را ندارد. این اقدامات هم به مجوز اجرایی خود نیاز دارند و اکنون انجام نشده‌اند.

اگر قطع ارتباط/خطای commit رخ داد، commandId و pending را نگه دارید. فقط اجرای دوبارهٔ همان action و همان ورودی می‌تواند همان receipt را resume کند. **فایل lock یا checkpoint را برای عبور حذف نکنید.** اپراتور باید مرگ فرایند قبلی، Audit/receipt و binding DB را privately reconcile کند. موفقیت DB و شکست نوشتن Audit نهایی ممکن است خروجی DENIED داشته باشد؛ حساب دوم ایجاد نکنید.

ورود پس از ساخت همچنان از تونل SSH فعلی است. در صفحهٔ «امنیت حساب مالک»، تعویض Password و PIN دو عمل مستقل با Password/PIN فعلی هستند؛ هر موفقیت همهٔ نشست‌ها را باطل و ورود مجدد لازم می‌کند. پس از هر تغییر credential، backup تازه و کپی خارج سرور تهیه شود؛ برای restore یک snapshot قدیمی، Password متناظر همان snapshot لازم است. vault باید تاریخچهٔ لازم را تا پایان عمر backupهای مربوط حفظ کند؛ receipt جدیدی بدون تمرین واقعی ساخته نشود. برچسب «موقت» تعویض اجباری نخستین ورود را پیاده نمی‌کند؛ چنین flagی در این scope اضافه نشده است.

## قفل و Recovery

سه PIN اشتباهِ متمایز پس از Password صحیح، قفل پایدار PostgreSQL می‌سازد؛ زمان/IP/restart یا Password/PIN صحیح آن را باز نمی‌کنند. **روی OWNER واقعی برای تست عمداً قفل ایجاد نکنید**؛ این سناریو در fixture جدا آزموده می‌شود.

برای قفل واقعی، با policy/evidence/receipt معتبر و تأیید مشخص Recovery:

```sh
ulimit -c 0
node /opt/hambazi/admin/operator/apps/api/dist/composition/admin-owner-staging.js recover --confirm-private-owner-ceremony
```

Username و Password فعلی OWNER، PIN جدید و تکرار آن مخفی درخواست می‌شوند. بازیابی همان هویت را نگه می‌دارد، فقط PIN/lock/epoch را عوض می‌کند و نشست‌های قبلی را می‌بندد. رمز اشتباه هیچ PIN failure تازه یا unlock ایجاد نمی‌کند. اگر Password گم شده، این ابزار کافی نیست؛ عملیات متوقف و فرآیند جدا بررسی می‌شود، نه SQL یا حساب جایگزین.

disaster restore با unlock یکی نیست. ابزار restore-test هیچ دیتابیس سرویس‌دهنده‌ای را restore نمی‌کند. برای disaster واقعی، Admin بسته، بکاپ در DB تازهٔ جدا restore، checkpoint مستقل reconcile و signing key نشست پیش از بازگشایی rotate شود؛ PIN pepper و command key مطابق capsule حفظ شوند. restore دیتابیس مشترک یا بازنویسی بازی‌ها مجاز نیست. به backup قدیمی اجازهٔ پاک‌کردن checkpoint جدید یا ثبت OWNER تازه ندهید.

## موارد لازم پیش از اجرا روی محیط واقعی

مجوز نصب نسخه/ابزار و migration/grant محدود، qualification runtime مقصد و image evidence، backup واقعی و receipt تازه و custody مستقل خارج سرور، خاموش‌بودن ضبط ترمینال و تأیید نهایی ساخت حساب لازم‌اند. تست محلیِ fixture این gateهای محیط واقعی را خودکار سبز نمی‌کند. Public Admin و فاز دو همچنان بسته‌اند.
